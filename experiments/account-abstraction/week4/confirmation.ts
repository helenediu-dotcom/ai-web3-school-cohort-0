import * as readline from "readline";
import type { SimulationReport } from "./pre-tx-sim";
import { formatSimulationReport } from "./pre-tx-sim";

// === 可注入确认函数类型 ===
// 非 CLI 环境可注入 mock（如 async () => true）
export type ConfirmationFn = (
  report: SimulationReport,
  autoConfirm?: boolean
) => Promise<boolean>;

// === 默认实现：终端 y/n ===

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
        // 空输入或无效 → 默认值
        resolve(defaultYes);
      }
    });
  });
}

export async function getUserConfirmation(
  report: SimulationReport,
  autoConfirm = false
): Promise<boolean> {
  if (autoConfirm) {
    return true;
  }

  // low 风险：展示摘要，自动通过
  if (report.riskLevel === "low") {
    console.log(formatSimulationReport(report));
    return true;
  }

  // medium / high 风险：展示完整报告 + 询问用户
  console.log(formatSimulationReport(report));

  if (report.riskLevel === "high") {
    console.log("⚠ 风险等级为 HIGH，强烈建议拒绝此交易。");
  }

  return askYesNo("是否继续执行此交易？", false);
}
