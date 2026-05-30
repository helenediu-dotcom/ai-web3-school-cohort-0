const { checkPermission } = require("./permission-policy");
const { isSessionKeyValid } = require("./session-key");

// === Safe Guard：执行前守卫层 ===
//
// 两层判断（来自 Handbook Safe Guard 设计）：
// 1. 确定性规则 → 直接拒绝（硬约束）
// 2. 灰区判断 → 升级到人工确认（软约束）

/**
 * @typedef {Object} GuardCheck
 * @property {boolean}          passed
 * @property {GuardCheckItem[]} checks
 * @property {boolean}          requiresHumanReview
 * @property {string}           [humanReviewReason]
 */

/**
 * @typedef {Object} GuardCheckItem
 * @property {string}  name
 * @property {boolean} passed
 * @property {string}  detail
 * @property {"hard"|"soft"} level
 */

/**
 * @param {import("./session-key").SessionKey} session
 * @param {import("./permission-policy").PermissionPolicy} policy
 * @param {import("./permission-policy").TransactionRequest} tx
 * @param {import("./permission-policy").UsageTracker} usage
 * @returns {GuardCheck}
 */
function safeGuardCheck(session, policy, tx, usage) {
  /** @type {GuardCheckItem[]} */
  const checks = [];
  let hasHardFailure = false;
  let needsHuman = false;
  let humanReason = "";

  // === 硬约束 ===

  // 1. Session Key 状态
  const keyCheck = isSessionKeyValid(session);
  if (!keyCheck.valid) {
    checks.push({
      name: "Session Key 状态",
      passed: false,
      detail: keyCheck.reason,
      level: "hard",
    });
    hasHardFailure = true;
  } else {
    checks.push({
      name: "Session Key 状态",
      passed: true,
      detail: "有效",
      level: "hard",
    });
  }

  // 2. 权限策略检查（七维约束）
  const permResult = checkPermission(policy, tx, usage);
  if (!permResult.allowed) {
    checks.push({
      name: "权限策略",
      passed: false,
      detail: permResult.reason,
      level: "hard",
    });
    hasHardFailure = true;
  } else {
    checks.push({
      name: "权限策略",
      passed: true,
      detail: "七维约束全部通过",
      level: "hard",
    });
  }

  // === 软约束：灰区判断 ===

  // 灰区 1：零值合约调用（可能是 approve 等高危操作）
  if (tx.value === 0n && tx.data !== "0x" && tx.data.length >= 10) {
    checks.push({
      name: "零值合约调用",
      passed: true,
      detail: `调用 ${tx.data.slice(0, 10)}，请确认意图`,
      level: "soft",
    });
    needsHuman = true;
    humanReason = "该交易不涉及 ETH 转账，但会调用合约函数。请确认这是你的意图。";
  }

  // 灰区 2：白名单为空提醒
  if (
    policy.contractWhitelist.length === 0 &&
    tx.to !== "0x0000000000000000000000000000000000000000"
  ) {
    checks.push({
      name: "合约白名单未设置",
      passed: true,
      detail: "当前策略未限制目标合约，存在风险",
      level: "soft",
    });
  }

  return {
    passed: !hasHardFailure,
    checks,
    requiresHumanReview: needsHuman,
    humanReviewReason: needsHuman ? humanReason : undefined,
  };
}

// 格式化 Guard 结果
function formatGuardResult(result) {
  const lines = [];
  const status = result.passed ? "✓ 通过" : "✗ 拒绝";

  lines.push(`Safe Guard 检查结果：${status}`);
  lines.push("─".repeat(50));

  for (const check of result.checks) {
    const icon = check.passed ? "✓" : "✗";
    const level = check.level === "hard" ? "[硬约束]" : "[灰区]";
    lines.push(`${icon} ${level} ${check.name}: ${check.detail}`);
  }

  if (result.requiresHumanReview) {
    lines.push("");
    lines.push(`⚠ 需要人工确认：${result.humanReviewReason}`);
  }

  return lines.join("\n");
}

module.exports = { safeGuardCheck, formatGuardResult };
