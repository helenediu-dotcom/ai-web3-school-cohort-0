# Pre-transaction Simulation 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Safe Guard 通过后、链上执行前插入 Pre-transaction Simulation 步骤（eth_call 模拟 + bundler gas 预估），输出结构化 SimulationReport，按 riskLevel 分级确认。

**Architecture:** 新增 `pre-tx-sim.ts`（模拟 + 渲染）和 `confirmation.ts`（确认逻辑），改造 `agent-wallet.ts`（集成 simulation 步骤）和 `index.ts`（展示报告 + 风险场景）。

**Tech Stack:** viem (publicClient.call, getBalance), permissionless (Pimlico client), Node.js readline

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `week4/pre-tx-sim.ts` | 新建 | SimulationReport 类型 + runPreTxSimulation() + computeRiskLevel() + formatSimulationReport() |
| `week4/confirmation.ts` | 新建 | ConfirmationFn 类型 + getUserConfirmation() |
| `week4/agent-wallet.ts` | 改造 | 新增 AgentExecuteOptions，agentExecuteTransaction 集成 simulation + confirmation |
| `week4/index.ts` | 改造 | Step 7 展示 SimulationReport + 新增风险场景 |

---

### Task 1: 新建 `week4/pre-tx-sim.ts` — 核心模拟模块

**Files:**
- Create: `experiments/account-abstraction/week4/pre-tx-sim.ts`

- [ ] **Step 1: 写入完整代码**

```typescript
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
      }) => Promise<{ data: Hex }>;
      getBalance: (args: { address: Hex }) => Promise<bigint>;
      getBlock: () => Promise<{ number: bigint }>;
    };
  };
  smartAccountAddress: Hex;
  pimlicoClient: {
    getUserOperationGasPrice: () => Promise<{
      fast: { maxFeePerGas: string; maxPriorityFeePerGas: string };
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
    // 获取实时 gas 价格
    const { fast: gasPrice } =
      await wallet.pimlicoClient.getUserOperationGasPrice();

    let callGasLimit = 200_000n; // fallback
    let verificationGasLimit = 0n;
    let preVerificationGas = 0n;
    let paymasterSponsored = false;

    try {
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
      // gas 预估失败，使用 fallback
    }

    const maxFeePerGasBig = BigInt(gasPrice.maxFeePerGas);
    const maxPriorityFeePerGasBig = BigInt(gasPrice.maxPriorityFeePerGas);
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

  return {
    callSim: callResult,
    gasEstimate: gasResult,
    summary,
    riskLevel: "low", // computeRiskLevel 覆盖
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
```

- [ ] **Step 2: 编译检查**

```bash
cd experiments/account-abstraction && npx tsc --noEmit 2>&1 | head -20
```

Expected: 只有 `agent-wallet.ts` 的已有错误（如果有），`pre-tx-sim.ts` 本身无新错误。

- [ ] **Step 3: 提交**

```bash
git add experiments/account-abstraction/week4/pre-tx-sim.ts
git commit -m "feat: add pre-tx-sim module — SimulationReport types, runPreTxSimulation, computeRiskLevel, formatSimulationReport

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 新建 `week4/confirmation.ts` — 确认模块

**Files:**
- Create: `experiments/account-abstraction/week4/confirmation.ts`

- [ ] **Step 1: 写入完整代码**

```typescript
import * as readline from "readline";
import type { SimulationReport } from "./pre-tx-sim";
import { formatSimulationReport } from "./pre-tx-sim";

// === 可注入确认函数类型 ===
// 非 CLI 环境可注入 mock（如 async () => true）
export type ConfirmationFn = (
  report: SimulationReport,
  autoConfirm?: boolean
) => Promise<boolean>;

// === 默认实现：终端 y/n ===

function askYesNo(question: string, defaultYes = false): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hint = defaultYes ? "[y]/n" : "y/[n]";
  return new Promise((resolve) => {
    rl.question(`${question} ${hint}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "y" || trimmed === "yes") {
        resolve(true);
      } else if (trimmed === "n" || trimmed === "no") {
        resolve(false);
      } else {
        // 空输入或无效 → 默认值
        resolve(defaultYes);
      }
    });
  });
}

export async function getUserConfirmation(
  report: SimulationReport,
  autoConfirm = false
): Promise<boolean> {
  if (autoConfirm) {
    return true;
  }

  // low 风险：展示摘要，自动通过
  if (report.riskLevel === "low") {
    console.log(formatSimulationReport(report));
    return true;
  }

  // medium / high 风险：展示完整报告 + 询问用户
  console.log(formatSimulationReport(report));

  if (report.riskLevel === "high") {
    console.log("⚠ 风险等级为 HIGH，强烈建议拒绝此交易。");
  }

  return askYesNo("是否继续执行此交易？", false);
}
```

- [ ] **Step 2: 编译检查**

```bash
cd experiments/account-abstraction && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无新增错误。

- [ ] **Step 3: 提交**

```bash
git add experiments/account-abstraction/week4/confirmation.ts
git commit -m "feat: add confirmation module — ConfirmationFn type + getUserConfirmation with risk-based flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 改造 `week4/agent-wallet.ts` — 集成 simulation + confirmation

**Files:**
- Modify: `experiments/account-abstraction/week4/agent-wallet.ts`

- [ ] **Step 1: 添加 import**

在第 10 行（`import { safeGuardCheck, GuardCheck } from "./safe-guard";` 之后）新增两行 import：

```typescript
import { runPreTxSimulation, computeRiskLevel, SimulationReport } from "./pre-tx-sim";
import { getUserConfirmation, ConfirmationFn } from "./confirmation";
```

- [ ] **Step 2: 在类型定义区域（`AgentTransactionResult` 之前）新增 `AgentExecuteOptions`**

```typescript
export interface AgentExecuteOptions {
  /** 跳过交互确认（测试/CI 用），默认 false */
  autoConfirm?: boolean;
  /** 可注入确认函数（默认 getUserConfirmation） */
  confirmationFn?: ConfirmationFn;
}
```

- [ ] **Step 3: 修改 `AgentTransactionResult`，新增两个字段**

将：
```typescript
export interface AgentTransactionResult {
  guardCheck: GuardCheck;
  txHash?: Hex;
  etherscanUrl?: string;
  usage?: UsageTracker;
  error?: string;
}
```

改为：
```typescript
export interface AgentTransactionResult {
  guardCheck: GuardCheck;
  /** Pre-transaction 模拟结果（Safe Guard 通过后生成） */
  simulation?: SimulationReport;
  txHash?: Hex;
  etherscanUrl?: string;
  usage?: UsageTracker;
  error?: string;
  /** 用户是否确认了此交易（非链上最终状态）。autoConfirm 时为 true。 */
  confirmed?: boolean;
}
```

- [ ] **Step 4: 修改 `agentExecuteTransaction` 函数签名和流程**

将函数签名从：
```typescript
export async function agentExecuteTransaction(
  wallet: AgentWalletInstance,
  session: SessionKey,
  policy: PermissionPolicy,
  tx: TransactionRequest,
  usage: UsageTracker
): Promise<AgentTransactionResult> {
```

改为（新增第 6 个参数 `options`）：
```typescript
export async function agentExecuteTransaction(
  wallet: AgentWalletInstance,
  session: SessionKey,
  policy: PermissionPolicy,
  tx: TransactionRequest,
  usage: UsageTracker,
  options: AgentExecuteOptions = {}
): Promise<AgentTransactionResult> {
```

在函数体开头，解构 options：
```typescript
  const { autoConfirm = false, confirmationFn = getUserConfirmation } = options;
```

- [ ] **Step 5: 在 Safe Guard 通过后、发送交易前插入 simulation + confirmation**

找到这段代码（在原文件约第 93-95 行）：
```typescript
  // 2. 获取 Gas 价格（Pimlico v1 要求预填充）
  const { fast: gasPrice } = await wallet.pimlicoClient.getUserOperationGasPrice();

  // 3. 提交链上（gas 预填充 + paymaster 赞助）
```

替换为：
```typescript
  // 2. Pre-transaction Simulation
  const fromBalance = await wallet.smartAccount.client.getBalance({
    address: wallet.smartAccountAddress,
  });

  const simulation = await runPreTxSimulation(wallet, tx, fromBalance);
  simulation.riskLevel = computeRiskLevel(simulation);

  // 3. 用户确认
  const confirmed = await confirmationFn(simulation, autoConfirm);

  if (!confirmed) {
    return {
      guardCheck,
      simulation,
      confirmed: false,
      error: "用户拒绝此交易",
    };
  }

  // 4. 获取 Gas 价格（Pimlico v1 要求预填充）
  const { fast: gasPrice } = await wallet.pimlicoClient.getUserOperationGasPrice();

  // 5. 提交链上（gas 预填充 + paymaster 赞助）
```

- [ ] **Step 6: 更新发送成功后的返回值，加入 `simulation` 和 `confirmed`**

找到 `return {` 在 send 成功后（原约 110-116 行）：
```typescript
    return {
      guardCheck,
      txHash,
      etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
      usage: newUsage,
    };
```

改为：
```typescript
    return {
      guardCheck,
      simulation,
      txHash,
      etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
      usage: newUsage,
      confirmed: true,
    };
```

- [ ] **Step 7: 更新发送失败后的返回值**

将 catch 块中的：
```typescript
  } catch (err: any) {
    return {
      guardCheck,
      error: `链上执行失败：${err.message || err}`,
    };
  }
```

改为：
```typescript
  } catch (err: any) {
    return {
      guardCheck,
      simulation,
      confirmed: true,
      error: `链上执行失败：${err.message || err}`,
    };
  }
```

- [ ] **Step 8: 编译检查**

```bash
cd experiments/account-abstraction && npx tsc --noEmit 2>&1 | head -30
```

Expected: 无编译错误。

- [ ] **Step 9: 提交**

```bash
git add experiments/account-abstraction/week4/agent-wallet.ts
git commit -m "feat: integrate pre-tx simulation and confirmation into agentExecuteTransaction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 改造 `week4/index.ts` — 展示 SimulationReport + 风险场景

**Files:**
- Modify: `experiments/account-abstraction/week4/index.ts`

- [ ] **Step 1: 新增 import**

在第 17 行（`import { initAgentWallet, agentExecuteTransaction, AgentWalletInstance } from "./agent-wallet";` 之后）新增：

```typescript
import { formatSimulationReport } from "./pre-tx-sim";
```

- [ ] **Step 2: 在 Step 7 的 7d 之后增加 simulation 报告展示**

找到 Step 7 中 `const result = await agentExecuteTransaction(...)` 这一行（约 178-184 行），将：
```typescript
      // 7d. Safe Guard 校验 + 链上执行
      const result = await agentExecuteTransaction(
        wallet,
        agentKey,
        chainPolicy,
        chainTx,
        freshUsage
      );
```

改为（`await` 已含 simulation + confirmation 步骤）：
```typescript
      // 7d. Safe Guard 校验 → Simulation → 用户确认 → 链上执行
      const result = await agentExecuteTransaction(
        wallet,
        agentKey,
        chainPolicy,
        chainTx,
        freshUsage
        // 不传 options，使用默认 confirm（终端交互）
      );
```

- [ ] **Step 3: 展示 SimulationReport**

在 `console.log(formatGuardResult(result.guardCheck));` 之后、`if (result.txHash)` 之前，新增：

```typescript
      // 展示 SimulationReport（已包含在 agentExecuteTransaction 流程中）
      if (result.simulation) {
        // formatSimulationReport 已在 confirmation 中调用过，
        // 这里只在 autoConfirm 模式下额外展示
      }
```

实际不需要额外展示（`getUserConfirmation` 内部已调用 `formatSimulationReport`），但为了代码清晰，保留 `simulation` 字段的可用性。

- [ ] **Step 4: 更新交易成功输出，加入 simulation 确认信息**

找到：
```typescript
      if (result.txHash) {
        console.log(`\n✓ 链上交易已提交！`);
```

改为：
```typescript
      if (result.txHash) {
        if (result.confirmed) {
          console.log(`\n✓ 用户已确认，链上交易已提交！`);
        } else {
          console.log(`\n✓ 链上交易已提交！`);
        }
```

- [ ] **Step 5: 新增 autoConfirm=true 的快速路径场景**

在 Step 7 的 try 块末尾（`} catch (err: any) {...}` 之前），新增 Step 8：

```typescript
      // === 场景 8：autoConfirm 快速路径 ===

      divider("Step 8: autoConfirm=true — 跳过交互确认 🚀");

      try {
        const quickPolicy: PermissionPolicy = {
          ...TEST_POLICY,
          validFrom: Math.floor(Date.now() / 1000) - 60,
          validUntil: Math.floor(Date.now() / 1000) + 86400,
        };
        const { sessionKey: quickKey } = createSessionKey(quickPolicy);
        saveSessionKey({ sessionKey: quickKey, privateKey }); // 复用 ownerPk

        const quickTx: TransactionRequest = {
          to: wallet.smartAccountAddress,
          value: parseEther("0"),
          data: "0x",
        };

        const quickUsage = createEmptyUsageTracker();

        console.log("autoConfirm=true，将跳过终端确认直接执行...");
        const quickResult = await agentExecuteTransaction(
          wallet,
          quickKey,
          quickPolicy,
          quickTx,
          quickUsage,
          { autoConfirm: true }
        );

        console.log(formatGuardResult(quickResult.guardCheck));

        if (quickResult.simulation) {
          console.log(formatSimulationReport(quickResult.simulation));
        }

        if (quickResult.txHash) {
          console.log(`\n✓ autoConfirm 模式交易已提交！`);
          console.log(`  Tx Hash: ${quickResult.txHash}`);
          console.log(`  Etherscan: ${quickResult.etherscanUrl}`);
        } else if (quickResult.error) {
          console.log(`\n✗ ${quickResult.error}`);
        }
      } catch (err: any) {
        console.log(`autoConfirm 场景出错: ${err.message || err}`);
      }
```

- [ ] **Step 6: 更新末尾总结**

找到底部的总结部分，更新场景计数：

```typescript
  console.log(`Safe Agent Wallet 完整流程验证：`);
  console.log(`  ✓ Session Key 创建 + 七维策略绑定`);
  console.log(`  ✓ 合法交易通过本地校验`);
  console.log(`  ✓ 超限交易被本地拒绝`);
  console.log(`  ✓ 未授权函数被本地拒绝`);
  console.log(`  ✓ 撤销后交易被本地拒绝`);
  console.log(`  ✓ Safe Guard → Simulation → Confirm → Smart Account → Sepolia 链上执行`);
  console.log(`  ✓ autoConfirm 快速路径（跳过交互确认）`);
  console.log(`\n四层架构：Safe Guard（前置拦截）→ Pre-tx Simulation（新增）→ Session Key（权限签名）→ Smart Account（链上执行）`);
```

- [ ] **Step 7: 编译检查**

```bash
cd experiments/account-abstraction && npx tsc --noEmit 2>&1
```

Expected: 无编译错误。

- [ ] **Step 8: 提交**

```bash
git add experiments/account-abstraction/week4/index.ts
git commit -m "feat: update index.ts — display SimulationReport, add autoConfirm scenario, update summary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 编译 + 运行验证

**Files:** 无新建/修改，仅运行验证

- [ ] **Step 1: 完整编译**

```bash
cd experiments/account-abstraction && npx tsc
```

Expected: 编译成功，生成 `week4/pre-tx-sim.js`、`week4/confirmation.js`，更新 `week4/agent-wallet.js`、`week4/index.js`。

- [ ] **Step 2: 运行完整流程**

```bash
cd experiments/account-abstraction && npm run week4
```

Expected: 8 个场景全部通过。
- Step 1-6: 本地校验（不变）
- Step 7: 链上执行时展示 SimulationReport → 终端 y/n 确认 → 执行
- Step 8: autoConfirm 模式直接执行

- [ ] **Step 3: 检查输出中包含 SimulationReport**

验证终端输出出现了：
```
══════════════════════════════════════════════════
  Pre-transaction Simulation 报告
══════════════════════════════════════════════════
链上模拟：✓ 成功（区块 #...）
  发送方余额变化：...
Gas 预估：
  ...
风险等级：🟢 LOW
摘要：...
══════════════════════════════════════════════════
```

- [ ] **Step 4: 提交**

```bash
git add experiments/account-abstraction/week4/*.js
git commit -m "feat: compiled JS output for pre-tx simulation modules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
