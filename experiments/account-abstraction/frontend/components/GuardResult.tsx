// components/GuardResult.tsx
"use client";

import type { GuardCheck } from "@/lib/types";
import styles from "./GuardResult.module.css";

interface GuardResultProps {
  guardCheck: GuardCheck;
}

export default function GuardResult({ guardCheck }: GuardResultProps) {
  const passed = guardCheck.passed;
  const cardClass = `${styles.card} ${passed ? styles.cardPassed : styles.cardRejected}`;
  const titleClass = `${styles.title} ${passed ? styles.titlePassed : styles.titleRejected}`;

  return (
    <div className={cardClass}>
      <div className={titleClass}>
        ② Safe Guard 检查 — {passed ? "通过 ✓" : "拒绝 ✗"}
      </div>

      <div className={styles.checks}>
        {guardCheck.checks.map((check, i) => (
          <div className={styles.checkItem} key={i}>
            <span
              className={`${styles.icon} ${check.passed ? styles.iconPass : styles.iconFail}`}
            >
              {check.passed ? "✓" : "✗"}
            </span>
            <span
              className={`${styles.level} ${check.level === "hard" ? styles.levelHard : styles.levelSoft}`}
            >
              {check.level === "hard" ? "硬约束" : "灰区"}
            </span>
            <span className={styles.detail}>
              <strong>{check.name}</strong>: {check.detail}
            </span>
          </div>
        ))}
      </div>

      {guardCheck.requiresHumanReview && guardCheck.humanReviewReason && (
        <div className={styles.reviewNotice}>
          ⚠ 需要人工确认：{guardCheck.humanReviewReason}
        </div>
      )}
    </div>
  );
}
