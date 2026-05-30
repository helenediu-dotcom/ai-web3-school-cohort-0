import {
  PermissionPolicy,
  TransactionRequest,
  UsageTracker,
  CheckResult,
  checkPermission,
} from "./permission-policy";
import { SessionKey, isSessionKeyValid } from "./session-key";

// === Safe Guard：执行前守卫层 ===
//
// 两层判断（来自 Handbook Safe Guard 设计）：
// 1. 确定性规则 → 直接拒绝（硬约束，无例外）
// 2. 灰区判断 → 升级到人工确认（软约束）

export interface GuardCheck {
  passed: boolean;
  checks: GuardCheckItem[];
  requiresHumanReview: boolean;
  humanReviewReason?: string;
}

export interface GuardCheckItem {
  name: string;
  passed: boolean;
  detail: string;
  level: "hard" | "soft"; // hard = 确定性拒绝, soft = 灰区需人工
}

export function safeGuardCheck(
  session: SessionKey,
  policy: PermissionPolicy,
  tx: TransactionRequest,
  usage: UsageTracker
): GuardCheck {
  const checks: GuardCheckItem[] = [];
  let hasHardFailure = false;
  let needsHuman = false;
  let humanReason = "";

  // === 硬约束：确定性规则 ===

  // 1. Session Key 状态检查
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
  const permResult: CheckResult = checkPermission(policy, tx, usage);
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

  // 灰区 1：value = 0 的交易（可能是合约调用，不是转账）
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

  // 灰区 2：白名单为空时的提醒
  if (policy.contractWhitelist.length === 0 && tx.to !== "0x0000000000000000000000000000000000000000") {
    checks.push({
      name: "合约白名单未设置",
      passed: true,
      detail: "当前策略未限制目标合约，存在风险",
      level: "soft",
    });
    // 仅提醒，不阻断
  }

  return {
    passed: !hasHardFailure,
    checks,
    requiresHumanReview: needsHuman,
    humanReviewReason: needsHuman ? humanReason : undefined,
  };
}

// 格式化 Guard 结果，用于展示给用户
export function formatGuardResult(result: GuardCheck): string {
  const lines: string[] = [];
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
