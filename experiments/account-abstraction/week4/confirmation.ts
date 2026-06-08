import * as readline from "readline";
import type { SimulationReport } from "./pre-tx-sim";
import { formatSimulationReport } from "./pre-tx-sim";
import type { GuardCheck } from "./safe-guard";
import type { TransactionRequest } from "./permission-policy";
import {
  greyZoneEngine,
  GreyZonePolicy,
  DEFAULT_GREY_ZONE_POLICY,
  GreyZoneDecision,
} from "./grey-zone";

// === 确认上下文 ===
// 传入 Guard 结果和交易信息，供灰区引擎使用

export interface ConfirmationContext {
  guardCheck: GuardCheck;
  tx: TransactionRequest;
  greyZonePolicy?: GreyZonePolicy;
}

// === 可注入确认函数类型 ===
export type ConfirmationFn = (
  report: SimulationReport,
  autoConfirm?: boolean,
  context?: ConfirmationContext
) => Promise<{ confirmed: boolean; autoApproved?: boolean; autoApprovalReason?: string }>;

// === 默认实现：5 级风险分流 ===

function askYesNo(question: string, defaultYes = false): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hint = defaultYes ? "[y]/n" : "y/[n]";
  return new Promise((resolve) => {
    rl.question(`${question} ${hint}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "y" || trimmed === "yes") {
        resolve(true);
      } else if (trimmed === "n" || trimmed === "no") {
        resolve(false);
      } else {
        resolve(defaultYes);
      }
    });
  });
}

export async function getUserConfirmation(
  report: SimulationReport,
  autoConfirm = false,
  context?: ConfirmationContext
): Promise<{ confirmed: boolean; autoApproved?: boolean; autoApprovalReason?: string }> {
  if (autoConfirm) {
    return { confirmed: true };
  }

  // ── critical: 直接拒绝 ──
  if (report.riskLevel === "critical") {
    console.log(formatSimulationReport(report));
    console.log("⛔ 风险等级为 CRITICAL，交易已自动拒绝。");
    return { confirmed: false };
  }

  // ── high: 强制人工确认 ──
  if (report.riskLevel === "high") {
    console.log(formatSimulationReport(report));
    console.log("⚠ 风险等级为 HIGH，建议仔细审核后再确认。");
    const answer = await askYesNo("是否继续执行此交易？", false);
    return { confirmed: answer };
  }

  // ── medium: 灰区规则引擎 ──
  if (report.riskLevel === "medium" && context) {
    const decision = greyZoneEngine(
      "medium",
      context.guardCheck,
      context.tx.value,
      context.tx.to,
      context.greyZonePolicy
    );

    if (decision.decision === "auto_approve") {
      console.log(formatSimulationReport(report));
      console.log(`🤖 灰区引擎自动通过：${decision.reason}`);
      return {
        confirmed: true,
        autoApproved: true,
        autoApprovalReason: decision.reason,
      };
    }

    // escalate → 人工确认
    console.log(formatSimulationReport(report));
    console.log(`⚠ 灰区引擎无法自动决策：${decision.reason}`);
    const answer = await askYesNo("是否继续执行此交易？", false);
    return { confirmed: answer };
  }

  // ── low: 展示摘要，自动通过 ──
  if (report.riskLevel === "low") {
    console.log(formatSimulationReport(report));
    return { confirmed: true };
  }

  // ── trivial: 静默通过 ──
  // （不展示报告，极简输出）
  console.log(`⚪ 交易风险极低，静默通过（${report.summary}）`);
  return { confirmed: true, autoApproved: true };
}
