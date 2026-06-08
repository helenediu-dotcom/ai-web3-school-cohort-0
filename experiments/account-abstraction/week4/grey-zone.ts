import { Address } from "viem";
import type { GuardCheck } from "./safe-guard";
import type { RiskLevel } from "./pre-tx-sim";

// === 灰区规则引擎 ===
//
// 当 riskLevel = "medium" 时，不直接丢给人工确认，
// 而是用确定性规则判断是否能自动通过。
//
// 原则（来自 Handbook AI Security）：
//   - Guard 层不调 LLM，所有规则必须确定性
//   - 签名前模拟 + 规则引擎 = 纵深防御

export interface GreyZonePolicy {
  /** 低于此金额（wei）可自动通过，即使有 warning */
  autoApproveThreshold: bigint;
  /** 信任地址列表（如常用接收方、已验证合约） */
  trustedRecipients: Address[];
  /** 配置覆盖 */
  requireHumanWhen: {
    /** Guard 软约束触发时强制人工确认 */
    guardSoftFailure: boolean;
    /** gas 占比高时强制人工确认 */
    highGasRatio: boolean;
  };
}

export interface GreyZoneDecision {
  decision: "auto_approve" | "escalate";
  reason: string;
}

export const DEFAULT_GREY_ZONE_POLICY: GreyZonePolicy = {
  autoApproveThreshold: 5_000_000_000_000_000n, // 0.005 ETH
  trustedRecipients: [],
  requireHumanWhen: {
    guardSoftFailure: true,
    highGasRatio: true,
  },
};

/**
 * 灰区决策引擎
 *
 * @param riskLevel — 必须是 "medium"，其他等级不由本函数处理
 * @param guardCheck — Safe Guard 检查结果
 * @param txValue — 交易金额（wei）
 * @param txTo — 交易目标地址
 * @param policy — 灰区策略配置
 */
export function greyZoneEngine(
  riskLevel: RiskLevel,
  guardCheck: GuardCheck,
  txValue: bigint,
  txTo: Address,
  policy: GreyZonePolicy = DEFAULT_GREY_ZONE_POLICY
): GreyZoneDecision {
  // 防御性检查：只处理 medium
  if (riskLevel !== "medium") {
    return {
      decision: "escalate",
      reason: `风险等级 ${riskLevel} 不在灰区范围内，升级人工确认`,
    };
  }

  const hasGuardSoftFailure = guardCheck.checks.some(
    (c) => c.level === "soft" && !c.passed
  );
  const hasHighGasRatio = guardCheck.checks.some(
    (c) => c.name.includes("gas") || c.name.includes("Gas")
  );

  // 规则 1: Guard 软约束触发 + 策略要求强制人工 → escalate
  if (
    hasGuardSoftFailure &&
    policy.requireHumanWhen.guardSoftFailure
  ) {
    return {
      decision: "escalate",
      reason: "Guard 软约束触发，需人工确认交易意图",
    };
  }

  // 规则 2: gas 占比高 + 策略要求强制人工 → escalate
  if (
    hasHighGasRatio &&
    policy.requireHumanWhen.highGasRatio
  ) {
    return {
      decision: "escalate",
      reason: "Gas 消耗占比过高，需人工确认",
    };
  }

  // 规则 3: 零值 + 信任地址 → auto_approve
  if (
    txValue === 0n &&
    policy.trustedRecipients.some(
      (r) => r.toLowerCase() === txTo.toLowerCase()
    )
  ) {
    return {
      decision: "auto_approve",
      reason: "零值调用 + 信任地址，自动通过",
    };
  }

  // 规则 4: 金额低于 autoApproveThreshold → auto_approve
  if (txValue <= policy.autoApproveThreshold) {
    return {
      decision: "auto_approve",
      reason: `金额低于自动审批阈值 (${policy.autoApproveThreshold} wei)，自动通过`,
    };
  }

  // 规则 5: 目标地址在信任列表 → auto_approve
  if (
    policy.trustedRecipients.some(
      (r) => r.toLowerCase() === txTo.toLowerCase()
    )
  ) {
    return {
      decision: "auto_approve",
      reason: "目标地址在信任列表中，自动通过",
    };
  }

  // 规则 6: 有 Guard 软约束 → escalate
  if (hasGuardSoftFailure) {
    return {
      decision: "escalate",
      reason: "Guard 检测到软约束警告，需人工确认",
    };
  }

  // 规则 7: 金额超过阈值 + 无任何信任信号 → escalate
  if (txValue > policy.autoApproveThreshold) {
    return {
      decision: "escalate",
      reason: `金额超过自动审批阈值 + 无信任信号，需人工确认`,
    };
  }

  // 兜底：escalate
  return {
    decision: "escalate",
    reason: "无自动通过规则命中，升级人工确认",
  };
}
