// components/SimulationReport.tsx
"use client";

import type { Simulation } from "@/lib/types";
import styles from "./SimulationReport.module.css";

interface SimulationReportProps {
  simulation: Simulation;
}

export default function SimulationReport({ simulation }: SimulationReportProps) {
  if (!simulation.success) {
    return (
      <div className={styles.card}>
        <div className={styles.title}>③ Simulation 报告 — 失败 ✗</div>
        {simulation.error && (
          <div className={styles.error}>
            Simulation 执行失败：{simulation.error}
          </div>
        )}
      </div>
    );
  }

  const { callSim, gasEstimate } = simulation;
  const riskClass =
    simulation.riskLevel === "low"
      ? styles.riskLow
      : simulation.riskLevel === "medium"
        ? styles.riskMedium
        : styles.riskHigh;

  return (
    <div className={styles.card}>
      <div className={styles.title}>③ Simulation 报告</div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>链上模拟</div>
        <div className={styles.value}>
          {callSim.success ? "✓ 成功" : "✗ 失败"}
          {callSim.simulatedAtBlock &&
            ` （区块 #${callSim.simulatedAtBlock}）`}
        </div>
        {callSim.revertReason && (
          <div className={styles.error}>Revert 原因：{callSim.revertReason}</div>
        )}
        {callSim.fromBalanceChange && (
          <div className={styles.value} style={{ marginTop: 4 }}>
            余额：{callSim.fromBalanceChange.before} →{" "}
            {callSim.fromBalanceChange.after} ETH
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Gas 预估</div>
        <div className={styles.value}>
          预估 Gas：~{gasEstimate.estimatedTotalEth} ETH
        </div>
        <div className={styles.value} style={{ fontSize: 13 }}>
          Paymaster：{gasEstimate.paymasterSponsored ? "赞助 ✓" : "无赞助 ✗"}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>风险等级</div>
        <span className={`${styles.value} ${riskClass}`}>
          {simulation.riskLevel.toUpperCase()}
        </span>
      </div>

      {simulation.warnings.length > 0 && (
        <div className={styles.warnings}>
          {simulation.warnings.map((w, i) => (
            <div className={styles.warning} key={i}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      <div className={styles.summary}>{simulation.summary}</div>
    </div>
  );
}
