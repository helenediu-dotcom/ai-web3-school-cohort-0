# Indexing 实验

这个目录记录 Indexing（链上事件索引）相关的最小实践。

---

## 01 - ERC-20 Transfer Event Indexer

**日期**：2026-05-25  
**目标**：用 `eth_getLogs` 从 Sepolia 拉取 ERC-20 Transfer 事件，解码并输出结构化 JSON

### 文件

- `01-eth-getlogs-transfer.js`：最小 indexer 脚本（70 行，纯 Node.js，无依赖）
- `01-output.json`：运行输出（864 个事件，7791 行）

### 运行

```bash
node 01-eth-getlogs-transfer.js
```

### 关键概念

**eth_getLogs 参数**：
```javascript
{
  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',  // USDC Sepolia
  topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],  // Transfer 签名
  fromBlock: '0xa64d16',  // 起始区块
  toBlock: '0xa64dda'     // 结束区块
}
```

**解码规则**（ERC-20 Transfer）：
- `topics[0]` = 事件签名 hash
- `topics[1]` = from 地址（32 字节，取后 40 个 hex 字符）
- `topics[2]` = to 地址
- `data` = value（uint256 hex → BigInt → 除以 10^decimals）

### 输出示例

```json
{
  "blockNumber": 10919546,
  "txHash": "0xd8bffa7a82c463bf571a425971afc8dd0783a1d077e7a9e0a8fec45da92752cf",
  "from": "0x5c99bd9ab8b7da3f6d0a00216ca2905bc3e3bf86",
  "to": "0xd1ef43e63308ecebdb09865b5298db5d600ae44f",
  "value": "16.200805 USDC"
}
```

### 生产级 indexer 还需要

- [ ] 处理 reorg（监听 `eth_subscribe('newHeads')`，回滚已索引数据）
- [ ] 增量扫描（记录 checkpoint，每次从上次结束的区块继续）
- [ ] 持久化（写入 PostgreSQL / MongoDB）
- [ ] 添加 timestamp（调用 `eth_getBlockByNumber` 拿 `block.timestamp`）
- [ ] Rate limit 处理（分批扫描，公共 RPC 通常限 ≤10000 块/次）
- [ ] 多合约支持（批量监听多个 ERC-20）

---

## 相关笔记

- `daily/2026-05-25.md`：今日学习笔记
- `checkins/2026-05-25.md`：打卡记录
- `notes/week2-web3-basics/2026-05-24-web3-7主题全景概览.md`：Indexing 概念卡片
