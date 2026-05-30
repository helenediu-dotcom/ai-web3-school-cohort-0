# 开发笔记

## 2026-05-29：项目启动

- 选定 Wallet / Permission Track
- 读完 Handbook，七大知识点形成完整认知
- 输出设计文档初稿：三层架构（Smart Account + Session Key + Safe Guard）
- MVP 范围确认：ERC-4337 部署 + 七维约束 Session Key + 测试转账 + 权限拒绝验证 + 撤销机制

## 2026-05-30：Session Key + Permission Policy 代码实现

- 实现七维权限策略校验引擎（`checkPermission`）：资产/金额/合约/函数/时间/频率
- 实现 Session Key 生命周期管理：创建、存储、签名、撤销
- 实现 Safe Guard 两层守卫：硬约束（直接拒绝）+ 灰区（人工确认）
- 6 个场景验证全部通过
- 代码位置：`experiments/account-abstraction/week4/`
- 待办：将 Session Key 接入 Smart Account 链上执行
