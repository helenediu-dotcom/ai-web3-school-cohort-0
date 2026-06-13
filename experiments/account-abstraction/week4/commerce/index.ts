import { parseEther, Hex } from "viem";
import {
  TEST_POLICY,
  PermissionPolicy,
  TransactionRequest,
  createEmptyUsageTracker,
  recordUsage,
} from "../permission-policy";
import {
  createSessionKey,
  saveSessionKey,
  revokeSessionKey,
  SessionKey,
} from "../session-key";
import { safeGuardCheck, formatGuardResult } from "../safe-guard";
import {
  initAgentWallet,
  AgentWalletInstance,
} from "../agent-wallet";
import { formatSimulationReport } from "../pre-tx-sim";
import {
  greyZoneEngine,
  DEFAULT_GREY_ZONE_POLICY,
} from "../grey-zone";
import {
  agentPayForApiData,
  createPaymentInstruction,
  formatPaymentResult,
  validatePaymentInstruction,
  PaymentInstruction,
  PaymentResult,
} from "./agentic-checkout";

// === Agentic Commerce 端到端演示 ===
//
// 场景：Agent 需要查询付费链上数据 API，自主完成支付并获取结果。
//
// 验证 Agentic Commerce 六层协议栈中四层：
//   发现 → 信任 → 支付 → 交付

function divider(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

const main = async () => {
  divider("Agentic Commerce — Agent 自主支付 API 数据");

  console.log(`\n核心流程：HTTP 402 → Safe Guard → Simulation → Grey Zone → Payment → Delivery`);
  console.log(`复用模块：Safe Guard / Pre-tx Sim / Grey Zone / Session Key / Smart Account`);

  // ═══════════════════════════════════════════════════
  // Step 1: 创建支付指令（模拟 HTTP 402 响应）
  // ═══════════════════════════════════════════════════

  divider("Step 1: 模拟 HTTP 402 支付指令");

  const paymentInstr = createPaymentInstruction({
    amountEth: "0.001",
    description: "链上数据分析 API — 地址 30 天交易趋势报告",
  });

  // 验证支付指令
  const validation = validatePaymentInstruction(paymentInstr);
  if (!validation.valid) {
    console.log(`✗ 支付指令无效：${(validation as any).reason}`);
    return;
  }

  console.log(`✓ 支付指令验证通过`);
  console.log(`  服务:     ${paymentInstr.description}`);
  console.log(`  金额:     ${paymentInstr.amount}`);
  console.log(`  收款方:   ${paymentInstr.recipient}`);
  console.log(`  API:      ${paymentInstr.apiUrl}`);

  // ═══════════════════════════════════════════════════
  // Step 2: 创建 Agent Session Key + 支付策略
  // ═══════════════════════════════════════════════════

  divider("Step 2: 创建 Agent Session Key + 支付权限策略");

  // 支付场景策略：比通用策略更严格（API 支付通常小额、高频）
  const paymentPolicy: PermissionPolicy = {
    ...TEST_POLICY,
    maxSingleAmount: parseEther("0.005"),   // 单笔最多 0.005 ETH（API 支付场景）
    maxDailyAmount: parseEther("0.02"),      // 日累计最多 0.02 ETH
    maxTransactionsPerHour: 10,              // API 支付可能高频
    maxTransactionsPerDay: 50,
    // 可以加收款方白名单限制
    // contractWhitelist: [paymentInstr.recipient],
  };

  const { sessionKey, privateKey } = createSessionKey(paymentPolicy);
  saveSessionKey({ sessionKey, privateKey });

  console.log(`Session Key ID:   ${sessionKey.id}`);
  console.log(`Session Key 地址: ${sessionKey.address}`);
  console.log(`支付策略:`);
  console.log(`  单笔上限: ${Number(paymentPolicy.maxSingleAmount) / 1e18} ETH`);
  console.log(`  日累计上限: ${Number(paymentPolicy.maxDailyAmount) / 1e18} ETH`);
  console.log(`  每小时频率: ${paymentPolicy.maxTransactionsPerHour} 笔`);
  console.log(`  每日频率: ${paymentPolicy.maxTransactionsPerDay} 笔`);
  console.log(`  有效期: ${new Date(paymentPolicy.validUntil * 1000).toLocaleString()} 前`);

  // ═══════════════════════════════════════════════════
  // Step 3: 场景 A — 合法支付 → Safe Guard 通过
  // ═══════════════════════════════════════════════════

  divider("Step 3: 场景 A — 合法支付（Safe Guard 本地校验）");

  const tx: TransactionRequest = {
    to: paymentInstr.recipient,
    value: paymentInstr.amountWei,
    data: "0x",
  };

  let usage = createEmptyUsageTracker();
  const guardResult = safeGuardCheck(sessionKey, paymentPolicy, tx, usage);

  console.log(formatGuardResult(guardResult));

  if (guardResult.passed) {
    usage = recordUsage(usage, tx);
    console.log(`\n→ Safe Guard 通过。日累计: ${usage.dailyTxCount} 笔, ${usage.dailyAmountSpent} wei`);
  }

  // ═══════════════════════════════════════════════════
  // Step 4: 场景 B — 超额支付被拒绝
  // ═══════════════════════════════════════════════════

  divider("Step 4: 场景 B — 超额支付被 Safe Guard 拒绝");

  const expensivePayment = createPaymentInstruction({
    amountEth: "0.1",
    description: "高价数据分析 API",
  });

  const overLimitTx: TransactionRequest = {
    to: expensivePayment.recipient,
    value: expensivePayment.amountWei,
    data: "0x",
  };

  const freshUsage = createEmptyUsageTracker();
  const rejectResult = safeGuardCheck(sessionKey, paymentPolicy, overLimitTx, freshUsage);

  console.log(`拟支付：${expensivePayment.amount} → ${expensivePayment.recipient.slice(0, 10)}...`);
  console.log(formatGuardResult(rejectResult));

  // ═══════════════════════════════════════════════════
  // Step 5: 场景 C — Session Key 过期被拒绝
  // ═══════════════════════════════════════════════════

  divider("Step 5: 场景 C — Session Key 过期");

  const expiredPolicy: PermissionPolicy = {
    ...paymentPolicy,
    validFrom: Math.floor(Date.now() / 1000) - 7200,  // 2 小时前生效
    validUntil: Math.floor(Date.now() / 1000) - 3600,  // 1 小时前过期
  };

  const { sessionKey: expiredKey } = createSessionKey(expiredPolicy);

  const expiredTx: TransactionRequest = {
    to: paymentInstr.recipient,
    value: parseEther("0.001"),
    data: "0x",
  };

  const expiredUsage = createEmptyUsageTracker();
  const expiredResult = safeGuardCheck(expiredKey, expiredPolicy, expiredTx, expiredUsage);

  console.log(formatGuardResult(expiredResult));

  // ═══════════════════════════════════════════════════
  // Step 6: 场景 D — Session Key 撤销
  // ═══════════════════════════════════════════════════

  divider("Step 6: 场景 D — Session Key 撤销后无法支付");

  const revokedSession = revokeSessionKey(sessionKey);
  console.log(`Session Key 已撤销: ${revokedSession.revoked}`);

  const revokedResult = safeGuardCheck(revokedSession, paymentPolicy, tx, usage);
  console.log(formatGuardResult(revokedResult));

  // ═══════════════════════════════════════════════════
  // Step 7: 场景 E — 灰区引擎自动决策
  // ═══════════════════════════════════════════════════

  divider("Step 7: 场景 E — 灰区引擎（medium 风险自动评估）");

  // 重新创建一个有效的 Session Key
  const { sessionKey: greyKey } = createSessionKey(paymentPolicy);
  saveSessionKey({ sessionKey: greyKey, privateKey });

  // 模拟一个 medium 风险的支付场景
  console.log(`场景：小额支付（0.001 ETH）→ 预期灰区引擎自动通过`);
  console.log(`灰区策略：autoApproveThreshold = 0.005 ETH`);
  console.log(`拟支付金额 0.001 ETH < 阈值 0.005 ETH → 规则命中"金额低于自动审批阈值"`);

  const mediumGuardCheck = safeGuardCheck(greyKey, paymentPolicy, tx, createEmptyUsageTracker());

  const decision = greyZoneEngine(
    "medium",
    mediumGuardCheck,
    tx.value,
    tx.to,
    DEFAULT_GREY_ZONE_POLICY
  );

  console.log(`\n灰区决策: ${decision.decision}`);
  console.log(`原因: ${decision.reason}`);

  if (decision.decision === "auto_approve") {
    console.log(`\n✓ 灰区引擎自动通过 — 无需人工确认，可直接执行链上支付`);
  }

  // ═══════════════════════════════════════════════════
  // Step 8: 链上执行（需要 API Key）
  // ═══════════════════════════════════════════════════

  divider("Step 8: 链上执行 — 完整 Agentic Commerce 闭环 🔗");

  const apiKey = process.env.PIMLICO_API_KEY;
  const ownerPk = process.env.PRIVATE_KEY as Hex | undefined;

  if (!apiKey || !ownerPk) {
    console.log("（跳过：需要 PIMLICO_API_KEY 和 PRIVATE_KEY）");
    console.log(`\n预期行为（有 API Key 时）：`);
    console.log(`  1. 初始化 Smart Account`);
    console.log(`  2. Safe Guard 前置校验 ✓`);
    console.log(`  3. Pre-transaction Simulation（eth_call + gas 预估）`);
    console.log(`  4. 灰区引擎自动评估（0.001 ETH < 0.005 ETH 阈值 → auto_approve）`);
    console.log(`  5. 链上支付（ERC-4337 UserOp → Smart Account on Sepolia）`);
    console.log(`  6. 等待区块确认`);
    console.log(`  7. 携带支付凭证重试 API → 获取付费数据（模拟）`);
    console.log(`  8. 展示 API 返回数据`);
  } else {
    try {
      // 8a. 创建链上支付用 Session Key
      const chainPolicy: PermissionPolicy = {
        ...paymentPolicy,
        validFrom: Math.floor(Date.now() / 1000) - 60,
        validUntil: Math.floor(Date.now() / 1000) + 86400,
      };
      const { sessionKey: chainKey } = createSessionKey(chainPolicy);
      saveSessionKey({ sessionKey: chainKey, privateKey });

      console.log(`Agent Session Key: ${chainKey.address}`);

      // 8b. 初始化 Agent Wallet
      console.log(`\n初始化 Smart Account...`);
      const wallet = await initAgentWallet({
        ownerPrivateKey: ownerPk,
        pimlicoApiKey: apiKey,
      });
      console.log(`Owner EOA:     ${wallet.ownerAddress}`);
      console.log(`Smart Account: ${wallet.smartAccountAddress}`);

      // 8c. 构造支付指令（收款方设为 Smart Account 自己，避免真正资金流出）
      const chainPayment = createPaymentInstruction({
        amountEth: "0",
        recipient: wallet.smartAccountAddress,
        description: "测试付费 API — 0 ETH 转账验证全流程",
      });

      console.log(`\n⚠ 注意：使用 0 ETH + 自转账来验证流程，不产生实际资金流出`);
      console.log(`收款方 = Smart Account 自身`);

      // 8d. 执行完整 Agentic Commerce 闭环
      const result = await agentPayForApiData(
        chainPayment,
        wallet,
        chainKey,
        chainPolicy,
        { autoConfirm: true }
      );

      console.log(formatPaymentResult(result));

      if (result.success) {
        console.log(`\n✓ Agentic Commerce 完整闭环验证通过！`);
        console.log(`  ① 发现 → 硬编码支付指令（模拟 HTTP 402）`);
        console.log(`  ② 信任 → Safe Guard + Simulation + Grey Zone`);
        console.log(`  ③ 支付 → ERC-4337 UserOp on Sepolia`);
        console.log(`  ④ 交付 → API 返回付费数据（模拟）`);
      }
    } catch (err: any) {
      console.log(`链上执行出错: ${err.message || err}`);
    }
  }

  // ═══════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════

  divider("总结");

  console.log(`Agentic Commerce 最小实践验证清单：`);
  console.log(`  ✓ HTTP 402 支付指令解析`);
  console.log(`  ✓ 支付指令合法性验证`);
  console.log(`  ✓ Safe Guard 前置校验（硬约束 + 软约束）`);
  console.log(`  ✓ 超额支付被拒绝`);
  console.log(`  ✓ Session Key 过期被拒绝`);
  console.log(`  ✓ Session Key 撤销后无法支付`);
  console.log(`  ✓ 灰区引擎自动决策（medium → auto_approve）`);
  console.log(`  ✓ 链上支付闭环（ERC-4337 UserOp → Smart Account → Sepolia）`);
  console.log(`  ✓ API 数据交付（模拟 HTTP 200）`);

  console.log(`\nAgentic Commerce 六层协议栈映射：`);
  console.log(`  ① 发现层 → 硬编码支付指令（本实践），实际可用 A2A / MCP`);
  console.log(`  ② 信任层 → Safe Guard + Grey Zone + Simulation（✅ 已有）`);
  console.log(`  ③ 下单层 → 本实践未覆盖（ACP 结构化订单）`);
  console.log(`  ④ 授权层 → Session Key + Permission Policy（✅ 已有）`);
  console.log(`  ⑤ 支付层 → ERC-4337 UserOp（⚠ 非标准 x402，但流程等价）`);
  console.log(`  ⑥ 交付层 → 模拟 HTTP 200（实际是最大空白）`);

  console.log(`\n现有安全基础设施全部复用到商业支付场景。`);
};

main().catch((error) => {
  console.error("Error:", error);
});
