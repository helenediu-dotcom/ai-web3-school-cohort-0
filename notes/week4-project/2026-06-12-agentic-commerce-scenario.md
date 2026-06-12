# Agentic Commerce 最小实践：Agent 自主支付 API 数据

**日期**：2026-06-12（Day 26）
**状态**：设计阶段

---

## 场景定义

**Agent 需要查询付费链上数据 API，自主完成支付并获取结果。**

具体场景：
- 用户对 Agent 说："帮我查一下这个地址过去 30 天的交易趋势分析"
- Agent 发现这需要调用付费 API（如 Chainalysis / Dune / 自定义数据服务）
- API 返回 HTTP 402 + x402 支付指令（或简化版：返回价格 + 收款地址）
- Agent 评估风险、获得授权后，用 Safe Wallet 支付 USDC
- 支付确认后，API 返回数据，Agent 呈现给用户

---

## 为什么这个场景值得做

1. **覆盖 Agentic Commerce 六层中的四层**：发现 → 信任 → 支付 → 交付
2. **复用现有全部安全基础设施**：Permission Policy、Safe Guard、Pre-Tx Sim、灰区引擎
3. **引入一个新概念**：x402 风格的 HTTP 402 支付流程
4. **最小可行**：不需要真实 USDC，Sepolia 测试网 ETH 即可验证全流程

---

## 架构设计

```
                         ┌──────────────────────┐
                         │    Data API Server    │
                         │  (付费链上数据服务)    │
                         │                      │
                         │ GET /api/analysis     │
                         │   → 402 Payment Req.  │
                         │   → {price, address}  │
                         └──────┬───────────────┘
                                │ ② HTTP 402
                                │ ⑤ HTTP 200 + data
                                │
┌──────────┐  ① 用户请求  ┌────┴──────────────────┐
│  User    │ ───────────→ │   AI Agent             │
│          │ ←─────────── │   (Claude / GPT)       │
└──────────┘  ⑥ 返回结果  │                        │
                          │ ③ 支付决策             │
                          │   → 灰区引擎评估风险    │
                          │   → Safe Guard 校验     │
                          │   → 用户确认（如需）    │
                          └────┬───────────────────┘
                               │ ④ 链上支付
                               │   ERC-4337 UserOp
                               │   (ETH / 未来 USDC)
                          ┌────┴───────────────────┐
                          │   Smart Account         │
                          │   (Safe Agent Wallet)   │
                          │   on Sepolia            │
                          └────────────────────────┘
```

---

## 实现计划

### 新增文件

| 文件 | 职责 | 行数估计 |
|-----|------|---------|
| `week4/commerce/mock-api-server.ts` | 模拟付费 API：收到请求 → 返回 402 → 验证支付 → 返回数据 | ~80 |
| `week4/commerce/agentic-checkout.ts` | Agent 支付决策：接收 402 响应 → 调用灰区引擎 → 调用 Safe Wallet → 重试请求 | ~100 |
| `week4/commerce/index.ts` | 端到端演示脚本 | ~60 |

### 复用文件（不改动）

| 文件 | 复用方式 |
|-----|---------|
| `week4/permission-policy.ts` | 七维约束（限制支付金额、接收地址白名单） |
| `week4/session-key.ts` | Session Key 签名支付 |
| `week4/safe-guard.ts` | Guard 层校验（硬约束 + 软约束） |
| `week4/pre-tx-sim.ts` | 签名前模拟 + 风险分级 |
| `week4/grey-zone.ts` | 灰区自动决策引擎 |
| `week4/confirmation.ts` | 按风险等级确认 |
| `week4/agent-wallet.ts` | Smart Account 链上执行 |

---

## 核心流程（伪代码）

```typescript
// agentic-checkout.ts

async function agentPayForApiData(
  apiUrl: string,           // 付费 API 地址
  wallet: AgentWalletInstance,
  sessionKey: SessionKey,
  policy: PermissionPolicy,
  usage: UsageTracker
): Promise<ApiData | PaymentFailed> {
  
  // Step 1: 尝试访问 API → 收到 402
  const paymentRequired = await fetch(apiUrl);
  if (paymentRequired.status !== 402) {
    return paymentRequired.json(); // 免费 API，直接返回
  }
  
  // Step 2: 解析支付指令
  const paymentInstr: PaymentInstruction = await paymentRequired.json();
  // { amount: "0.001", token: "ETH", recipient: "0x...", description: "..." }
  
  // Step 3: 构造交易（ETH 转账给 API 收款地址）
  const tx: TransactionRequest = {
    to: paymentInstr.recipient,
    value: parseEther(paymentInstr.amount),
    data: "0x",
  };
  
  // Step 4: 灰区引擎评估风险
  const simulation = await runPreTxSimulation(tx, wallet.publicClient);
  const riskLevel = computeRiskLevel(simulation, tx);
  const decision = evaluateGreyZone(riskLevel, simulation, tx);
  
  // 灰区引擎自动决策：
  //   trivial/low → autoConfirm，直接支付
  //   medium/high → 升级人工确认
  //   critical → 拒绝支付
  
  if (!decision.autoApproved && !decision.escalate) {
    return { success: false, reason: decision.reason };
  }
  
  // Step 5: Safe Guard 校验
  const guardResult = safeGuardCheck(sessionKey, policy, tx, usage);
  if (!guardResult.passed) {
    return { success: false, reason: guardResult.reason };
  }
  
  // Step 6: 用户确认（如需）
  const confirmed = decision.autoApproved 
    ? true 
    : await getUserConfirmation(tx, simulation, guardResult);
  
  if (!confirmed) {
    return { success: false, reason: "用户取消支付" };
  }
  
  // Step 7: 链上支付
  const txHash = await wallet.smartAccount.sendTransaction({
    to: tx.to,
    value: tx.value,
    data: tx.data,
  });
  
  // Step 8: 等待确认 + 重试 API 请求
  await wallet.publicClient.waitForTransactionReceipt({ hash: txHash });
  
  const response = await fetch(apiUrl, {
    headers: {
      "X-Payment-Tx": txHash, // API 验证支付凭证
    },
  });
  
  return response.json();
}
```

---

## 简化版（不写 mock server，直接用现有组件验证）

如果不想写完整的 mock API server，可以用更简单的方式验证核心链路：

1. 硬编码一个"付费 API 的支付指令"
2. Agent 收到指令后 → 灰区引擎 → Safe Guard → 用户确认 → 链上支付
3. 支付成功后打印 "API 数据已返回（模拟）"

这样只新增一个文件（`commerce/agentic-checkout.ts`），其余全部复用。

---

## 学习目标

通过这个实践理解：
1. **HTTP 402 支付流程**：请求 → 402 → 支付 → 重试 → 200。这是 x402 的核心模式
2. **Agent 作为支付决策者**：Agent 不只是执行用户指令，还要评估"这个 API 值不值这个价"（灰区引擎的作用）
3. **安全基础设施复用到商业场景**：同样的 Permission Policy、Safe Guard、Pre-Tx Sim，从"转账"场景切换到"支付 API"场景
4. **Agentic Commerce 协议栈的实际映射**：哪些层已经有方案，哪些层还是空白
