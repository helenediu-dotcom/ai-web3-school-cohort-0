import { formatEther, type Hex } from "viem";
import type { TransactionRequest } from "./permission-policy";

// === 最小钱包接口（避免与 agent-wallet.ts 循环依赖） ===
// 使用 duck-typing：只声明 simulation 需要的方法签名
// AgentWalletInstance 在运行时满足此接口，无需显式 implements

interface SimWallet {
  smartAccount: {
    client: {
      call: (args: {
        account: Hex;
        to: Hex;
        value: bigint;
        data: Hex;
      }) => Promise<{ data: Hex | undefined }>;
      getBalance: (args: { address: Hex }) => Promise<bigint>;
      getBlock: () => Promise<{ number: bigint }>;
    };
  };
  smartAccountAddress: Hex;
  pimlicoClient: {
    getUserOperationGasPrice: () => Promise<{
      fast: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    }>;
    estimateUserOperationGas: (args: {
      account: any;
      calls: { to: Hex; value: bigint; data: Hex }[];
      paymaster?: any;
    }) => Promise<{
      callGasLimit: string | number | bigint;
      verificationGasLimit: string | number | bigint;
      preVerificationGas: string | number | bigint;
      paymasterVerificationGasLimit?: string | number | bigint;
    }>;
  };
}

// === 类型定义 ===

export interface BalanceChange {
  address: string;
  asset: string;
  before: bigint;
  after: bigint;
  delta: bigint; // 正=收到，负=支出
}

export interface SimulationReport {
  callSim: {
    success: boolean;
    revertReason?: string;
    balanceChanges: BalanceChange[];
    /** sender 自身余额变化（便捷提取，null 表示 call 失败未获取） */
    fromBalanceChange: BalanceChange | null;
    /** 模拟时的区块号 */
    simulatedAtBlock: bigint;
  };

  gasEstimate: {
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    /** (callGasLimit + verificationGasLimit + preVerificationGas) × maxFeePerGas */
    estimatedTotalGas: bigint;
    /** 人性化: "~0.0003 ETH" */
    estimatedTotalEth: string;
    paymasterSponsored: boolean;
  };

  /** 一行摘要 */
  summary: string;
  /** 聚合风险指标 */
  riskLevel: "low" | "medium" | "high";
  /** 风险/警告提示 */
  warnings: string[];
}

// === runPreTxSimulation ===

export async function runPreTxSimulation(
  wallet: SimWallet,
  tx: TransactionRequest,
  fromBalance: bigint
): Promise<SimulationReport> {
  const publicClient = wallet.smartAccount.client;

  // A 路径：eth_call 链上模拟
  const callPromise = (async () => {
    const block = await publicClient.getBlock();
    const blockNumber = block.number;

    try {
      await publicClient.call({
        account: wallet.smartAccountAddress,
        to: tx.to,
        value: tx.value,
        data: tx.data,
      });

      // eth_call 成功 → 计算余额变化
      const before = fromBalance;
      const after = before - tx.value;
      const fromBC: BalanceChange = {
        address: wallet.smartAccountAddress,
        asset: "ETH",
        before,
        after,
        delta: -tx.value,
      };

      const balanceChanges: BalanceChange[] = [fromBC];

      // 如果接收方不是自己，查询接收方余额变化
      if (tx.to.toLowerCase() !== wallet.smartAccountAddress.toLowerCase()) {
        const recipientBefore = await publicClient.getBalance({
          address: tx.to,
        });
        balanceChanges.push({
          address: tx.to,
          asset: "ETH",
          before: recipientBefore,
          after: recipientBefore + tx.value,
          delta: tx.value,
        });
      }

      return {
        success: true as const,
        balanceChanges,
        fromBalanceChange: fromBC,
        simulatedAtBlock: blockNumber,
        revertReason: undefined as string | undefined,
      };
    } catch (err: any) {
      return {
        success: false as const,
        revertReason: err?.message || "未知 revert 原因",
        balanceChanges: [] as BalanceChange[],
        fromBalanceChange: null,
        simulatedAtBlock: blockNumber,
      };
    }
  })();

  // B 路径：bundler gas 预估
  const gasPromise = (async () => {
    let callGasLimit = 200_000n; // fallback
    let verificationGasLimit = 0n;
    let preVerificationGas = 0n;
    let paymasterSponsored = false;
    // fallback gas price（bundler 不可用时使用）
    let maxFeePerGasBig = 50_000_000_000n; // 50 gwei
    let maxPriorityFeePerGasBig = 1_000_000_000n; // 1 gwei

    try {
      // 获取实时 gas 价格
      const { fast: gasPrice } =
        await wallet.pimlicoClient.getUserOperationGasPrice();
      maxFeePerGasBig = BigInt(gasPrice.maxFeePerGas);
      maxPriorityFeePerGasBig = BigInt(gasPrice.maxPriorityFeePerGas);

      const estimateResult =
        await wallet.pimlicoClient.estimateUserOperationGas({
          account: wallet.smartAccount,
          calls: [{ to: tx.to, value: tx.value, data: tx.data }],
        });

      callGasLimit = BigInt(estimateResult.callGasLimit);
      verificationGasLimit = BigInt(estimateResult.verificationGasLimit);
      preVerificationGas = BigInt(estimateResult.preVerificationGas);

      // 检查 paymaster 是否可用（带 paymaster 再估一次）
      try {
        const pmEstimate =
          await wallet.pimlicoClient.estimateUserOperationGas({
            account: wallet.smartAccount,
            calls: [{ to: tx.to, value: tx.value, data: tx.data }],
            paymaster: wallet.pimlicoClient,
          });
        // 如果 paymaster 返回了 paymasterVerificationGasLimit，说明赞助可用
        paymasterSponsored =
          (pmEstimate as any).paymasterVerificationGasLimit !== undefined;
      } catch {
        paymasterSponsored = false;
      }
    } catch {
      // bundler 不可用，使用 fallback 值
    }

    const gasLimit =
      callGasLimit + verificationGasLimit + preVerificationGas;
    const estimatedTotalGas = gasLimit * maxFeePerGasBig;

    return {
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas: maxFeePerGasBig,
      maxPriorityFeePerGas: maxPriorityFeePerGasBig,
      estimatedTotalGas,
      estimatedTotalEth: formatEther(estimatedTotalGas),
      paymasterSponsored,
    };
  })();

  // 并行执行 A + B
  const [callResult, gasResult] = await Promise.all([
    callPromise,
    gasPromise,
  ]);

  // 生成 warnings
  const warnings: string[] = [];
  if (!callResult.success) {
    warnings.push(`交易将 revert：${callResult.revertReason}`);
  }
  if (gasResult.estimatedTotalGas > fromBalance) {
    warnings.push("余额不足以支付 gas 费用");
  } else if (
    gasResult.estimatedTotalGas >
    (fromBalance * 20n) / 100n
  ) {
    warnings.push("gas 消耗占余额超过 20%");
  }
  if (
    !gasResult.paymasterSponsored &&
    gasResult.estimatedTotalGas > 1_000_000_000_000_000n // 0.001 ETH
  ) {
    warnings.push("无 Paymaster 赞助，需自付 gas");
  }

  // 生成摘要
  const valueEth = formatEther(tx.value);
  const toShort = `${tx.to.slice(0, 6)}...${tx.to.slice(-4)}`;
  const sponsorNote = gasResult.paymasterSponsored
    ? "（Paymaster 赞助）"
    : "";
  const summary = `将发送 ${valueEth} ETH 到 ${toShort}，gas ~${gasResult.estimatedTotalEth} ETH${sponsorNote}`;

  const riskLevel = computeRiskLevel({
    callSim: callResult,
    gasEstimate: gasResult,
    summary,
    riskLevel: "low", // temporary, will be replaced by computeRiskLevel
    warnings,
  });

  return {
    callSim: callResult,
    gasEstimate: gasResult,
    summary,
    riskLevel,
    warnings,
  };
}

// === computeRiskLevel ===

export function computeRiskLevel(
  report: SimulationReport
): "low" | "medium" | "high" {
  // 优先级 1: call 失败 → high
  if (!report.callSim.success) {
    return "high";
  }

  // 优先级 2: 余额不足 → high
  if (report.warnings.some((w) => w.includes("余额不足"))) {
    return "high";
  }

  // 优先级 3: gas 占余额 > 20% → medium
  if (report.warnings.some((w) => w.includes("gas 消耗占余额超过 20%"))) {
    return "medium";
  }

  // 优先级 4: 其他 → low
  return "low";
}

// === formatSimulationReport ===

export function formatSimulationReport(
  report: SimulationReport
): string {
  const riskIcons: Record<string, string> = {
    low: "🟢 LOW",
    medium: "🟡 MEDIUM",
    high: "🔴 HIGH",
  };

  const lines: string[] = [];
  lines.push("");
  lines.push("═".repeat(60));
  lines.push("  Pre-transaction Simulation 报告");
  lines.push("═".repeat(60));

  // A 路径结果
  const callIcon = report.callSim.success ? "✓" : "✗";
  const callStatus = report.callSim.success ? "成功" : "失败";
  lines.push(
    `链上模拟：${callIcon} ${callStatus}（区块 #${report.callSim.simulatedAtBlock}）`
  );

  if (!report.callSim.success && report.callSim.revertReason) {
    lines.push(`  Revert 原因：${report.callSim.revertReason}`);
  }

  if (report.callSim.fromBalanceChange) {
    const bc = report.callSim.fromBalanceChange;
    const beforeEth = formatEther(bc.before);
    const afterEth = formatEther(bc.after);
    const deltaSign = bc.delta >= 0n ? "+" : "";
    const deltaEth = formatEther(bc.delta >= 0n ? bc.delta : -bc.delta);
    lines.push(
      `  发送方余额变化：${beforeEth} ETH → ${afterEth} ETH（${deltaSign}${deltaEth} ETH）`
    );
  }

  // B 路径结果
  lines.push("");
  lines.push("Gas 预估：");
  lines.push(
    `  Gas Limit:      ${report.gasEstimate.callGasLimit + report.gasEstimate.verificationGasLimit + report.gasEstimate.preVerificationGas}`
  );
  lines.push(
    `  Max Fee:        ${formatEther(report.gasEstimate.maxFeePerGas)} ETH`
  );
  lines.push(
    `  预估总 Gas:     ~${report.gasEstimate.estimatedTotalEth} ETH`
  );
  const pmStatus = report.gasEstimate.paymasterSponsored
    ? "赞助 ✓"
    : "无赞助 ✗";
  lines.push(`  Paymaster:      ${pmStatus}`);

  // 风险等级
  lines.push("");
  lines.push(
    `风险等级：${riskIcons[report.riskLevel] || report.riskLevel}`
  );

  // 警告
  if (report.warnings.length > 0) {
    for (const w of report.warnings) {
      lines.push(`⚠ ${w}`);
    }
  }

  // 摘要
  lines.push("");
  lines.push(`摘要：${report.summary}`);
  lines.push("═".repeat(60));

  return lines.join("\n");
}
