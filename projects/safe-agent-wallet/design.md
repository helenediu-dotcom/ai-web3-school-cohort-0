# Safe Agent Wallet — 项目设计文档

## 一句话描述

Agent 不应该拥有"钱包"，它只应该拥有一组可限制、可审计、可撤销的链上能力。

---

## 1. 问题定义

### 现状

- AI Agent 要操作链上资产（转账、swap、质押），传统做法是给它私钥
- 如果把 EOA 私钥直接给 Agent，Agent 拥有的是"无限权力"——可以花掉所有资产
- Prompt Injection 攻击可能诱导 Agent 做恶意操作
- 即使 Agent 本身没有恶意，模型幻觉也可能导致错误交易
- 用户看不到 Agent 的意图、权限边界和后果，处于"黑箱信任"状态

### 核心矛盾

**Agent 需要自主权才能有用，但自主权就是风险敞口。用户需要知道 Agent 在做什么、能做什么、出了事怎么停。**

### 要解决的问题

如何构建一个"钱包持有资产 + Agent 请求有限权限 + 规则引擎在链上/链下双重校验"的三层架构，让 Agent 能做该做的事，不能做不该做的事，所有操作对用户透明可撤销？

---

## 2. 目标用户

- **第一层**：我自己（学习验证 + Hackathon 演示）
- **第二层**：需要让 AI Agent 管理小额链上资产的用户（DeFi 自动化、定期支付、订阅服务）

---

## 3. 方案设计

### 核心思路

不用 EOA，用 Smart Account + Session Key 给 Agent 一个「沙箱钱包」：

```
用户（EOA 主钱包）
  │
  ├── Smart Account（链上合约钱包）
  │     │
  │     ├── Session Key #1 → Agent A（限额 0.01 ETH/天，白名单合约）
  │     ├── Session Key #2 → Agent B（只读，不能发交易）
  │     └── 用户 EOA 保持主控权（可随时撤销 Session Key）
```

### 权限模型（七维约束，来自 Handbook Permission Policy）

| 维度 | 说明 | 示例 |
|---|---|---|
| **资产范围** | 哪些 token 可以被操作 | 只允许 ETH 和 USDC |
| **金额上限** | 单笔上限 + 日累计上限 | 单笔 ≤ 0.01 ETH，日累计 ≤ 0.1 ETH |
| **目标合约** | 白名单合约地址 | 只能调 Uniswap V3 Router |
| **函数范围** | 每个合约允许调哪些方法 | 只能 `swapExactInput`，不能 `approve` |
| **价格和滑点** | 交易价格约束 | 滑点 ≤ 1%，价格偏离 ≤ 2% |
| **时间窗口** | Session Key 有效期 + 频率限制 | 24h 过期，每小时最多 5 笔 |
| **频率限制** | 单位时间内操作次数上限 | 每日最多 20 笔交易 |

### Session Key 完整流程（来自 Handbook）

```
主钱包创建 Session Key
  → 设置权限范围（七维 Policy）
    → Agent 使用 Session Key 发起符合规则的操作
      → Safe Guard 校验（确定性规则拦住硬违规，人工确认处理灰区）
        → 权限到期 / 额度用完 / 用户手动撤销 → Session Key 失效
```

### Safe Guard：执行前守卫层

在 Agent 发起交易前，增加两层判断：

1. **确定性规则（链上/合约层）**：金额超限、合约不在白名单、Session Key 过期 → 直接拒绝，不需要问人
2. **人工确认（灰区处理）**：规则覆盖不了的情况（如异常价格波动、新合约交互）→ 升级到用户确认

设计原则：**能在代码里拦住的就不要问人，代码拦不住的才升级到人工。**

### Pre-transaction Simulation（签名前模拟）

签名前必须模拟交易结果：

- 模拟结果翻译成人能理解的语言（余额变化、资产流向、gas 消耗）
- **关键字段必须来自结构化解析和链上模拟**，不能只靠 Agent 的自然语言总结
- 用户可以对比"Agent 说的"和"链上模拟实际会发生的"是否一致

### Recovery / Revocation（恢复与撤销）

不做事后补救，设计阶段就内置：

- 用户可随时手动撤销 Session Key（前端一键 revoke）
- Session Key 到期自动失效
- 额度用完自动失效
- 异常检测触发自动冻结（可选，v0.2）

### AI Wallet UX（用户视角的完整流程）

```
用户："帮我把 0.005 ETH 换成 USDC"

1. Agent 展示意图（用户可见）：
   - 任务：0.005 ETH → USDC swap
   - 会读取：ETH 余额、Uniswap 报价
   - 会调用：Uniswap V3 swapExactInput
   - 涉及权限：ETH（资产）、0.01 ETH 单笔（金额）、Uniswap（合约）、24h（时间）
   - 风险提示：滑点 ≤ 1%，gas ~$2-5
   - 撤销方式：随时点"撤销 Session Key"

2. 用户确认 → Agent 用 Session Key 签名 UserOperation

3. Pre-transaction Simulation：
   - 链上模拟：输入 0.005 ETH → 输出 ~10 USDC，gas 0.0003 ETH
   - 用结构化数据显示，不靠 Agent 自然语言总结

4. Safe Guard 校验：
   - 确定性规则：金额 ≤ 限额？合约在白名单？Session Key 有效？ ✓
   - 灰区判断：价格偏离是否正常？→ 正常范围内，放行

5. Smart Account 验证签名、nonce、权限

6. Bundler → EntryPoint → 链上执行

7. 返回结果：交易哈希 + 资产变化 + 剩余额度
```

任一校验失败 → 交易被拒绝 → Agent 收到失败原因（结构化，不是自然语言）→ 告知用户

---

## 4. 技术栈

| 层 | 技术 | 原因 |
|---|---|---|
| 钱包 | **ERC-4337 Smart Account**（ZeroDev / Biconomy / Alchemy AA SDK） | 支持 Session Key + UserOperation |
| Agent 框架 | **Claude Code + MCP Server** 或 **LangChain + Web3 Tool** | 把链上操作封装成工具 |
| 链 | **Sepolia Testnet**（先测试网验证） | 已有 Day 6 实践基础 |
| 索引 | **Etherscan API / Alchemy API** | 查询交易历史和余额 |

---

## 5. MVP 范围

### 必须要做的（MVP v0.1）

1. 部署一个 ERC-4337 Smart Account（用 ZeroDev 或 Biconomy SDK）
2. 创建一个带七维约束的 Session Key
3. Agent 通过 Session Key 发起一笔测试转账（Sepolia ETH）
4. Safe Guard 校验通过/拒绝的逻辑可验证
5. Pre-transaction Simulation：执行前展示结构化模拟结果
6. Recovery：一键撤销 Session Key
7. 用户交互界面让用户看到：Agent 意图、权限范围、风险提示、撤销入口（AI Wallet UX）

### 不做（v0.1 范围外）

- 不做主网部署
- 不做复杂 DeFi 策略
- 不做 MPC 私钥分片
- 不做多 Agent 管理

### v0.2（如果时间允许）

- 增加 Human-in-the-loop：大额交易需要用户确认
- 增加日累计追踪

---

## 6. 需要学习的技术点

- [ ] ERC-4337 标准（UserOperation 结构、Bundler、EntryPoint、Paymaster）
- [ ] ZeroDev / Biconomy SDK 的 Session Key API
- [ ] 如何在 Sepolia 上部署和配置 Smart Account
- [ ] Agent 如何构造和签名 UserOperation
- [ ] 权限约束在链上 vs 链下的分工：
  - 链上（确定性拒绝）：金额超限、合约不在白名单、Session Key 过期
  - 链下（Agent 工具层预检 + 结构化展示）：意图确认、模拟结果翻译、灰区升级
- [ ] Pre-transaction Simulation 如何获取结构化数据（不用模型总结）
- [ ] Session Key 撤销的前端交互

---

## 7. 风险与边界

### 这个 MVP 不解决的问题

- **私钥管理**：MVP 用测试网，私钥管理不是重点
- **多 Agent 冲突**：MVP 只有一个 Agent，不考虑并发
- **Gas 优化**：MVP 不优化 gas，能用就行
- **主网安全审计**：MVP 仅测试网
- **灰区自动决策**：规则覆盖不了的情况升级到人工，不追求全自动

### 项目的学习价值 > 实用价值

这个项目的目的是验证「Agent 只拥有一组可限制、可审计、可撤销的能力」这套架构，不是做一个生产级产品。

---

## 8. 参考资料

- [ERC-4337 标准](https://eips.ethereum.org/EIPS/eip-4337)
- [ZeroDev Docs](https://docs.zerodev.app/)
- [Biconomy Smart Account](https://docs.biconomy.io/smartAccounts)
- Handbook: [Wallet / Permission Track](https://aiweb3.school/zh/handbook/tracks/wallet-permission/)
- Handbook 七大知识点：AI Wallet UX、Permission Policy、Session Key、Safe Guard、ERC-4337 Workflow、Pre-transaction Simulation、Recovery/Revocation
- Day 9 笔记（AA + Smart Account 实操）
- Day 10 笔记（AI Security + Agent Wallet）
- Day 11 笔记（Web3 Tool Use + Week 3 全串联）
