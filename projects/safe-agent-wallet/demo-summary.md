# Safe Agent Wallet — Hackathon 演示总结

## 项目概述

**Safe Agent Wallet** 是一个 AI Agent 链上操作的安全沙箱。核心理念：**Agent 不应该拥有"钱包"，它只应该拥有一组可限制、可审计、可撤销的链上能力。**

Track：Wallet / Permission（衍生覆盖 Agentic Commerce）

---

## 解决的痛点

传统做法把 EOA 私钥给 Agent → Agent 拥有无限权力。三个风险：
- Prompt Injection 诱导恶意操作
- 模型幻觉导致错误交易
- 用户对 Agent 行为黑箱不可见

Safe Agent Wallet 用 **Smart Account + Session Key + 六层安全流水线** 解决这三个问题。

---

## 架构设计

```
用户（EOA 主钱包）
  │
  ├── Smart Account（ERC-4337 合约钱包，持有资产）
  │     │
  │     ├── Session Key #1 → Agent A（限额 0.005 ETH/天，白名单合约）
  │     ├── Session Key #2 → Agent B（只读）
  │     └── 用户 EOA 保持主控权（随时撤销）

每笔 Agent 交易经过六层安全流水线：

  ① Session Key 状态检查 ──→ 过期/撤销 → 拒绝
  ② Permission Policy（七维约束）──→ 超限 → 拒绝
  ③ Safe Guard（硬约束 + 软约束）──→ 硬失败 → 拒绝；软触发 → 标记
  ④ Pre-tx Simulation（eth_call + gas 并行）──→ revert → CRITICAL
  ⑤ 风险分流：CRITICAL 拒绝 / HIGH 人工 / MEDIUM 灰区引擎 / LOW 自动 / TRIVIAL 静默
  ⑥ 链上执行（ERC-4337 UserOp → Bundler → EntryPoint → Sepolia）
```

---

## 技术实现

| 层 | 技术 | 用途 |
|---|---|---|
| 钱包 | ERC-4337 Smart Account（permissionless.js + Pimlico） | Session Key + UserOperation |
| 链 | Sepolia Testnet | 测试网验证 |
| 前端 | Next.js 14 App Router + TypeScript | 状态机驱动 UI（idle → guard → sim → confirm → execute） |
| API | Next.js Route Handler（/api/execute） | Phase 1（guard + sim）+ Phase 2（链上执行） |
| Bundler | Pimlico | UserOperation 中继 + Paymaster |
| RPC | publicnode | 国内访问稳定 |

### 核心模块（8 个，全部从零实现）

| 模块 | 文件 | 功能 |
|------|------|------|
| Session Key | `session-key.ts` | 临时密钥创建、生命周期管理、撤销 |
| Permission Policy | `permission-policy.ts` | 七维约束校验引擎 + 用量追踪 |
| Safe Guard | `safe-guard.ts` | 两层守卫：硬约束拒绝 + 软约束标记 |
| Pre-tx Simulation | `pre-tx-sim.ts` | eth_call 模拟 + Gas 预估 + 5 级风险分级 |
| Grey Zone | `grey-zone.ts` | 7 条确定性规则自动决策（不调 LLM） |
| Confirmation | `confirmation.ts` | 5 级风险分流 + 可注入确认函数 |
| Agent Wallet | `agent-wallet.ts` | Smart Account 初始化 + 流水线编排 |
| Agentic Checkout | `commerce/agentic-checkout.ts` | Agent 自主支付 API 数据闭环 |

---

## 演示流程

### ① 交易输入
用户/Agent 输入：`to` + `value` + 可选 `data`

### ② Safe Guard 检查
七维约束逐一校验，通过/拒绝逐条展示：
- Session Key 状态 ✓/✗
- 权限策略（资产/金额/合约/函数/时间/频率）✓/✗
- 软约束（零值调用、白名单未设置）⚠

任一硬约束拒绝 → 直接拦截，不进入后续流程。

### ③ Simulation 报告
链上模拟结果结构化展示：
- 余额变化（发送方 + 接收方）
- Gas 预估（Call + Verification + PreVerification）
- 风险等级：CRITICAL / HIGH / MEDIUM / LOW / TRIVIAL
- 是否有 revert
- Paymaster 赞助状态

### ④ 风险分流决策
- **CRITICAL** → 自动拒绝
- **HIGH** → 强制人工确认
- **MEDIUM** → 灰区引擎自动决策（7 条规则）
- **LOW** → 展示摘要，自动通过
- **TRIVIAL** → 静默通过

### ⑤ 链上执行
- 提交 UserOperation → Bundler 中继 → 链上执行
- 返回 txHash + Etherscan 链接

---

## 关键数据

| 指标 | 数值 |
|------|------|
| 已部署 Smart Account 地址 | `0x2c6C092c198536c990144A6A0Ec0e2a0896204B6` |
| 验证交易 txHash | `0x73b15d4ef83c9a222760b4ca17516f581ac1a2227b093368ff86977e83d6c26e` |
| Agentic Commerce 验证 txHash | `0xee353545976c2c5830ef598c35c20b4cadbf91d667048cba76b3628b883955f2` |
| 已实现模块 | 8 个（~1,900 行 TypeScript） |
| 权限维度 | 7（资产/金额/合约/函数/价格/时间/频率） |
| 安全流水线 | 6 层（Session Key → Policy → Guard → Sim → Risk Split → Execute） |
| 风险等级 | 5 级（CRITICAL / HIGH / MEDIUM / LOW / TRIVIAL） |
| 灰区规则 | 7 条确定性规则 |
| Simulation 路径 | 2 路并行（A: eth_call + B: Bundler gas） |
| 场景验证 | Agentic Commerce 8 场景全部通过 |
| 安全模块复用率 | 100%（Agent 转账 → Agent 支付 API 零改动） |

---

## MVP 完成度

| 功能 | 状态 |
|------|------|
| ERC-4337 Smart Account 部署 | ✅ |
| 七维约束 Session Key | ✅ |
| Agent 通过 Session Key 发起交易 | ✅ |
| Safe Guard 硬约束拒绝验证 | ✅ |
| Safe Guard 软约束标记 | ✅ |
| Pre-tx Simulation（eth_call + gas 并行） | ✅ |
| 5 级风险分级 | ✅ |
| 灰区规则引擎自动决策 | ✅ |
| 5 级风险分流确认 | ✅ |
| 一键撤销 Session Key | ✅ |
| Agentic Commerce 支付闭环 | ✅ |
| Gas 占比 → high 路径确定性验证 | ✅ |
| 用户交互界面（意图/权限/风险/撤销） | ✅ |

---

## 学习收获

### 概念理解
- **ERC-4337**：UserOperation 结构、Bundler 中继、EntryPoint 验证、Paymaster 赞助
- **Smart Account**：为什么"钱包是合约"比"钱包是密钥对"更适合 Agent
- **Session Key**：时控 + 权限绑定的临时密钥，不是长期授权
- **Permission Policy**：权限不是"能不能转账"的二元开关，是七维矩阵
- **Agentic Commerce**：六层协议栈中，信任层和授权层是最难标准化但最关键的两层

### 工程实践
- discriminated union 类型定义必须和运行时 JSON 数据一致
- RPC 节点选择对可靠性影响很大（国内用公共节点比单一第三方更稳定）
- Paymaster 赞助的是 gas，不赞助转账金额——Smart Account 余额必须 ≥ 转账金额
- 安全层和业务层应该分离：从"Agent 转账"切换到"Agent 支付 API"，所有安全模块零改动
- 确定性规则优先于 LLM 判断：Guard 层不调 LLM，灰区引擎 7 条规则全部确定性
