// app/page.tsx
"use client";

import { useState } from "react";
import type { AppStage, GuardCheck, Simulation, Phase1Response, Phase2Response } from "@/lib/types";
import TxForm, { TxFormData } from "@/components/TxForm";
import GuardResult from "@/components/GuardResult";
import SimulationReport from "@/components/SimulationReport";
import TxResult from "@/components/TxResult";
import styles from "./page.module.css";

export default function Home() {
  const [stage, setStage] = useState<AppStage>("idle");
  const [guardCheck, setGuardCheck] = useState<GuardCheck | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [etherscanUrl, setEtherscanUrl] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastFormData, setLastFormData] = useState<TxFormData | null>(null);

  // Phase 1: 提交交易 → guard + sim
  async function handlePhase1(data: TxFormData) {
    setStage("loading_guard");
    setGuardCheck(null);
    setSimulation(null);
    setTxHash(null);
    setEtherscanUrl(null);
    setTxError(null);
    setSessionId(null);
    setLastFormData(data);

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.to,
          value: data.value,
          data: data.data,
          autoConfirm: false,
        }),
      });

      const json: Phase1Response = await res.json();

      setGuardCheck(json.guardCheck);
      if (json.simulation) setSimulation(json.simulation);
      if (json.sessionId) setSessionId(json.sessionId);

      if (json.stage === "guard_rejected") {
        setStage("guard_rejected");
      } else if (json.stage === "simulation_failed") {
        setStage("simulation_failed");
      } else if (json.stage === "guard_passed") {
        setStage("guard_passed");
      } else {
        // 缺少 stage（如校验错误返回 { error: "..." }）
        setStage("execution_failed");
        setTxError((json as any).error || "未知服务器响应");
      }
    } catch (err: any) {
      setStage("execution_failed");
      setTxError(err.message || "网络请求失败");
    }
  }

  // Phase 2: 用户确认 → 链上执行
  async function handlePhase2() {
    if (!lastFormData || !sessionId) return;

    setStage("loading_execute");

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: lastFormData.to,
          value: lastFormData.value,
          data: lastFormData.data,
          autoConfirm: true,
          sessionId,
        }),
      });

      const json: Phase2Response = await res.json();

      if (json.stage === "executed") {
        setTxHash(json.txHash || null);
        setEtherscanUrl(json.etherscanUrl || null);
        setStage("executed");
      } else {
        setTxError(json.error || "执行失败");
        setStage("execution_failed");
      }
    } catch (err: any) {
      setTxError(err.message || "网络请求失败");
      setStage("execution_failed");
    }
  }

  function handleCancel() {
    // 回到初始状态
    setStage("idle");
    setGuardCheck(null);
    setSimulation(null);
    setTxHash(null);
    setEtherscanUrl(null);
    setTxError(null);
    setSessionId(null);
  }

  function handleReset() {
    handleCancel();
  }

  const isLoading = stage === "loading_guard" || stage === "loading_execute";

  return (
    <div className="container">
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>Safe Agent Wallet</h1>
        <p className={styles.headerSubtitle}>
          Agent 不拥有钱包，它只拥有一组可限制、可审计、可撤销的链上能力
        </p>
      </header>

      <TxForm onSubmit={handlePhase1} loading={isLoading} />

      {guardCheck && (
        <GuardResult guardCheck={guardCheck} />
      )}

      {simulation && (
        <SimulationReport simulation={simulation} />
      )}

      {stage === "guard_passed" && (
        <div className={styles.confirmSection}>
          <button
            className={styles.confirmBtn}
            onClick={handlePhase2}
            disabled={isLoading}
          >
            ④ 确认并执行
          </button>
          <button
            className={styles.cancelBtn}
            onClick={handleCancel}
            disabled={isLoading}
          >
            取消
          </button>
        </div>
      )}

      {(stage === "executed" || stage === "execution_failed") && (
        <>
          <TxResult
            stage={stage === "executed" ? "executed" : "execution_failed"}
            txHash={txHash ?? undefined}
            etherscanUrl={etherscanUrl ?? undefined}
            error={txError ?? undefined}
          />
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <button className={styles.cancelBtn} onClick={handleReset}>
              发起新交易
            </button>
          </div>
        </>
      )}

      {stage === "guard_rejected" && (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <button className={styles.cancelBtn} onClick={handleReset}>
            返回
          </button>
        </div>
      )}

      {stage === "simulation_failed" && (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <button className={styles.cancelBtn} onClick={handleReset}>
            返回
          </button>
        </div>
      )}

      <div className={styles.statusBar}>
        Sepolia Testnet · ERC-4337 Smart Account · Pimlico Bundler + Paymaster
      </div>
    </div>
  );
}
