import { parseEther, Hex } from "viem";
import {
  TEST_POLICY,
  PermissionPolicy,
  TransactionRequest,
  UsageTracker,
  createEmptyUsageTracker,
  recordUsage,
} from "./permission-policy";
import {
  createSessionKey,
  saveSessionKey,
  revokeSessionKey,
  listSessions,
} from "./session-key";
import { safeGuardCheck, formatGuardResult } from "./safe-guard";

// === 演示：Safe Agent Wallet 完整流程 ===
//
// 流程：
// 1. 用户创建 Session Key，绑定七维权限策略
// 2. Agent 提出交易意图
// 3. Safe Guard 校验（硬约束 + 灰区判断）
// 4. 通过 → 用 Session Key 签名 → 提交链上
// 5. 记录使用情况，追踪累计额度
//
// 本演示侧重步骤 1-4 的权限校验层。
// 实际链上执行部分见 Day 9 的 index.ts（Smart Account + Bundler）。

function divider(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

const main = () => {
  divider("Step 1: 创建 Session Key + 绑定权限策略");

  const { sessionKey, privateKey } = createSessionKey(TEST_POLICY);
  saveSessionKey({ sessionKey, privateKey });

  console.log(`Session Key ID:     ${sessionKey.id}`);
  console.log(`Session Key 地址:   ${sessionKey.address}`);
  console.log(`权限策略（七维）:`);
  console.log(`  单笔上限:          ${TEST_POLICY.maxSingleAmount} wei (${Number(TEST_POLICY.maxSingleAmount) / 1e18} ETH)`);
  console.log(`  日累计上限:        ${TEST_POLICY.maxDailyAmount} wei (${Number(TEST_POLICY.maxDailyAmount) / 1e18} ETH)`);
  console.log(`  每小时频率上限:    ${TEST_POLICY.maxTransactionsPerHour} 笔`);
  console.log(`  每日频率上限:      ${TEST_POLICY.maxTransactionsPerDay} 笔`);
  console.log(`  有效期:            ${new Date(TEST_POLICY.validFrom * 1000).toLocaleString()} → ${new Date(TEST_POLICY.validUntil * 1000).toLocaleString()}`);

  let usage = createEmptyUsageTracker();

  // === 场景测试 ===

  divider("Step 2: 场景测试 — 合法交易 ✅");

  const validTx: TransactionRequest = {
    to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
    value: parseEther("0.001"), // 0.001 ETH，在限额内
    data: "0x",
  };

  console.log("拟议交易：向 0x5190... 转账 0.001 ETH");
  const result1 = safeGuardCheck(sessionKey, TEST_POLICY, validTx, usage);
  console.log(formatGuardResult(result1));

  if (result1.passed) {
    usage = recordUsage(usage, validTx);
    console.log(`\n→ 交易通过，已记录。日累计: ${usage.dailyTxCount} 笔, ${usage.dailyAmountSpent} wei`);
  }

  // ---

  divider("Step 3: 场景测试 — 单笔超限 ❌");

  const overSingleTx: TransactionRequest = {
    to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
    value: parseEther("0.05"), // 0.05 ETH > 0.01 ETH 单笔上限
    data: "0x",
  };

  console.log("拟议交易：向 0x5190... 转账 0.05 ETH（单笔上限 0.01 ETH）");
  const result2 = safeGuardCheck(sessionKey, TEST_POLICY, overSingleTx, usage);
  console.log(formatGuardResult(result2));

  // ---

  divider("Step 4: 场景测试 — 合约函数不在白名单 ❌");

  const policyWithFunctionRule: PermissionPolicy = {
    ...TEST_POLICY,
    contractWhitelist: ["0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37"],
    functionWhitelist: {
      "0x51908fac9f289d620323fdc5ac1fe1ba0ab16b37": [
        "0xa9059cbb", // transfer(address,uint256) — 只允许这个
      ],
    },
  };

  const unauthorizedFnTx: TransactionRequest = {
    to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
    value: parseEther("0.001"),
    data: "0x095ea7b30000000000000000000000000000000000000000000000000000000000000001", // approve(address,uint256) — 不在白名单
  };

  console.log("拟议交易：调用 approve() 函数（只允许 transfer()）");
  const altUsage = createEmptyUsageTracker();
  const result3 = safeGuardCheck(
    { ...sessionKey, policy: policyWithFunctionRule },
    policyWithFunctionRule,
    unauthorizedFnTx,
    altUsage
  );
  console.log(formatGuardResult(result3));

  // ---

  divider("Step 5: 场景测试 — Session Key 撤销 ❌");

  console.log("撤销 Session Key...");
  const revokedSession = revokeSessionKey(sessionKey);
  console.log(`Session Key 状态: ${revokedSession.revoked ? "已撤销" : "有效"}`);

  const result4 = safeGuardCheck(revokedSession, TEST_POLICY, validTx, usage);
  console.log(formatGuardResult(result4));

  // ---

  divider("Step 6: 当前 Session Key 列表");

  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log("（无活跃 Session Key）");
  } else {
    for (const s of sessions) {
      console.log(`- ${s.id}: ${s.address} (${s.revoked ? "已撤销" : "有效"})`);
    }
  }

  // ---

  divider("总结");

  console.log(`以上演示了 Safe Agent Wallet 的权限校验层：`);
  console.log(`  ✓ Session Key 创建 + 七维策略绑定`);
  console.log(`  ✓ 合法交易通过校验`);
  console.log(`  ✓ 超限交易被拒绝`);
  console.log(`  ✓ 未授权函数被拒绝`);
  console.log(`  ✓ 撤销后交易被拒绝`);
  console.log(`\n下一步 → 将 Session Key 接入 Smart Account，链上执行。`);
};

main();
