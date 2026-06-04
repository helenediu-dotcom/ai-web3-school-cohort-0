# Safe Agent Wallet 前端 UI — 设计文档

**日期**：2026-06-04
**状态**：待实现

---

## 1. 目标

给 Safe Agent Wallet MVP 加一个 Web 前端，支持「发起交易 → Safe Guard 校验 → Simulation 报告 → 用户确认 → 链上执行」的完整链路。

## 2. 架构

Next.js 单项目，API Routes 直接 import 现有 TypeScript 业务模块，React 页面做 UI。一个 `npm run dev` 全部跑起来。

```
experiments/account-abstraction/
├── week4/                          # 现有代码，不动
│   ├── permission-policy.ts
│   ├── session-key.ts
│   ├── safe-guard.ts
│   ├── pre-tx-sim.ts
│   ├── agent-wallet.ts
│   └── confirmation.ts
└── frontend/                       # 新增
    ├── package.json
    ├── tsconfig.json
    ├── next.config.js
    ├── app/
    │   ├── layout.tsx              # 根布局
    │   ├── page.tsx                # 主页面（状态管理 + 流程编排）
    │   └── api/
    │       └── execute/
    │           └── route.ts        # POST /api/execute
    └── components/
        ├── TxForm.tsx              # 交易输入表单
        ├── GuardResult.tsx         # Safe Guard 检查结果卡片
        ├── SimulationReport.tsx    # 模拟报告展示
        └── TxResult.tsx            # 最终交易结果
```

## 3. 页面布局

单页面，三段式从上到下，按流程阶段逐步展示：

1. **TxForm**：目标地址、金额、data 字段 + 执行按钮
2. **GuardResult**：执行后显示（安全检查结果，通过/拒绝，含灰区提醒）
3. **SimulationReport**：Safe Guard 通过后显示（链上模拟结果、gas 预估、风险等级）
4. **确认区**：simulation 通过后显示（确认并执行 / 取消按钮）
5. **TxResult**：链上执行后显示（tx hash、Etherscan 链接或错误信息）

流程：填表单 → 点执行 → 后端 Guard + Sim → 渲染 ②③ → 点确认 → 后端发链上交易 → 渲染 ⑤。

错误路径：Safe Guard 拒绝时只显示 ②（红色），不显示 ③④⑤。

## 4. API

仅一个接口：

```
POST /api/execute
```

Request:

```json
{
  "to": "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
  "value": "0.001",
  "data": "0x",
  "autoConfirm": false
}
```

两阶段调用：

1. `autoConfirm: false` → 后端跑 Safe Guard + Simulation，返回 guard 结果和 simulation 报告
2. 用户确认后，`autoConfirm: true`（同样的 body）→ 后端直接执行链上交易，**不再重复 guard 和 simulation**（假设前端已展示并通过检查）

Response（`autoConfirm: false`）：

```json
{
  "stage": "guard_passed" | "guard_rejected" | "simulation_failed",
  "guardCheck": { "passed": true, "checks": [...], "requiresHumanReview": false },
  "simulation": {
    "success": true,
    "callSim": {...},
    "gasEstimate": {...},
    "riskLevel": "low",
    "error": "模拟失败原因（仅 simulation_failed 时有）"
  }
}
```

stage 说明：
- `guard_passed`：Safe Guard 通过 + Simulation 成功，前端展示报告和确认按钮
- `guard_rejected`：Safe Guard 硬约束不通过，前端展示拒绝原因，不展示 simulation
- `simulation_failed`：Safe Guard 通过但 Simulation 执行失败（如 eth_call revert），前端展示 guard 结果 + simulation.error

Response（`autoConfirm: true`）：

```json
{
  "stage": "executed" | "execution_failed",
  "txHash": "0x...",
  "etherscanUrl": "https://sepolia.etherscan.io/tx/0x...",
  "error": "执行失败原因（仅 execution_failed 时有）"
}
```

注意：`autoConfirm: true` 时后端不返回 guardCheck 和 simulation（不重复跑），前端已在第一阶段持有这些数据。

## 5. 数据流

```
用户填表单
  → POST /api/execute { autoConfirm: false }
    → API Route: initAgentWallet + createSessionKey + safeGuardCheck + runPreTxSimulation
    → 返回 guardCheck + simulation + stage
  → 前端根据 stage 渲染：
      - guard_rejected → GuardResult（红色拒绝）+ 终止
      - simulation_failed → GuardResult + SimulationReport（含 error）+ 终止
      - guard_passed → GuardResult + SimulationReport + 确认按钮
  → 用户点确认
    → POST /api/execute { autoConfirm: true }
      → API Route: 直接构造 UserOp → Bundler → 链上执行（不重复 guard/simulation）
      → 返回 stage + txHash + etherscanUrl
    → 前端渲染 TxResult
```

## 6. 状态管理

page.tsx 用一个 state machine：

```
idle → loading_guard → guard_result → (用户确认) → loading_execute → tx_result
              ↓              ↓
         guard_rejected   simulation_failed
           （终止）         （终止）
```

## 7. 环境变量

`frontend/.env.local`：

```env
# Pimlico Bundler + Paymaster API Key
# 从 https://dashboard.pimlico.io 获取
PIMLICO_API_KEY=pim_xxxx

# Agent Session Key 私钥（0x 开头，64 字符 hex）
# 用于 Session Key 对 UserOperation 签名
# 注意：这是 Agent 的受限密钥，不是 EOA 主钱包私钥
PRIVATE_KEY=0x...

# EOA 主钱包私钥（0x 开头，64 字符 hex）
# 拥有 Smart Account 的 EOA，用于部署和初始化 Smart Account
OWNER_PRIVATE_KEY=0x...
```

变量用途：
- `PIMLICO_API_KEY`：连接 Pimlico Bundler 和 Paymaster
- `PRIVATE_KEY`：Agent Session Key 的私钥，用于签名 UserOperation（受限密钥，非主钱包）
- `OWNER_PRIVATE_KEY`：拥有 Smart Account 的 EOA 私钥，用于初始化和部署 Smart Account

如果缺少任一变量，API 返回 500 并提示缺失的变量名。

## 8. 边界

- Session Key 在后端内存创建（每次请求一个，demo 用），不持久化
- 不做 WalletConnect / MetaMask 连接（MVP 范围外）
- 不处理多 Agent、多 Session Key 管理（v0.2）
- 只支持 Sepolia 测试网

## 9. 技术栈

- Next.js (App Router)
- React 18 + TypeScript
- 直接复用 week4 业务模块（不重写）
- CSS Modules（默认支持，无额外依赖）
