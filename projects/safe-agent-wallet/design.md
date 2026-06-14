# Safe Agent Wallet — 项目设计文档

## 一句话描述

Agent 不应该拥有"钱包"，它只应该拥有一组可限制、可审计、可撤销的链上能力。

---

## 1. 问题定义

### 现状

- AI Agent 要操作链上资产（转账、swap、支付 API），传统做法是给它 EOA 私钥
- 私钥 = 无限权力，Agent 可以花掉所有资产
- Prompt Injection 可能诱导 Agent 做恶意操作
- 模型幻觉可能导致错误交易
- 用户看不到 Agent 的意图、权限边界和后果，处于"黑箱信任"状态

### 核心矛盾

**Agent 需要自主权才能有用，但自主权就是风险敞口。用户需要知道 Agent 在做什么、能做什么、出了事怎么停。**

### 要解决的问题

如何构建"钱包持有资产 + Agent 请求有限权限 + 多层确定性规则引擎校验"的架构，让 Agent 能做该做的事，不能做不该做的事，所有操作对用户透明可撤销？

---

## 2. 目标用户

- **第一层**：我自己（学习验证 + Hackathon 演示）
- **第二层**：需要让 AI Agent 管理小额链上资产的用户（DeFi 自动化、API 付费、订阅服务）

---

## 3. 架构设计

### 3.1 总览：六层安全流水线

```
用户（EOA 主钱包）
  │
  ├── Smart Account（ERC-4337 合约钱包，持有资产）
  │     │
  │     ├── Session Key #1 → Agent A（限额 0.01 ETH/天，白名单合约）
  │     ├── Session Key #2 → Agent B（只读，不能发交易）
  │     └── 用户 EOA 保持主控权（可随时撤销 Session Key）

每笔 Agent 交易经过六层安全流水线：

  ① Session Key 状态检查 ──→ 过期/撤销 → 直接拒绝
  ② Permission Policy（七维约束）──→ 任一维度超限 → 直接拒绝
  ③ Safe Guard（硬约束 + 软约束）──→ 硬约束失败 → 拒绝；软约束触发 → 标记灰区
  ④ Pre-tx Simulation（eth_call + gas）──→ revert → CRITICAL 拒绝；生成 5 级风险等级
  ⑤ 风险分流决策：
     · CRITICAL → 自动拒绝
     · HIGH → 强制人工确认
     · MEDIUM → 灰区规则引擎自动决策（auto_approve / escalate）
     · LOW → 展示摘要，自动通过
     · TRIVIAL → 静默通过
  ⑥ 链上执行（ERC-4337 UserOp → Bundler → EntryPoint → Sepolia）
```

### 3.2 模块地图

| 模块 | 文件 | 代码行数 | 职责 |
|------|------|---------|------|
| **Session Key** | `session-key.ts` | ~80 | 临时密钥创建、生命周期管理、撤销 |
| **Permission Policy** | `permission-policy.ts` | ~175 | 七维约束校验引擎 + 用量追踪 |
| **Safe Guard** | `safe-guard.ts` | ~135 | 两层守卫：硬约束拒绝 + 软约束标记 |
| **Pre-tx Simulation** | `pre-tx-sim.ts` | ~390 | eth_call 链上模拟 + Gas 预估 + 5 级风险分级 |
| **Grey Zone** | `grey-zone.ts` | ~150 | 灰区规则引擎（7 条确定性规则，不调 LLM） |
| **Confirmation** | `confirmation.ts` | ~115 | 5 级风险分流确认（可注入确认函数） |
| **Agent Wallet** | `agent-wallet.ts` | ~185 | Smart Account 初始化 + 流水线编排 + 链上执行 |
| **Agentic Checkout** | `commerce/agentic-checkout.ts` | ~380 | Agent 自主支付 API 数据（消费所有安全模块） |
| **Gas Ratio Verify** | `verify-gas-ratio.ts` | ~145 | gas 占比 → high 风险路径的确定性验证 |

---

## 4. 各模块设计

### 4.1 Session Key（临时受限密钥）

**为什么需要**：不给 Agent 永久私钥，给它一个有时效、有权限边界的临时密钥。

```
createSessionKey(policy) → { sessionKey, privateKey }
  ├── id: "session-{timestamp}-{random}"
  ├── address: 公钥地址
  ├── policy: PermissionPolicy（绑定七维约束）
  ├── createdAt: 创建时间戳
  └── revoked: 撤销标记

生命周期：
  创建 → 绑定策略 → Agent 使用 → 到期自动失效 / 用户手动撤销 / 额度用完失效
```

关键设计决策：
- 私钥仅内存持有，不落盘（`SessionKeyPrivate.privateKey`）
- `saveSessionKey()` 存的是完整密钥对，生产环境需替换为安全存储
- `revokeSessionKey()` 是纯函数（不可变更新），不删数据

### 4.2 Permission Policy（七维约束）

**为什么七维而不是二元开关**：Agent 的能力不是"能转账 / 不能转账"，而是一个多维矩阵——什么资产、多少金额、调哪个合约、哪个函数、什么价格、什么时间、什么频率。

| 维度 | 字段 | 类型 | 示例值 |
|------|------|------|--------|
| ① 资产范围 | `assetWhitelist` | `Address[]` | `[]` = 仅 ETH |
| ②a 单笔上限 | `maxSingleAmount` | `bigint` | `0.005 ETH` |
| ②b 日累计上限 | `maxDailyAmount` | `bigint` | `0.02 ETH` |
| ③ 合约白名单 | `contractWhitelist` | `Address[]` | `[]` = 不限制 |
| ④ 函数白名单 | `functionWhitelist` | `Record<Address, Hex[]>` | 只允许 `transfer()` |
| ⑤a 最大滑点 | `maxSlippageBps` | `number` | `100` = 1% |
| ⑤b 价格偏离 | `maxPriceDeviationBps` | `number` | `200` = 2% |
| ⑥a 生效时间 | `validFrom` | `number` | `now - 60s` |
| ⑥b 失效时间 | `validUntil` | `number` | `now + 24h` |
| ⑥c 小时频率 | `maxTransactionsPerHour` | `number` | `5` |
| ⑦ 日频率 | `maxTransactionsPerDay` | `number` | `20` |

`checkPermission()` 按优先级顺序逐一检查，任一维度不通过立即返回 `{ allowed: false, reason }`。

`recordUsage()` 自动处理日期翻转（跨天重置日计数）。

### 4.3 Safe Guard（执行前守卫层）

**为什么需要两层的判断**：能用代码确定的就不要问人，代码确定不了的才标记。

```
GuardCheck {
  passed: boolean           // 硬约束全部通过？
  checks: GuardCheckItem[]  // 逐项检查结果
  requiresHumanReview: boolean  // 是否有软约束触发
  humanReviewReason?: string    // 触发原因
}

GuardCheckItem {
  name: string     // "Session Key 状态" / "权限策略" / "零值合约调用"
  passed: boolean
  detail: string   // 通过原因 / 拒绝原因
  level: "hard" | "soft"
}
```

**硬约束**（不通过 → 直接拒绝，无例外）：
1. Session Key 状态（过期/撤销）
2. 七维权限策略（任一维度不通过）

**软约束**（触发 → 标记灰区，升级人工）：
1. 零值合约调用（`value=0` 但有 `data`）→ 可能调用恶意函数
2. 合约白名单未设置 → 提醒但不阻断

### 4.4 Pre-transaction Simulation（签名前模拟）

**为什么需要**：在签名前用链上数据验证"Agent 说的"和"实际会发生的"是否一致。不依赖 Agent 的自然语言总结。

```
两条并行路径：

A 路径：eth_call 链上模拟
  → 查询当前区块号
  → eth_call 模拟交易
  → 成功 → 计算余额变化（发送方 + 接收方）
  → 失败 → 记录 revert 原因

B 路径：Bundler Gas 预估
  → 获取实时 Gas 价格（Pimlico getUserOperationGasPrice）
  → 预估 UserOperation Gas（call + verification + preVerification）
  → 检测 Paymaster 赞助是否可用
  → fallback: bundler 不可用时使用保守估算
```

**5 级风险等级**（`computeRiskLevel`，优先级从高到低，命中即停）：

| 优先级 | 等级 | 触发条件 |
|--------|------|---------|
| 1 | **CRITICAL** | eth_call revert 或余额不足以支付 gas |
| 2 | **HIGH** | gas 消耗 > 余额 20% 或 大额转账（> 0.01 ETH） |
| 3 | **TRIVIAL** | 零值简单转账（`value=0` + `data="0x"`） |
| 4 | **MEDIUM** | 有 warning 但非致命（无 Paymaster、gas 偏高） |
| 5 | **LOW** | 正常交易，无警告 |

关键设计：TRIVIAL 优先级高于 MEDIUM——零值简单转账即使有 warning（如无 Paymaster）也不涉及资金风险，不应走灰区流程。

### 4.5 Grey Zone（灰区规则引擎）

**为什么需要**：风险等级 MEDIUM 不是"直接拒绝"，也不是"直接放行"——需要确定性规则判断能否自动通过。

**核心原则**：Guard 层不调 LLM，所有规则必须确定性。签名前模拟 + 规则引擎 = 纵深防御。

```
greyZoneEngine(riskLevel, guardCheck, txValue, txTo, policy) → GreyZoneDecision

7 条规则（按优先级）：
  ① Guard 软约束 + 策略要求强制人工 → escalate
  ② Gas 占比高 + 策略要求强制人工 → escalate
  ③ 零值 + 信任地址 → auto_approve
  ④ 金额 ≤ 自动审批阈值（默认 0.005 ETH）→ auto_approve
  ⑤ 目标地址在信任列表 → auto_approve
  ⑥ 有 Guard 软约束 → escalate
  ⑦ 金额 > 阈值 + 无信任信号 → escalate
```

`GreyZonePolicy` 可配置：
- `autoApproveThreshold`：低于此金额自动通过
- `trustedRecipients`：信任地址列表
- `requireHumanWhen.guardSoftFailure`：软约束触发时是否强制人工
- `requireHumanWhen.highGasRatio`：gas 占比高时是否强制人工

### 4.6 Confirmation（风险分流确认）

**为什么需要可注入确认函数**：不同场景对"确认"的定义不同。CLI 演示用 `readline` 交互，Agent 自主模式用 `autoConfirm: true`，生产环境可以接 Webhook / 推送通知。

```
getUserConfirmation(report, autoConfirm?, context?) → { confirmed, autoApproved?, autoApprovalReason? }

风险分流逻辑：
  CRITICAL → 展示报告，自动拒绝（confirmed: false）
  HIGH     → 展示报告，强制人工确认（readline 交互）
  MEDIUM   → 调 greyZoneEngine → auto_approve 或 escalate 到人工
  LOW      → 展示摘要，自动通过（不等待用户输入）
  TRIVIAL  → 静默通过（仅一行日志）
```

`ConfirmationFn` 类型可注入，`agentExecuteTransaction()` 和 `agentPayForApiData()` 都接受可选的 `confirmationFn` 参数。

### 4.7 Agent Wallet（流水线编排 + 链上执行）

**为什么需要独立模块**：将 6 层安全流水线编排在一起，对外暴露简洁接口。

```
agentExecuteTransaction(wallet, session, policy, tx, usage, options?)
  → ① Safe Guard 前置校验
  → ② Pre-transaction Simulation（eth_call + gas 并行）
  → ③ 用户确认（风险分流）
  → ④ 链上执行（ERC-4337 UserOp → Bundler → Sepolia）
  → 返回 AgentTransactionResult
```

技术栈：
- **Smart Account**：permissionless.js `toSimpleSmartAccount`（ERC-4337 v0.7）
- **Bundler + Paymaster**：Pimlico（`createPimlicoClient`）
- **链**：Sepolia Testnet
- **RPC**：publicnode（国内访问稳定）

### 4.8 Agentic Checkout（Agent 自主支付 API）

**为什么需要**：验证安全基础设施是否真的"和业务无关"——能否零改动复用到一个新场景。

```
agentPayForApiData(paymentInstr, wallet, session, policy, options?)
  → ① 解析 HTTP 402 支付指令
  → ② Safe Guard 前置校验（复用 session-key + permission-policy + safe-guard）
  → ③ Pre-transaction Simulation（复用 pre-tx-sim）
  → ④ 风险分流（复用 grey-zone + confirmation）
  → ⑤ 链上支付（复用 agent-wallet 的 Pimlico 连接）
  → ⑥ 携带支付凭证重试 API → 获取付费数据
```

**结论：所有安全模块零改动直接复用。** 安全层和业务层应该分离。

Agentic Commerce 六层协议栈的实际映射：

| 协议层 | 标准 | 本实践状态 |
|--------|------|-----------|
| ① 发现 | A2A, MCP | 硬编码支付指令 |
| ② 信任 | ERC-8004 | Safe Guard + Grey Zone + Simulation ✅ |
| ③ 下单 | ACP | 未覆盖 |
| ④ 授权 | AP2 | Session Key + Permission Policy ✅ |
| ⑤ 支付 | x402 | ERC-4337 UserOp（流程等价，非标准 x402） |
| ⑥ 交付 | 无标准 | 模拟 HTTP 200 |

---

## 5. 技术栈

| 层 | 技术 | 原因 |
|---|---|---|
| 钱包 | ERC-4337 Smart Account（permissionless.js + Pimlico） | 支持 Session Key + UserOperation + Paymaster |
| Bundler | Pimlico v1 API | UserOperation 中继 + Gas 赞助 |
| RPC | ethereum-sepolia-rpc.publicnode.com | 国内访问稳定，无需 API Key |
| 链 | Sepolia Testnet | Cohort 统一测试网 |
| 语言 | TypeScript + viem | 类型安全 + 链上交互 |
| 运行环境 | Node.js + tsx | 脚本型演示，不依赖浏览器 |
| 前端 | Next.js 14 App Router | 状态机驱动 UI（idle → guard → sim → confirm → execute） |

---

## 6. MVP 完成度

| 功能 | 状态 | 说明 |
|------|------|------|
| ERC-4337 Smart Account 部署 | ✅ | Sepolia 地址 `0x2c6C...04B6` |
| 七维约束 Session Key | ✅ | `permission-policy.ts` |
| Agent 通过 Session Key 发起交易 | ✅ | 链上验证交易已确认 |
| Safe Guard 硬约束拒绝 | ✅ | 过期/撤销/超限/未授权函数 全部验证 |
| Safe Guard 软约束标记 | ✅ | 零值调用、白名单未设置 |
| Pre-tx Simulation | ✅ | eth_call + gas 并行估算 |
| 5 级风险分级 | ✅ | CRITICAL / HIGH / MEDIUM / LOW / TRIVIAL |
| 灰区规则引擎 | ✅ | 7 条确定性规则自动决策 |
| 风险分流确认 | ✅ | 5 级分流 + 可注入确认函数 |
| Session Key 撤销 | ✅ | 一键 revoke |
| Agentic Commerce 闭环 | ✅ | HTTP 402 → 支付 → 交付（Sepolia 验证） |
| Gas 占比 → high 路径验证 | ✅ | `verify-gas-ratio.ts` 4 个测试通过 |
| 前端 UI | ✅ | Next.js 状态机，5 步流程 |

---

## 7. v0.2 方向（未实现）

- USDC 支付（当前仅 ETH）
- 真实 x402 协议集成（需要 USDC 测试币 + x402 兼容 API Server）
- ACP 结构化订单格式
- 多 Agent 并发管理
- 生产环境 Session Key 持久化（Redis / 加密数据库）
- Paymaster 赞助生效（当前 Pimlico plan 不支持 full sponsorship）
- MPC 私钥分片

---

## 8. 设计原则总结

1. **安全层和业务层分离**：Permission Policy、Safe Guard、Grey Zone、Simulation 不耦合任何具体场景，从"Agent 转账"切换到"Agent 支付 API"零改动
2. **确定性规则优先于 LLM 判断**：Guard 层不调 LLM，所有拦截规则都是确定性的
3. **纵深防御**：Safe Guard（前置）→ Simulation（链上验证）→ Grey Zone（规则引擎）→ Confirmation（人工兜底），四道防线
4. **结构化数据，不靠自然语言总结**：Simulation 结果来自 `eth_call` 和 bundler API，不是 Agent 生成的文字
5. **用户可见 + 可撤销**：权限边界、风险等级、交易后果都对用户透明，随时可撤销 Session Key

---

## 9. 开发历程

| 日期 | 内容 |
|------|------|
| 2026-05-29 | 项目启动，设计文档初稿 |
| 2026-05-30 | Session Key + Permission Policy + Safe Guard 实现 |
| 2026-05-31~06-01 | Smart Account 链上执行接入（ERC-4337 + Pimlico） |
| 2026-06-02 | Pre-tx Simulation + Confirmation |
| 2026-06-03 | 项目收尾 |
| 2026-06-04~06 | 前端 UI + Hackathon 总结 |
| 2026-06-08~10 | Grey Zone 规则引擎 + 5 级风险分级 |
| 2026-06-11 | Gas 占比 → high 路径确定性验证 |
| 2026-06-13 | Agentic Commerce 最小实践（支付闭环） |
| 2026-06-14 | 设计文档更新（反映完整架构） |

---

## 10. 参考资料

- [ERC-4337 标准](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [x402 协议](https://docs.cdp.coinbase.com/x402/welcome)
- [ACP 协议 (Stripe)](https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce)
- [permissionless.js](https://docs.pimlico.io/permissionless)
- [Pimlico Bundler](https://docs.pimlico.io/)
- Handbook Tracks: [Wallet / Permission](https://aiweb3.school/zh/handbook/tracks/wallet-permission/) / [Agentic Commerce](https://aiweb3.school/zh/handbook/tracks/agentic-commerce/)
- Handbook 七大知识点：AI Wallet UX、Permission Policy、Session Key、Safe Guard、ERC-4337 Workflow、Pre-transaction Simulation、Recovery/Revocation
