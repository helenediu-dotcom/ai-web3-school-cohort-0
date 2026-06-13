import { Address, Hex, formatEther, parseEther } from "viem";
import type { AgentWalletInstance } from "../agent-wallet";
import type { SessionKey } from "../session-key";
import type {
  PermissionPolicy,
  TransactionRequest,
  UsageTracker,
} from "../permission-policy";
import { createEmptyUsageTracker, recordUsage } from "../permission-policy";
import { safeGuardCheck, formatGuardResult, GuardCheck } from "../safe-guard";
import {
  runPreTxSimulation,
  SimulationReport,
  formatSimulationReport,
} from "../pre-tx-sim";
import type { ConfirmationFn, ConfirmationContext } from "../confirmation";
import { getUserConfirmation } from "../confirmation";
import type { GreyZonePolicy } from "../grey-zone";
import {
  greyZoneEngine,
  DEFAULT_GREY_ZONE_POLICY,
} from "../grey-zone";

// === Agentic Commerce — Agent 支付决策模块 ===
//
// 核心流程（对应 Agentic Commerce 六层协议栈中的四层）：
//   ① 发现层 — 硬编码支付指令（简化版不写 mock server）
//   ② 信任层 — 灰区引擎评估 + Safe Guard 前置校验
//   ③ 支付层 — Smart Account 链上支付（ERC-4337 UserOp）
//   ④ 交付层 — API 返回数据（模拟）

// === 类型定义 ===

/** HTTP 402 支付指令（简化版 x402 格式） */
export interface PaymentInstruction {
  /** 支付金额（人性化格式，如 "0.001 ETH"） */
  amount: string;
  /** 支付金额（wei） */
  amountWei: bigint;
  /** 支付代币 */
  token: string;
  /** 收款地址 */
  recipient: Address;
  /** 服务描述 */
  description: string;
  /** API 端点（支付成功后重试） */
  apiUrl: string;
}

/** API 数据返回（模拟付费 API 响应） */
export interface ApiData {
  success: true;
  data: Record<string, unknown>;
  paymentTx: Hex;
  paidAmount: string;
}

/** 支付失败 */
export interface PaymentFailed {
  success: false;
  reason: string;
  stage: "guard" | "simulation" | "confirmation" | "execution";
}

export type PaymentResult = ApiData | PaymentFailed;

/** agentPayForApiData 配置选项 */
export interface CheckoutOptions {
  /** 跳过交互确认，默认 false */
  autoConfirm?: boolean;
  /** 灰区策略覆盖 */
  greyZonePolicy?: GreyZonePolicy;
  /** 确认函数覆盖（默认 getUserConfirmation） */
  confirmationFn?: ConfirmationFn;
}

// === 核心函数 ===

/**
 * Agent 自主支付 API 数据
 *
 * 从收到 HTTP 402 支付指令到获取付费数据的完整闭环。
 * 复用现有安全基础设施：Safe Guard → Simulation → Grey Zone → Confirmation → Smart Account。
 */
export async function agentPayForApiData(
  paymentInstr: PaymentInstruction,
  wallet: AgentWalletInstance,
  session: SessionKey,
  policy: PermissionPolicy,
  options: CheckoutOptions = {}
): Promise<PaymentResult> {
  const {
    autoConfirm = false,
    greyZonePolicy = DEFAULT_GREY_ZONE_POLICY,
    confirmationFn = getUserConfirmation,
  } = options;

  // ── 展示支付指令 ──
  console.log(`\n📦 Agent 收到支付指令（HTTP 402 Payment Required）`);
  console.log(`   服务:     ${paymentInstr.description}`);
  console.log(`   金额:     ${paymentInstr.amount}`);
  console.log(`   收款方:   ${paymentInstr.recipient}`);
  console.log(`   API:      ${paymentInstr.apiUrl}`);

  // ── Step 1: 构造交易 ──
  const tx: TransactionRequest = {
    to: paymentInstr.recipient,
    value: paymentInstr.amountWei,
    data: "0x",
  };

  let usage = createEmptyUsageTracker();

  // ── Step 2: Safe Guard 前置校验 ──
  console.log(`\n🛡️  Safe Guard 前置校验...`);
  const guardCheck = safeGuardCheck(session, policy, tx, usage);

  if (!guardCheck.passed) {
    const failedCheck = guardCheck.checks.find(
      (c) => !c.passed && c.level === "hard"
    );
    return {
      success: false,
      reason: `Safe Guard 硬约束拦截：${failedCheck?.detail || "未知原因"}`,
      stage: "guard",
    };
  }

  console.log(`   ✓ Safe Guard 硬约束全部通过`);
  if (guardCheck.requiresHumanReview) {
    console.log(`   ⚠ Safe Guard 灰区提醒：${guardCheck.humanReviewReason}`);
  }

  // ── Step 3: Pre-transaction Simulation ──
  console.log(`\n🔍 Pre-transaction Simulation...`);

  let fromBalance: bigint;
  try {
    fromBalance = await wallet.publicClient.getBalance({
      address: wallet.smartAccountAddress,
    });
  } catch {
    fromBalance = 0n;
  }

  // 构造 SimWallet（duck-typing，publicClient 满足 SimWallet 接口）
  const simWallet = {
    smartAccount: {
      client: wallet.publicClient,
    },
    smartAccountAddress: wallet.smartAccountAddress,
    pimlicoClient: wallet.pimlicoClient,
  };
  const simulation = await runPreTxSimulation(simWallet, tx, fromBalance);

  console.log(formatSimulationReport(simulation));

  // ── Step 4: 风险分流 ──
  const riskLevel = simulation.riskLevel;

  // critical → 直接拒绝
  if (riskLevel === "critical") {
    return {
      success: false,
      reason: `风险等级 CRITICAL，支付已自动拒绝：${simulation.warnings.join("; ")}`,
      stage: "simulation",
    };
  }

  // medium → 灰区规则引擎
  let autoApproved = false;
  let autoApprovalReason = "";

  if (riskLevel === "medium") {
    console.log(`\n🧠 灰区规则引擎评估中...`);
    const decision = greyZoneEngine(
      "medium",
      guardCheck,
      tx.value,
      tx.to,
      greyZonePolicy
    );

    if (decision.decision === "auto_approve") {
      autoApproved = true;
      autoApprovalReason = decision.reason;
      console.log(`   🤖 自动通过：${decision.reason}`);
    } else {
      console.log(`   ⚠ 升级人工确认：${decision.reason}`);
    }
  }

  // high → 提示人工审核
  if (riskLevel === "high") {
    console.log(`\n⚠ 风险等级 HIGH，建议仔细审核后确认`);
  }

  // ── Step 5: 用户确认（按风险等级分流） ──
  let confirmed = autoConfirm || autoApproved;

  if (!confirmed) {
    const context: ConfirmationContext = {
      guardCheck,
      tx,
      greyZonePolicy,
    };

    const confirmResult = await confirmationFn(simulation, false, context);

    if (!confirmResult.confirmed) {
      return {
        success: false,
        reason: "用户取消支付",
        stage: "confirmation",
      };
    }

    confirmed = true;
    if (confirmResult.autoApproved) {
      autoApprovalReason = confirmResult.autoApprovalReason || "";
    }
  }

  // ── Step 6: 链上支付（ERC-4337 UserOp → Smart Account） ──
  console.log(`\n💳 链上支付执行中...`);
  console.log(`   From:  ${wallet.smartAccountAddress}`);
  console.log(`   To:    ${tx.to}`);
  console.log(`   Value: ${formatEther(tx.value)} ETH`);

  try {
    const { fast: gasPrice } =
      await wallet.pimlicoClient.getUserOperationGasPrice();

    const userOpHash = await wallet.pimlicoClient.sendUserOperation({
      account: wallet.smartAccount,
      calls: [{ to: tx.to, value: tx.value, data: tx.data }],
      maxFeePerGas: BigInt(gasPrice.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(gasPrice.maxPriorityFeePerGas),
      paymaster: wallet.pimlicoClient,
    });

    const receipt = await wallet.pimlicoClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });

    const txHash = receipt.receipt.transactionHash;
    console.log(`   ✓ 支付已确认`);
    console.log(`   Tx Hash:  ${txHash}`);
    console.log(`   Etherscan: https://sepolia.etherscan.io/tx/${txHash}`);

    // 更新用量追踪
    usage = recordUsage(usage, tx);

    // ── Step 7: 重试 API 请求 → 获取付费数据（模拟） ──
    console.log(`\n📡 携带支付凭证重试 API 请求...`);
    console.log(`   GET ${paymentInstr.apiUrl}`);
    console.log(`   Authorization: X-Payment-Tx ${txHash}`);
    console.log(`   ✓ HTTP 200 OK — 付费数据已返回（模拟）`);

    const mockData: ApiData = {
      success: true,
      data: {
        service: paymentInstr.description,
        message: `支付 ${paymentInstr.amount} 已完成，以下是付费内容`,
        timestamp: new Date().toISOString(),
        analysis: {
          period: "过去 30 天",
          totalTransactions: 42,
          totalValue: "1.5 ETH",
          avgGasPerTx: "~0.0003 ETH",
          topInteractedContracts: [
            "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
            "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
          ],
        },
        paymentVerified: true,
        paymentTx: txHash,
      },
      paymentTx: txHash,
      paidAmount: paymentInstr.amount,
    };

    return mockData;
  } catch (err: any) {
    return {
      success: false,
      reason: `链上支付失败：${err.message || err}`,
      stage: "execution",
    };
  }
}

// === 辅助函数 ===

/**
 * 创建硬编码支付指令（简化版，不写 mock server）
 *
 * 模拟一个付费 API 返回的 HTTP 402 响应体。
 * 实际 x402 流程中，这些字段由 API Server 在 HTTP 402 响应中返回。
 */
export function createPaymentInstruction(
  overrides: Partial<{
    amountEth: string;
    recipient: Address;
    description: string;
    apiUrl: string;
  }> = {}
): PaymentInstruction {
  const amountEth = overrides.amountEth || "0.001";
  const amountWei = parseEther(amountEth);

  return {
    amount: `${amountEth} ETH`,
    amountWei,
    token: "ETH",
    recipient:
      overrides.recipient ||
      "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
    description:
      overrides.description ||
      "链上数据分析 API — 地址 30 天交易趋势报告",
    apiUrl:
      overrides.apiUrl ||
      "https://api.example.com/v1/analysis/tx-trends?address=0x5190...",
  };
}

/** 格式化支付结果，用于终端展示 */
export function formatPaymentResult(result: PaymentResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("═".repeat(60));
  lines.push("  Agentic Commerce 支付结果");
  lines.push("═".repeat(60));

  if (result.success) {
    lines.push("");
    lines.push("✓ 支付成功 — API 数据已获取");
    lines.push(`  支付金额: ${result.paidAmount}`);
    lines.push(`  交易哈希: ${result.paymentTx}`);
    lines.push(`  Etherscan: https://sepolia.etherscan.io/tx/${result.paymentTx}`);
    lines.push("");
    lines.push("  返回数据:");
    lines.push(`  ${JSON.stringify(result.data, null, 2).replace(/\n/g, "\n  ")}`);
  } else {
    lines.push("");
    lines.push(`✗ 支付失败`);
    lines.push(`  失败阶段: ${result.stage}`);
    lines.push(`  原因:     ${result.reason}`);
  }

  lines.push("");
  lines.push("═".repeat(60));
  return lines.join("\n");
}

/**
 * 验证支付指令合法性
 *
 * 检查：
 *  - 金额 > 0
 *  - 收款地址非零地址
 *  - 描述非空
 */
export function validatePaymentInstruction(
  instr: PaymentInstruction
): { valid: true } | { valid: false; reason: string } {
  if (instr.amountWei <= 0n) {
    return { valid: false, reason: "支付金额必须大于 0" };
  }
  if (instr.recipient === "0x0000000000000000000000000000000000000000") {
    return { valid: false, reason: "收款地址不能为零地址" };
  }
  if (!instr.description || instr.description.trim().length === 0) {
    return { valid: false, reason: "服务描述不能为空" };
  }
  return { valid: true };
}
