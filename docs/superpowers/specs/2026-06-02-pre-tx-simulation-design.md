# Pre-transaction Simulation — 设计文档

**日期**：2026-06-02
**项目**：Safe Agent Wallet（Wallet / Permission Track）
**状态**：待实现

---

## 1. 问题

当前 `agentExecuteTransaction()` 在 Safe Guard 校验通过后直接发送链上交易，中间缺少一步：**让用户看到交易模拟结果，然后决定是否执行**。

### 设计原则（来自项目 design.md）

> "关键字段必须来自结构化解析和链上模拟，不能只靠 Agent 的自然语言总结"
> "用户可以对比'Agent 说的'和'链上模拟实际会发生的'是否一致"

## 2. 目标

在 Safe Guard 通过后、链上执行前，插入 Pre-transaction Simulation 步骤：
- **A 路径（eth_call）**：链上模拟目标调用，获取余额变化、是否 revert
- **B 路径（bundler estimate）**：获取完整 4337 gas 预估 + paymaster 状态
- 合并为结构化 `SimulationReport`
- 按 `riskLevel` 分级确认（low 自动通过，medium/high 弹确认）

## 3. 架构

```
agentExecuteTransaction() 改造后流程：

  Safe Guard 校验
    → runPreTxSimulation() — A+B 并行模拟
    → computeRiskLevel() — 聚合风险指标
    → formatSimulationReport() — CLI 渲染
    → getUserConfirmation() — 按 riskLevel 确认
    → send UserOp → wait receipt
```

新模块插入位置：

```
Safe Guard（前置拦截）→ Pre-tx Simulation（新增）→ Smart Account（链上执行）
```

## 4. 模块设计

### 4.1 新增文件

```
week4/
  pre-tx-sim.ts        # SimulationReport 类型 + runPreTxSimulation() + computeRiskLevel()
  confirmation.ts      # ConfirmationFn 类型 + getUserConfirmation()
  agent-wallet.ts      # 改造：集成 simulation + confirmation
  index.ts             # 改造：Step 7 展示 SimulationReport
```

### 4.2 `pre-tx-sim.ts` — 核心模拟模块

#### 类型定义

```typescript
interface BalanceChange {
  address: string;         // 涉及地址
  asset: string;           // "ETH" | token 地址
  before: bigint;
  after: bigint;
  delta: bigint;           // 正=收到，负=支出
}

interface SimulationReport {
  callSim: {
    success: boolean;
    revertReason?: string;
    balanceChanges: BalanceChange[];
    fromBalanceChange: BalanceChange | null;  // sender 余额变化（便捷提取）
    simulatedAtBlock: bigint;                  // 模拟时区块号
  };

  gasEstimate: {
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    estimatedTotalGas: bigint;       // gasLimit × maxFeePerGas
    estimatedTotalEth: string;       // "~0.0003 ETH"
    paymasterSponsored: boolean;
  };

  summary: string;
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
}
```

#### 导出函数

| 导出 | 签名 | 说明 |
|------|------|------|
| `runPreTxSimulation()` | `(wallet, tx, fromBalance) => Promise<SimulationReport>` | A+B 并行，返回完整报告 |
| `computeRiskLevel()` | `(report: SimulationReport) => "low" \| "medium" \| "high"` | 纯函数，单测友好 |
| `formatSimulationReport()` | `(report: SimulationReport) => string` | CLI 终端渲染 |

#### `runPreTxSimulation()` 实现要点

- **A 路径**：用 `publicClient.call()` 对 `tx.to` 做 `eth_call`；调用前后各查一次 `getBalance()` 获取余额变化
- **B 路径**：用 `pimlicoClient.getUserOperationGasPrice()` 获取 gas 价格（已在用），加一次 `estimateUserOperationGas()` 获取完整 gas 字段
- 两个路径 `Promise.all` 并行，互不依赖
- `paymasterSponsored`：检查 bundler 返回的 `paymasterAndData !== "0x"`

#### `computeRiskLevel()` 判定规则（按优先级）

| 优先级 | 条件 | riskLevel |
|--------|------|-----------|
| 1 | `callSim.success === false` | `high` — 交易必定 revert |
| 2 | warnings 包含"余额不足" | `high` |
| 3 | gas 费用 > from 余额的 20% | `medium` — gas 占比偏高 |
| 4 | 其他 | `low` |

#### `formatSimulationReport()` CLI 输出示例

```
═══════════════════════════════════════════════════════════
  Pre-transaction Simulation 报告
═══════════════════════════════════════════════════════════
链上模拟：✓ 成功（区块 #6123456）
  发送方余额变化：0.01 ETH → 0.0097 ETH（-0.0003 ETH）

Gas 预估：
  Gas Limit:      150,000
  Max Fee:        2.5 gwei
  预估总 Gas:     ~0.0003 ETH
  Paymaster:      赞助 ✓

风险等级：🟢 LOW
摘要：将发送 0 ETH 给自己，gas ~0.0003 ETH（Paymaster 赞助）
═══════════════════════════════════════════════════════════
```

### 4.3 `confirmation.ts` — 确认模块

```typescript
type ConfirmationFn = (
  report: SimulationReport,
  autoConfirm?: boolean
) => Promise<boolean>;

async function getUserConfirmation(
  report: SimulationReport,
  autoConfirm = false
): Promise<boolean>;
```

**行为：**

| riskLevel | autoConfirm=true | autoConfirm=false |
|-----------|-----------------|-------------------|
| `low` | 直接返回 true | 展示摘要，返回 true（不阻塞） |
| `medium` | 直接返回 true | 展示报告 + `y/n` 确认（默认 n） |
| `high` | 直接返回 true | 展示报告 + 警告 + `y/n` 确认（默认 n），提示"建议拒绝" |

终端交互用 Node.js 内置 `readline` 模块。

### 4.4 `agent-wallet.ts` — 改造

#### 新增类型

```typescript
interface AgentExecuteOptions {
  autoConfirm?: boolean;
  confirmationFn?: ConfirmationFn;  // 默认 getUserConfirmation
}

interface AgentTransactionResult {
  guardCheck: GuardCheck;
  simulation?: SimulationReport;    // 新增
  txHash?: Hex;
  etherscanUrl?: string;
  usage?: UsageTracker;
  error?: string;
  /** 用户是否确认了此交易（非链上最终状态）。autoConfirm 时为 true。 */
  confirmed?: boolean;              // 新增
}
```

#### `agentExecuteTransaction()` 新流程

```
1. Safe Guard 校验（不变）
2. 获取 from 余额 → runPreTxSimulation()
3. computeRiskLevel()
4. getUserConfirmation()
5. 若确认 → 发送 UserOperation → 等回执
6. 若拒绝 → 返回 { confirmed: false, error: "用户拒绝" }
```

### 4.5 `index.ts` — 场景改造

Step 7 调整为展示完整模拟报告，增加测试场景：

| 场景 | 预期 riskLevel | 预期行为 |
|------|---------------|----------|
| 正常 0 ETH 给自己 | low | 自动继续 |
| 模拟 revert（构造无效调用） | high | 弹确认 + 建议拒绝 |
| autoConfirm=true | — | 不弹确认，直接执行 |

## 5. 依赖

无新增 npm 依赖。使用已有：
- `viem` — `publicClient.call()`, `getBalance()`
- `permissionless` — `pimlicoClient.getUserOperationGasPrice()`, `estimateUserOperationGas()`
- Node.js 内置 `readline`

## 6. 不做（范围外）

- 不做 ERC20 token 余额查询（当前 MVP 只有 ETH）
- 不做 Tenderly Simulation API 集成（当前 eth_call 够用）
- 不做前端 UI 确认弹窗（预留 `ConfirmationFn` 注入点即可）
- 不做交易失败后的自动重试

## 7. 实现顺序

1. 新建 `pre-tx-sim.ts`：类型 + `runPreTxSimulation()` + `computeRiskLevel()` + `formatSimulationReport()`
2. 新建 `confirmation.ts`：`ConfirmationFn` + `getUserConfirmation()`
3. 改造 `agent-wallet.ts`：集成 simulation + confirmation
4. 改造 `index.ts`：Step 7 展示报告 + 新增风险场景
5. 运行 `npm run week4` 验证全部场景通过
