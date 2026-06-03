# 开发笔记

## 2026-05-29：项目启动

- 选定 Wallet / Permission Track
- 读完 Handbook，七大知识点形成完整认知
- 输出设计文档初稿：三层架构（Smart Account + Session Key + Safe Guard）
- MVP 范围确认：ERC-4337 部署 + 七维约束 Session Key + 测试转账 + 权限拒绝验证 + 撤销机制

## 2026-05-30（Day 13）：Session Key + Permission Policy 代码实现

- 实现七维权限策略校验引擎（`checkPermission`）：资产/金额/合约/函数/时间/频率
- 实现 Session Key 生命周期管理：创建、存储、签名、撤销
- 实现 Safe Guard 两层守卫：硬约束（直接拒绝）+ 灰区（人工确认）
- 6 个场景验证全部通过
- 代码位置：`experiments/account-abstraction/week4/`
- 待办：将 Session Key 接入 Smart Account 链上执行

## 2026-05-31 ~ 06-01（Day 14-15）：Smart Account 链上执行

- 接入 ERC-4337：用 permissionless.js + Pimlico Bundler + Paymaster
- `initAgentWallet()`：创建 Smart Account、连接 Bundler、获取 Paymaster 赞助
- `agentExecuteTransaction()`：Safe Guard → 签名 UserOp → 提交链上
- Smart Account 地址：从 EntryPoint 合约事件反查
- Sepolia 测试网验证通过

## 2026-06-02（Day 16）：Pre-transaction Simulation + Confirmation

- `pre-tx-sim.ts`：A 路径（eth_call 链上模拟）+ B 路径（bundler gas 预估）并行
- `computeRiskLevel()`：按 revert / 余额 / gas 占比 / Paymaster 赞助情况分级
- `confirmation.ts`：low 自动通过、medium 展示报告确认、high 加警告
- 集成到 `agentExecuteTransaction()`，形成「模拟 → 确认 → 执行」完整链路
- 8 个场景全部通过，autoConfirm 快速路径可跳过交互确认

## 2026-06-03（Day 17）：项目总结 & 收尾

- 项目设计文档定稿，架构四层图确认
- 工作树清理：.js 编译产物移出 git 跟踪
- 学习历程回顾：17 天从 AI 基础到 ERC-4337 链上执行
