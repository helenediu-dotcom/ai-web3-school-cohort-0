// components/TxForm.tsx
"use client";

import { useState, FormEvent } from "react";
import styles from "./TxForm.module.css";

export interface TxFormData {
  to: string;
  value: string;
  data: string;
}

interface TxFormProps {
  onSubmit: (data: TxFormData) => void;
  loading: boolean;
}

export default function TxForm({ onSubmit, loading }: TxFormProps) {
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [data, setData] = useState("0x");
  const [error, setError] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!to.startsWith("0x") || to.length !== 42) {
      setError("目标地址格式无效：应为 0x + 40 hex 字符");
      return;
    }

    const valueNum = parseFloat(value);
    if (isNaN(valueNum) || valueNum < 0) {
      setError("金额无效：应为非负数字");
      return;
    }

    onSubmit({ to, value, data });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.title}>
        ① 发起交易
      </div>

      <div className={styles.field}>
        <label className={styles.label}>目标地址 (to)</label>
        <input
          className={styles.input}
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37"
          disabled={loading}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>金额 (ETH)</label>
        <input
          className={styles.input}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.001"
          disabled={loading}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>数据 (data, 可选)</label>
        <input
          className={styles.input}
          type="text"
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder="0x"
          disabled={loading}
        />
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <button className={styles.submit} type="submit" disabled={loading}>
        {loading ? "执行中..." : "执行交易"}
      </button>
    </form>
  );
}
