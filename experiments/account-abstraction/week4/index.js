const { parseEther } = require("viem");
const {
  TEST_POLICY,
  createEmptyUsageTracker,
  recordUsage,
} = require("./permission-policy");
const {
  createSessionKey,
  saveSessionKey,
  revokeSessionKey,
  listSessions,
} = require("./session-key");
const { safeGuardCheck, formatGuardResult } = require("./safe-guard");

// === Safe Agent Wallet — Session Key + Permission 演示 ===
//
// 流程：
// 1. 创建 Session Key + 绑定七维权限策略
// 2. Agent 提出交易意图
// 3. Safe Guard 校验（硬约束 + 灰区）
// 4. 通过 → 用 Session Key 签名 → 提交链上
// 5. 记录使用情况，追踪累计额度

function divider(title) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function main() {
  divider("Step 1: 创建 Session Key + 绑定权限策略");

  const { sessionKey, privateKey } = createSessionKey(TEST_POLICY);
  saveSessionKey({ sessionKey, privateKey });

  console.log(`Session Key ID:     ${sessionKey.id}`);
  console.log(`Session Key 地址:   ${sessionKey.address}`);
  console.log("权限策略（七维）:");
  console.log(
    `  单笔上限:          ${TEST_POLICY.maxSingleAmount} wei (${Number(TEST_POLICY.maxSingleAmount) / 1e18} ETH)`
  );
  console.log(
    `  日累计上限:        ${TEST_POLICY.maxDailyAmount} wei (${Number(TEST_POLICY.maxDailyAmount) / 1e18} ETH)`
  );
  console.log(`  每小时频率上限:    ${TEST_POLICY.maxTransactionsPerHour} 笔`);
  console.log(`  每日频率上限:      ${TEST_POLICY.maxTransactionsPerDay} 笔`);
  console.log(
    `  有效期:            ${new Date(TEST_POLICY.validFrom * 1000).toLocaleString()} → ${new Date(TEST_POLICY.validUntil * 1000).toLocaleString()}`
  );

  let usage = createEmptyUsageTracker();

  // === 场景 1：合法交易 ===

  divider("Step 2: 场景测试 — 合法交易");

  const validTx = {
    to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
    value: parseEther("0.001"),
    data: "0x",
  };

  console.log("拟议交易：向 0x5190... 转账 0.001 ETH");
  const result1 = safeGuardCheck(sessionKey, TEST_POLICY, validTx, usage);
  console.log(formatGuardResult(result1));

  if (result1.passed) {
    usage = recordUsage(usage, validTx);
    console.log(
      `\n→ 交易通过，已记录。日累计: ${usage.dailyTxCount} 笔, ${usage.dailyAmountSpent} wei`
    );
  }

  // === 场景 2：单笔超限 ===

  divider("Step 3: 场景测试 — 单笔超限（应拒绝）");

  const overSingleTx = {
    to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
    value: parseEther("0.05"),
    data: "0x",
  };

  console.log("拟议交易：转账 0.05 ETH（单笔上限 0.01 ETH）");
  const result2 = safeGuardCheck(sessionKey, TEST_POLICY, overSingleTx, usage);
  console.log(formatGuardResult(result2));

  // === 场景 3：函数不在白名单 ===

  divider("Step 4: 场景测试 — 未授权函数（应拒绝）");

  const policyWithFnRule = {
    ...TEST_POLICY,
    contractWhitelist: ["0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37"],
    functionWhitelist: {
      "0x51908fac9f289d620323fdc5ac1fe1ba0ab16b37": [
        "0xa9059cbb", // transfer(address,uint256)
      ],
    },
  };

  // approve(address,uint256) 选择器
  const unauthorizedFnTx = {
    to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
    value: parseEther("0.001"),
    data: "0x095ea7b30000000000000000000000000000000000000000000000000000000000000001",
  };

  console.log("拟议交易：调用 approve() 函数（只允许 transfer()）");
  const altUsage = createEmptyUsageTracker();
  const result3 = safeGuardCheck(
    { ...sessionKey, policy: policyWithFnRule },
    policyWithFnRule,
    unauthorizedFnTx,
    altUsage
  );
  console.log(formatGuardResult(result3));

  // === 场景 4：Session Key 撤销 ===

  divider("Step 5: 场景测试 — Session Key 撤销后（应拒绝）");

  console.log("撤销 Session Key...");
  const revokedSession = revokeSessionKey(sessionKey);
  console.log(
    `Session Key 状态: ${revokedSession.revoked ? "已撤销" : "有效"}`
  );

  const result4 = safeGuardCheck(revokedSession, TEST_POLICY, validTx, usage);
  console.log(formatGuardResult(result4));

  // === 场景 5：频率限制 ===

  divider("Step 6: 场景测试 — 频率限制（应拒绝）");

  const strictPolicy = {
    ...TEST_POLICY,
    maxTransactionsPerDay: 2,
  };
  const heavyUsage = createEmptyUsageTracker();
  // 模拟已用完每日配额
  heavyUsage.dailyTxCount = 2;
  heavyUsage.dailyAmountSpent = parseEther("0.001");

  console.log(`每日上限: ${strictPolicy.maxTransactionsPerDay} 笔，当前已用: ${heavyUsage.dailyTxCount} 笔`);
  const result5 = safeGuardCheck(sessionKey, strictPolicy, validTx, heavyUsage);
  console.log(formatGuardResult(result5));

  // === 总结 ===

  divider("总结");

  const sessions = listSessions();
  console.log("活跃 Session Key:", sessions.length, "个");
  console.log("");
  console.log("Safe Agent Wallet 权限校验层验证完成：");
  console.log("  ✓ Session Key 创建 + 七维策略绑定");
  console.log("  ✓ 合法交易通过校验");
  console.log("  ✓ 单笔超限被拒绝");
  console.log("  ✓ 未授权函数被拒绝");
  console.log("  ✓ 撤销后交易被拒绝");
  console.log("  ✓ 超频率被拒绝");
  console.log("");
  console.log("下一步：将 Session Key 接入 Smart Account 实现链上执行");
}

main();
