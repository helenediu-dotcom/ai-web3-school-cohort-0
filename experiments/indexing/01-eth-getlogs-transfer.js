// 最小 ERC-20 Transfer Event Indexer
// 用法: node 01-eth-getlogs-transfer.js
//
// 目标:
//   1) 用 eth_getLogs 从 Sepolia 拉最近 N 个区块内的 ERC-20 Transfer 事件
//   2) 解码 topics + data -> { from, to, value }
//   3) 输出结构化 JSON (这就是 "AI Context 友好" 的形态)
//
// 概念回顾:
//   - Transfer(address indexed from, address indexed to, uint256 value)
//   - topic[0] = keccak256("Transfer(address,address,uint256)")
//   - topic[1] = from 地址 (左侧填充到 32 字节)
//   - topic[2] = to   地址 (左侧填充到 32 字节)
//   - data     = value (uint256, 32 字节 hex)

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---- 配置 ----
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';

// Sepolia 上的一个活跃 ERC-20: USDC (Circle 官方测试版)
// 来源: https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
const TOKEN_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const TOKEN_SYMBOL = 'USDC';
const TOKEN_DECIMALS = 6;

// Transfer 事件签名的 keccak256 (ERC-20 标准, 所有 token 都一样)
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// 扫描最近多少个区块 (公共 RPC 通常限制 <= 10000)
const BLOCK_RANGE = 200;

// ---- JSON-RPC 工具 ----
function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(RPC_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(JSON.stringify(parsed.error)));
            resolve(parsed.result);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---- 解码工具 ----
// 32 字节的 topic -> 20 字节地址 (取后 40 个 hex 字符)
function topicToAddress(topic) {
  return '0x' + topic.slice(-40);
}

// 32 字节 hex -> BigInt -> 人类可读
function hexToBigInt(hex) {
  return BigInt(hex);
}

function formatTokenAmount(rawValue, decimals) {
  const v = BigInt(rawValue);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

// ---- 主流程 ----
async function main() {
  console.log(`[*] RPC: ${RPC_URL}`);
  console.log(`[*] Token: ${TOKEN_SYMBOL} (${TOKEN_ADDRESS})`);

  // 1) 当前区块
  const latestHex = await rpcCall('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  const fromBlock = latest - BLOCK_RANGE;
  console.log(`[*] Scanning blocks ${fromBlock} -> ${latest} (range=${BLOCK_RANGE})`);

  // 2) eth_getLogs: 这是 Indexing 的核心调用
  const logs = await rpcCall('eth_getLogs', [
    {
      address: TOKEN_ADDRESS,
      topics: [TRANSFER_TOPIC], // 只要 Transfer 事件
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + latest.toString(16),
    },
  ]);

  console.log(`[*] Got ${logs.length} Transfer events\n`);

  // 3) 解码每条 log 成结构化数据
  const decoded = logs.map((log) => ({
    blockNumber: parseInt(log.blockNumber, 16),
    txHash: log.transactionHash,
    logIndex: parseInt(log.logIndex, 16),
    from: topicToAddress(log.topics[1]),
    to: topicToAddress(log.topics[2]),
    valueRaw: hexToBigInt(log.data).toString(),
    value: formatTokenAmount(log.data, TOKEN_DECIMALS) + ' ' + TOKEN_SYMBOL,
  }));

  // 4) 打印前 5 条 (人类可读视角)
  const preview = decoded.slice(0, 5);
  console.log('[*] First 5 events (decoded, AI-ready):');
  console.log(JSON.stringify(preview, null, 2));

  // 5) 写入完整输出, 便于后续分析
  const outputPath = path.join(__dirname, '01-output.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        meta: {
          rpc: RPC_URL,
          token: { address: TOKEN_ADDRESS, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS },
          fromBlock,
          toBlock: latest,
          count: decoded.length,
          scannedAt: new Date().toISOString(),
        },
        events: decoded,
      },
      null,
      2
    )
  );
  console.log(`\n[*] Full output -> ${outputPath}`);

  // 6) 小结: 哪些字段值得进 AI Context?
  console.log('\n--- Reflection ---');
  console.log('值得进 AI Context 的字段: from / to / value / blockNumber / txHash');
  console.log('不该进 Context 的: raw topics / data hex (无信息密度, 占 token)');
  console.log('生产级 indexer 还需要: timestamp / 处理 reorg / 持久化到 DB / 增量扫描');
}

main().catch((e) => {
  console.error('[!] Error:', e.message);
  process.exit(1);
});
