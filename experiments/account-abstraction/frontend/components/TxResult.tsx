// components/TxResult.tsx
"use client";

import styles from "./TxResult.module.css";

interface TxResultProps {
  stage: "executed" | "execution_failed";
  txHash?: string;
  etherscanUrl?: string;
  error?: string;
}

export default function TxResult({
  stage,
  txHash,
  etherscanUrl,
  error,
}: TxResultProps) {
  const isSuccess = stage === "executed";
  const cardClass = `${styles.card} ${isSuccess ? styles.cardSuccess : styles.cardFailed}`;
  const titleClass = `${styles.title} ${isSuccess ? styles.titleSuccess : styles.titleFailed}`;

  return (
    <div className={cardClass}>
      <div className={titleClass}>
        ⑤ 交易结果 — {isSuccess ? "已提交 ✓" : "失败 ✗"}
      </div>

      {isSuccess && txHash && (
        <>
          <div className={styles.field}>
            <div className={styles.label}>Transaction Hash</div>
            <div className={styles.value}>{txHash}</div>
          </div>
          {etherscanUrl && (
            <a
              className={styles.link}
              href={etherscanUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              在 Etherscan 上查看 →
            </a>
          )}
        </>
      )}

      {!isSuccess && error && (
        <div className={styles.error}>{error}</div>
      )}
    </div>
  );
}
