# Safe Agent Wallet — Hackathon 演示总结

## 项目概述

**Safe Agent Wallet** 是一个 AI Agent 链上操作的安全沙箱。核心理念：**Agent 不应该拥有"钱包"，它只应该拥有一组可限制、可审计、可撤销的链上能力。**

Track：Wallet / Permission

---

## 解决的痛点

传统做法把 EOA 私钥给 Agent → Agent 拥有无限权力。三个风险：
- Prompt Injection 诱导恶意操作
- 模型幻觉导致错误交易
- 用户对 Agent 行为黑箱不可见

Safe Agent Wallet 用 **Smart Account + Session Key + Safe Guard** 三层架构解决这三个问题。

---

## 架构设计

```
┌──────────────────────────────────────────────────────┐
│                    用户（EOA 主钱包）                    │
│              持有私钥，拥有 Smart Account 所有权          │
└─────────────────────┬────────────────────────────────┘
                      │ 创建 + 授权
                      ▼
┌──────────────────────────────────────────────────────┐
│              Safe Agent Wallet（Smart Account）         │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │           Session Key（时控 + 权限绑定）           │  │
│  │  · 七维约束：资产/金额/合约/函数/价格/时间/频率       │  │
│  │  · 有效期 24h，额度用完自动失效                      │  │
│  │  · 用户可随时手动撤销                               │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │ Agent 发起交易                  │
│                       ▼                               │
│  ┌────────────────────────────────────────────────┐  │
│  │              Safe Guard（守卫层）                  │  │
│  │  · 硬约束：额度/合约白名单/有效期 → 自动拒绝          │  │
│  │  · 灰区：价格偏离/新合约 → 升级人工确认               │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │ 通过                          │
│                       ▼                               │
│  ┌────────────────────────────────────────────────┐  │
│  │       Pre-Tx Simulation（签名前模拟）              │  │
│  │  · eth_call 链上模拟：余额变化 + 是否 revert        │  │
│  │  · Gas 预估：Bundler 并行查询                      │  │
│  │  · 风险分级：LOW / MEDIUM / HIGH                  │  │
│  │  · 结构化数据渲染，不靠 Agent 自然语言总结            │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │ 确认                          │
│                       ▼                               │
│                 链上执行（Sepolia）                      │
└──────────────────────────────────────────────────────┘
```

---

## 技术实现

| 层 | 技术 | 用途 |
|---|---|---|
| 钱包 | ERC-4337 Smart Account（permissionless.js + Pimlico） | 支持 Session Key + UserOperation |
| 链 | Sepolia Testnet | 测试网验证 |
| 前端 | Next.js 14 App Router + TypeScript | 状态机驱动 UI（idle → guard → sim → confirm → execute） |
| API | Next.js Route Handler（/api/execute） | Phase 1（guard + sim）+ Phase 2（链上执行） |
| Bundler | Pimlico | UserOperation 中继 + Paymaster |
| RPC | publicnode（ethereum-sepolia-rpc.publicnode.com） | 国内访问稳定 |

### 关键模块（全部从零实现）

| 模块 | 文件 | 功能 |
|---|---|---|
| Agent Wallet | `week4/agent-wallet.ts` | Smart Account 初始化、Bundler/Paymaster 连接 |
| Permission Policy | `week4/permission-policy.ts` | 七维约束校验引擎 |
| Session Key | `week4/session-key.ts` | Session Key 创建、存储、签名、撤销 |
| Safe Guard | `week4/safe-guard.ts` | 两层守卫：硬约束 + 灰区 |
| Pre-Tx Simulation | `week4/pre-tx-sim.ts` | eth_call 模拟 + Gas 预估 + 风险分级 |
| Confirmation | `week4/confirmation.ts` | 按风险等级自动/交互确认 |

---

## 演示流程（5 步走）

### ① 交易输入
用户输入：`to` 地址 + `value` 金额（ETH）+ 可选 `data`

### ② Safe Guard 检查
七维约束逐一校验，通过/拒绝逐条展示：
- 资产范围 ✓/✗
- 金额上限 ✓/✗
- 目标合约 ✓/✗
- 函数范围 ✓/✗
- 时间窗口 ✓/✗
- 频率限制 ✓/✗
- 价格约束 ✓/✗

任一硬约束拒绝 → 直接拦截，不进入后续流程。

### ③ Simulation 报告
链上模拟结果结构化展示：
- 余额变化：0.05 → 0.049 ETH
- Gas 预估：~0.0001086 ETH
- 风险等级：LOW
- 是否有 revert
- Paymaster 赞助状态

### ④ 用户确认
查看 guard + simulation 结果后，点击"确认并执行"。

### ⑤ 链上执行
- 提交 UserOperation → Bundler 中继 → 链上执行
- 返回 txHash + Etherscan 链接
- 验证链接：[Sepolia Etherscan](https://sepolia.etherscan.io/tx/0x73b15d4ef83c9a222760b4ca17516f581ac1a2227b093368ff86977e83d6c26e)

---

## 关键数据

| 指标 | 数值 |
|---|---|
| 已部署 Smart Account 地址 | `0x2c6C092c198536c990144A6A0Ec0e2a0896204B6` |
| 验证交易 txHash | `0x73b15d4ef83c9a222760b4ca17516f581ac1a2227b093368ff86977e83d6c26e` |
| 已实现权限维度 | 7（资产 / 金额 / 合约 / 函数 / 价格 / 时间 / 频率） |
| 守卫层判断 | 2 层（硬约束自动拒绝 + 灰区人工确认） |
| Simulation 路径 | 2 路并行（A: eth_call 链上模拟 + B: Bundler gas 预估） |
| 风险分级 | 3 级（LOW / MEDIUM / HIGH） |
| 前端状态机步骤 | 5 步（idle → guard → sim → confirm → execute） |
| 学习总天数 | 20 天，从 AI/Web3 零基础到 ERC-4337 链上执行 |

---

## 开发时间线

| 日期 | Day | 内容 |
|---|---|---|
| 2026-05-29 | Day 12 | 项目启动，选定 Track，设计文档 |
| 2026-05-30 | Day 13 | Session Key + Permission Policy 代码实现 |
| 2026-05-31~06-01 | Day 14-15 | Smart Account 链上执行接入 |
| 2026-06-02 | Day 16 | Pre-Tx Simulation + Confirmation |
| 2026-06-03 | Day 17 | 项目总结 & 收尾 |
| 2026-06-04 | Day 18 | 前端 UI（Next.js + 状态机） |
| 2026-06-05 | Day 19 | 前端联调 & 链上验证 |
| 2026-06-06 | Day 20 | Hackathon 总结材料 |

---

## 学习收获

### 概念理解
- **ERC-4337**：UserOperation 结构、Bundler 中继、EntryPoint 验证、Paymaster 赞助
- **Smart Account**：为什么"钱包是合约"比"钱包是密钥对"更适合 Agent
- **Session Key**：时控 + 权限绑定的临时密钥，不是长期授权
- **Permission Policy**：权限不是"能不能转账"的二元开关，是七维矩阵

### 工程实践
- discriminated union 类型定义必须和运行时 JSON 数据一致，不能只靠 TypeScript 编译检查
- RPC 节点选择对可靠性影响很大（国内访问海外 RPC 选公共节点比单一第三方更稳定）
- Paymaster 赞助的是 gas，不赞助转账金额——Smart Account 余额必须 ≥ 转账金额
- 状态机驱动 UI 适合有明确流程的多步操作（5 步链式流程）

---

## MVP 范围完成度

| 功能 | 状态 |
|---|---|
| 部署 ERC-4337 Smart Account | ✅ |
| 创建七维约束 Session Key | ✅ |
| Agent 通过 Session Key 发起转账 | ✅ |
| Safe Guard 硬约束拒绝验证 | ✅ |
| Pre-Tx Simulation 结构化展示 | ✅ |
| 一键撤销 Session Key | ✅ |
| 用户交互界面（意图/权限/风险/撤销） | ✅ |

---

## v0.2 方向（未实现）

- Human-in-the-loop：大额交易用户确认
- 日累计追踪在前端展示
- Session 缓存 TTL（生产环境 Redis）
- Paymaster 赞助生效（当前 Pimlico plan 不支持）
- 多 Agent 管理
- 灰区自动决策规则
