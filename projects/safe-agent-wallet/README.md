# Safe Agent Wallet

Agent 不应该拥有"钱包"，它只应该拥有一组可限制、可审计、可撤销的链上能力。

## 方向

Wallet / Permission Track

## 核心问题

如何用 Smart Account + Session Key + Safe Guard 构建三层权限架构，让 AI Agent 能在安全边界内自主操作链上资产？

## 技术栈

- ERC-4337 Smart Account（ZeroDev / Biconomy）
- Session Key + Permission Policy（七维约束）
- Safe Guard（确定性规则 + 灰区人工确认）
- Sepolia Testnet

## 文档

- [design.md](./design.md) — 项目设计文档
- [notes.md](./notes.md) — 开发笔记
