# Safe Agent Wallet 前端 UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Safe Agent Wallet MVP 加一个 Next.js Web 前端，支持「输入交易 → Safe Guard 校验 → Simulation 报告 → 用户确认 → 链上执行」的完整链路。

**Architecture:** Next.js App Router 单项目放入 `frontend/` 目录。API Route 直接 import 现有 `week4/` TypeScript 业务模块（不重写）。React 客户端组件从 API 拿到 JSON 渲染结果。两阶段 POST `/api/execute`：Phase 1 `autoConfirm=false` 跑 guard+sim 并返回报告，Phase 2 `autoConfirm=true` 直接执行链上交易（不重复 guard/sim）。

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, CSS Modules, 复用 week4 的 viem + permissionless 模块

---

### Task 1: 项目脚手架

**Files:**
- Create: `experiments/account-abstraction/frontend/package.json`
- Create: `experiments/account-abstraction/frontend/tsconfig.json`
- Create: `experiments/account-abstraction/frontend/next.config.js`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "safe-agent-wallet-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "viem": "^2.51.0",
    "permissionless": "^0.2.57",
    "dotenv": "^17.4.2"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: 创建 next.config.js**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing TypeScript source from parent week4/ directory.
  // Next.js by default only compiles files inside the project root.
  // We patch the webpack rule so that week4/*.ts files also get compiled.
  webpack: (config, { isServer }) => {
    if (isServer) {
      const path = require("path");
      const week4Path = path.resolve(__dirname, "..", "week4");

      // Extend every rule that handles ts/tsx to also include week4
      for (const rule of config.module.rules) {
        if (
          rule.test &&
          (rule.test.toString().includes("tsx") ||
            rule.test.toString().includes("ts"))
        ) {
          if (!rule.include) {
            rule.include = [];
          }
          if (Array.isArray(rule.include)) {
            rule.include.push(week4Path);
          } else {
            rule.include = [rule.include, week4Path];
          }
        }
      }
    }
    return config;
  },

  // Needed so SWC doesn't panic on optional chaining in week4 modules
  experimental: {
    esmExternals: "loose",
  },
};

module.exports = nextConfig;
```

- [ ] **Step 4: 安装依赖**

```bash
cd experiments/account-abstraction/frontend && npm install
```

Expected: `npm install` 成功，无报错。

- [ ] **Step 5: 验证脚手架**

```bash
cd experiments/account-abstraction/frontend && npx next dev --port 3001
```

Expected: Next.js 启动成功，输出 `Ready in ...` 和 `http://localhost:3001`。浏览器打开看到 404（正常，还没有页面）。

- [ ] **Step 6: Commit**

```bash
cd experiments/account-abstraction/frontend
git add package.json package-lock.json tsconfig.json next.config.js
git commit -m "feat: scaffold Next.js frontend project"
```

---

### Task 2: 共享类型定义

**Files:**
- Create: `experiments/account-abstraction/frontend/lib/types.ts`

客户端组件不能 import week4/ 下的 server 模块（viem、permissionless 不是浏览器包），所以把 API response 的类型定义放在独立的共享文件中。

- [ ] **Step 1: 创建 types.ts**

```typescript
// lib/types.ts — API response types for the frontend
// 所有 bigint 字段已序列化为 string（JSON 不支持 bigint）

export interface GuardCheckItem {
  name: string;
  passed: boolean;
  detail: string;
  level: "hard" | "soft";
}

export interface GuardCheck {
  passed: boolean;
  checks: GuardCheckItem[];
  requiresHumanReview: boolean;
  humanReviewReason?: string;
}

export interface BalanceChange {
  address: string;
  asset: string;
  before: string;
  after: string;
  delta: string;
}

export interface CallSim {
  success: boolean;
  revertReason?: string;
  fromBalanceChange: BalanceChange | null;
  simulatedAtBlock: string;
}

export interface GasEstimate {
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  estimatedTotalGas: string;
  estimatedTotalEth: string;
  paymasterSponsored: boolean;
}

export interface Simulation {
  success: boolean;
  callSim: CallSim;
  gasEstimate: GasEstimate;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
  error?: string;
}

// POST /api/execute response
export type ExecuteResponse =
  | Phase1Response
  | Phase2Response;

export interface Phase1Response {
  stage: "guard_passed" | "guard_rejected" | "simulation_failed";
  guardCheck: GuardCheck;
  simulation: Simulation | null;
  sessionId?: string; // guard_passed 时返回，Phase 2 用
}

export interface Phase2Response {
  stage: "executed" | "execution_failed";
  txHash?: string;
  etherscanUrl?: string;
  error?: string;
}

// Form state
export type AppStage =
  | "idle"
  | "loading_guard"
  | "guard_rejected"
  | "simulation_failed"
  | "guard_passed"
  | "loading_execute"
  | "executed"
  | "execution_failed";
```

- [ ] **Step 2: Commit**

```bash
cd experiments/account-abstraction/frontend
git add lib/types.ts
git commit -m "feat: add shared API response types"
```

---

### Task 3: API Route

**Files:**
- Create: `experiments/account-abstraction/frontend/app/api/execute/route.ts`

这是整个前端和后端业务逻辑的桥接层。两阶段逻辑在一个 handler 中。

- [ ] **Step 1: 创建 API route**

```typescript
// app/api/execute/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parseEther, Hex } from "viem";
import { initAgentWallet, AgentWalletInstance } from "../../../../week4/agent-wallet";
import {
  createSessionKey,
  saveSessionKey,
  SessionKey,
} from "../../../../week4/session-key";
import {
  TEST_POLICY,
  PermissionPolicy,
  TransactionRequest,
  UsageTracker,
  createEmptyUsageTracker,
} from "../../../../week4/permission-policy";
import { safeGuardCheck, GuardCheck } from "../../../../week4/safe-guard";
import {
  runPreTxSimulation,
  SimulationReport,
} from "../../../../week4/pre-tx-sim";
import { privateKeyToAccount } from "viem/accounts";

// ── Demo-only server-side state ──
// 生产环境应改用 Redis / DB
const sessionCache = new Map<
  string,
  {
    wallet: AgentWalletInstance;
    sessionKey: SessionKey;
    sessionPrivateKey: Hex;
    policy: PermissionPolicy;
    tx: TransactionRequest;
    guardCheck: GuardCheck;
    simulation: SimulationReport;
  }
>();

// ── Env var check (不输出私钥值) ──
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// ── bigint → string 递归序列化 ──
function serializeBigInt(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = serializeBigInt(v);
    }
    return result;
  }
  return obj;
}

// POST /api/execute
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, value, data, autoConfirm, sessionId } = body;

    // ── Phase 2: autoConfirm = true, 直接执行 ──
    if (autoConfirm) {
      if (!sessionId) {
        return NextResponse.json(
          { stage: "execution_failed", error: "缺少 sessionId" },
          { status: 400 }
        );
      }

      const cached = sessionCache.get(sessionId);
      if (!cached) {
        return NextResponse.json(
          { stage: "execution_failed", error: "Session 已过期或不存在" },
          { status: 400 }
        );
      }
      sessionCache.delete(sessionId);

      const { wallet, tx } = cached;

      try {
        const { fast: gasPrice } =
          await wallet.pimlicoClient.getUserOperationGasPrice();

        const userOpHash = await wallet.pimlicoClient.sendUserOperation({
          account: wallet.smartAccount,
          calls: [{ to: tx.to, value: tx.value, data: tx.data }],
          maxFeePerGas: BigInt(gasPrice.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(gasPrice.maxPriorityFeePerGas),
          paymaster: wallet.pimlicoClient,
        });

        const receipt = await wallet.pimlicoClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });

        const txHash = receipt.receipt.transactionHash;

        return NextResponse.json({
          stage: "executed",
          txHash,
          etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
        });
      } catch (err: any) {
        return NextResponse.json({
          stage: "execution_failed",
          error: `链上执行失败：${err.message || err}`,
        });
      }
    }

    // ── Phase 1: autoConfirm = false, 跑 guard + simulation ──

    // Validate required fields
    if (!to || value === undefined) {
      return NextResponse.json(
        { error: "缺少必填字段：to, value" },
        { status: 400 }
      );
    }

    // Read env vars (不输出值到日志)
    const pimlicoApiKey = requireEnv("PIMLICO_API_KEY");
    const ownerPrivateKey = requireEnv("OWNER_PRIVATE_KEY") as Hex;

    // Validate private key format
    if (!ownerPrivateKey.startsWith("0x") || ownerPrivateKey.length !== 66) {
      return NextResponse.json(
        { error: "OWNER_PRIVATE_KEY 格式无效：应为 0x + 64 hex 字符" },
        { status: 500 }
      );
    }

    // Parse transaction
    let valueBigInt: bigint;
    try {
      valueBigInt = parseEther(String(value));
    } catch {
      return NextResponse.json(
        { error: "value 格式无效：应为 ETH 字符串（如 0.001）" },
        { status: 400 }
      );
    }

    const tx: TransactionRequest = {
      to: to as Hex,
      value: valueBigInt,
      data: (data as Hex) || "0x",
    };

    // 1. Init wallet + session
    const wallet = await initAgentWallet({
      ownerPrivateKey,
      pimlicoApiKey,
    });

    // 日志只输出地址，不输出私钥
    console.log(`[execute] Owner EOA:   ${wallet.ownerAddress}`);
    console.log(`[execute] Smart Account: ${wallet.smartAccountAddress}`);

    const policy: PermissionPolicy = {
      ...TEST_POLICY,
      validFrom: Math.floor(Date.now() / 1000) - 60,
      validUntil: Math.floor(Date.now() / 1000) + 86400,
    };
    const { sessionKey, privateKey: sessionPk } = createSessionKey(policy);
    saveSessionKey({ sessionKey, privateKey: sessionPk });
    console.log(`[execute] Session Key: ${sessionKey.id}`);

    const usage: UsageTracker = createEmptyUsageTracker();

    // 2. Safe Guard
    const guardCheck = safeGuardCheck(sessionKey, policy, tx, usage);

    if (!guardCheck.passed) {
      const serialized = serializeBigInt({
        stage: "guard_rejected",
        guardCheck,
        simulation: null,
      });
      return NextResponse.json(serialized);
    }

    // 3. Pre-tx Simulation
    let fromBalance: bigint;
    try {
      fromBalance = await wallet.publicClient.getBalance({
        address: wallet.smartAccountAddress,
      });
    } catch {
      fromBalance = 0n;
    }

    let simulation: SimulationReport;
    try {
      simulation = await runPreTxSimulation(
        {
          smartAccount: {
            client: wallet.publicClient,
          },
          smartAccountAddress: wallet.smartAccountAddress,
          pimlicoClient: wallet.pimlicoClient,
        },
        tx,
        fromBalance
      );
    } catch (err: any) {
      const serialized = serializeBigInt({
        stage: "simulation_failed",
        guardCheck,
        simulation: {
          success: false,
          error: err.message || "Simulation 执行失败",
        },
      });
      return NextResponse.json(serialized);
    }

    // 4. Store session for Phase 2
    const sid = `sid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionCache.set(sid, {
      wallet,
      sessionKey,
      sessionPrivateKey: sessionPk,
      policy,
      tx,
      guardCheck,
      simulation,
    });

    const serialized = serializeBigInt({
      stage: "guard_passed",
      guardCheck,
      simulation,
      sessionId: sid,
    });
    return NextResponse.json(serialized);
  } catch (err: any) {
    console.error("[execute] Unhandled error:", err.message || err);
    return NextResponse.json(
      { error: `服务器错误：${err.message || err}` },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/execute/route.ts
git commit -m "feat: add POST /api/execute route — Phase 1 guard+sim, Phase 2 direct execution"
```

---

### Task 4: Root Layout

**Files:**
- Create: `experiments/account-abstraction/frontend/app/layout.tsx`
- Create: `experiments/account-abstraction/frontend/app/globals.css`

- [ ] **Step 1: 创建 globals.css**

```css
/* app/globals.css */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  background: #0d1117;
  color: #c9d1d9;
  line-height: 1.6;
  min-height: 100vh;
}

.container {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px;
}
```

- [ ] **Step 2: 创建 layout.tsx**

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Safe Agent Wallet",
  description: "Agent 不应该拥有钱包，它只应该拥有一组可限制、可审计、可撤销的链上能力",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: add root layout and global styles"
```

---

### Task 5: TxForm 组件

**Files:**
- Create: `experiments/account-abstraction/frontend/components/TxForm.tsx`
- Create: `experiments/account-abstraction/frontend/components/TxForm.module.css`

- [ ] **Step 1: 创建 CSS Module**

```css
/* components/TxForm.module.css */
.form {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: #58a6ff;
  margin-bottom: 16px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.field {
  margin-bottom: 12px;
}

.label {
  display: block;
  font-size: 13px;
  color: #8b949e;
  margin-bottom: 4px;
}

.input {
  width: 100%;
  padding: 8px 12px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #c9d1d9;
  font-size: 14px;
  font-family: "SF Mono", "Fira Code", monospace;
  outline: none;
  transition: border-color 0.2s;
}

.input:focus {
  border-color: #58a6ff;
}

.input::placeholder {
  color: #484f58;
}

.submit {
  width: 100%;
  padding: 10px;
  margin-top: 8px;
  background: #238636;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.submit:hover {
  background: #2ea043;
}

.submit:disabled {
  background: #21262d;
  color: #484f58;
  cursor: not-allowed;
}

.error {
  color: #f85149;
  font-size: 13px;
  margin-top: 8px;
}
```

- [ ] **Step 2: 创建 TxForm.tsx**

```tsx
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
```

- [ ] **Step 3: Commit**

```bash
git add components/TxForm.tsx components/TxForm.module.css
git commit -m "feat: add TxForm component with validation"
```

---

### Task 6: GuardResult 组件

**Files:**
- Create: `experiments/account-abstraction/frontend/components/GuardResult.tsx`
- Create: `experiments/account-abstraction/frontend/components/GuardResult.module.css`

- [ ] **Step 1: 创建 CSS Module**

```css
/* components/GuardResult.module.css */
.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}

.cardPassed {
  border-color: #238636;
}

.cardRejected {
  border-color: #da3633;
}

.title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.titlePassed {
  color: #3fb950;
}

.titleRejected {
  color: #f85149;
}

.checks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkItem {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  padding: 6px 0;
  border-bottom: 1px solid #21262d;
}

.checkItem:last-child {
  border-bottom: none;
}

.icon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-weight: bold;
}

.iconPass {
  color: #3fb950;
}

.iconFail {
  color: #f85149;
}

.level {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  flex-shrink: 0;
}

.levelHard {
  background: #1f2329;
  color: #8b949e;
  border: 1px solid #30363d;
}

.levelSoft {
  background: #1f2329;
  color: #d29922;
  border: 1px solid #3b3419;
}

.detail {
  color: #c9d1d9;
  word-break: break-all;
}

.reviewNotice {
  margin-top: 12px;
  padding: 10px 12px;
  background: #1f2329;
  border: 1px solid #d29922;
  border-radius: 6px;
  font-size: 13px;
  color: #d29922;
}
```

- [ ] **Step 2: 创建 GuardResult.tsx**

```tsx
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
```

- [ ] **Step 3: Commit**

```bash
git add components/GuardResult.tsx components/GuardResult.module.css
git commit -m "feat: add GuardResult component"
```

---

### Task 7: SimulationReport 组件

**Files:**
- Create: `experiments/account-abstraction/frontend/components/SimulationReport.tsx`
- Create: `experiments/account-abstraction/frontend/components/SimulationReport.module.css`

- [ ] **Step 1: 创建 CSS Module**

```css
/* components/SimulationReport.module.css */
.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: #58a6ff;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section {
  margin-bottom: 12px;
}

.sectionTitle {
  font-size: 13px;
  font-weight: 600;
  color: #8b949e;
  margin-bottom: 4px;
}

.value {
  font-size: 14px;
  font-family: "SF Mono", "Fira Code", monospace;
  color: #c9d1d9;
}

.riskLow {
  color: #3fb950;
  font-weight: 600;
}

.riskMedium {
  color: #d29922;
  font-weight: 600;
}

.riskHigh {
  color: #f85149;
  font-weight: 600;
}

.warnings {
  margin-top: 8px;
}

.warning {
  font-size: 13px;
  color: #d29922;
  padding: 3px 0;
}

.summary {
  margin-top: 12px;
  padding: 10px 12px;
  background: #0d1117;
  border-radius: 6px;
  font-size: 14px;
  color: #c9d1d9;
  border: 1px solid #30363d;
}

.error {
  color: #f85149;
  font-size: 13px;
  margin-top: 8px;
  padding: 8px 12px;
  background: #1f1317;
  border-radius: 6px;
  border: 1px solid #3d2025;
}
```

- [ ] **Step 2: 创建 SimulationReport.tsx**

```tsx
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
```

- [ ] **Step 3: Commit**

```bash
git add components/SimulationReport.tsx components/SimulationReport.module.css
git commit -m "feat: add SimulationReport component"
```

---

### Task 8: TxResult 组件

**Files:**
- Create: `experiments/account-abstraction/frontend/components/TxResult.tsx`
- Create: `experiments/account-abstraction/frontend/components/TxResult.module.css`

- [ ] **Step 1: 创建 CSS Module**

```css
/* components/TxResult.module.css */
.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}

.cardSuccess {
  border-color: #238636;
}

.cardFailed {
  border-color: #da3633;
}

.title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.titleSuccess {
  color: #3fb950;
}

.titleFailed {
  color: #f85149;
}

.field {
  margin-bottom: 8px;
}

.label {
  font-size: 12px;
  color: #8b949e;
  margin-bottom: 2px;
}

.value {
  font-size: 14px;
  font-family: "SF Mono", "Fira Code", monospace;
  color: #c9d1d9;
  word-break: break-all;
}

.link {
  color: #58a6ff;
  text-decoration: none;
  font-size: 13px;
}

.link:hover {
  text-decoration: underline;
}

.error {
  color: #f85149;
  font-size: 13px;
  margin-top: 8px;
  padding: 8px 12px;
  background: #1f1317;
  border-radius: 6px;
}
```

- [ ] **Step 2: 创建 TxResult.tsx**

```tsx
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
```

- [ ] **Step 3: Commit**

```bash
git add components/TxResult.tsx components/TxResult.module.css
git commit -m "feat: add TxResult component"
```

---

### Task 9: 主页面 — 状态机 + 流程编排

**Files:**
- Create: `experiments/account-abstraction/frontend/app/page.tsx`
- Create: `experiments/account-abstraction/frontend/app/page.module.css`

- [ ] **Step 1: 创建 CSS Module**

```css
/* app/page.module.css */
.header {
  text-align: center;
  margin-bottom: 32px;
  padding-top: 16px;
}

.headerTitle {
  font-size: 22px;
  font-weight: 700;
  color: #f0f6fc;
  margin-bottom: 4px;
}

.headerSubtitle {
  font-size: 13px;
  color: #8b949e;
}

.address {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 13px;
  color: #58a6ff;
  margin-top: 4px;
}

.confirmSection {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.confirmBtn {
  flex: 1;
  padding: 12px;
  background: #238636;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.confirmBtn:hover {
  background: #2ea043;
}

.confirmBtn:disabled {
  background: #21262d;
  color: #484f58;
  cursor: not-allowed;
}

.cancelBtn {
  flex: 1;
  padding: 12px;
  background: #21262d;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.cancelBtn:hover {
  background: #30363d;
}

.cancelBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.statusBar {
  text-align: center;
  padding: 16px;
  font-size: 13px;
  color: #8b949e;
}
```

- [ ] **Step 2: 创建 page.tsx**

```tsx
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
      } else {
        setStage("guard_passed");
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
```

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx app/page.module.css
git commit -m "feat: add main page with state machine flow"
```

---

### Task 10: 环境变量模板 + 最终验证

**Files:**
- Create: `experiments/account-abstraction/frontend/.env.local.example`
- No .env.local 提交到 git（已在 .gitignore 中）

- [ ] **Step 1: 创建 .env.local.example**

```env
# Pimlico Bundler + Paymaster API Key
# 从 https://dashboard.pimlico.io 获取
PIMLICO_API_KEY=pim_xxxx

# Agent Session Key 私钥（0x 开头，64 字符 hex）
# 用于 Session Key 对 UserOperation 签名
# 注意：这是 Agent 的受限密钥，不是 EOA 主钱包私钥
PRIVATE_KEY=0x...

# EOA 主钱包私钥（0x 开头，64 字符 hex）
# 拥有 Smart Account 的 EOA，用于部署和初始化 Smart Account
OWNER_PRIVATE_KEY=0x...
```

- [ ] **Step 2: 确保 .gitignore 排除敏感文件**

Check that `experiments/account-abstraction/.gitignore` contains `.env.local`. If not, add it.

```bash
grep -q ".env.local" ../.gitignore || echo ".env.local" >> ../.gitignore
```

- [ ] **Step 3: 复制 .env 并测试 API route**

用户需要手动从现有的 `experiments/account-abstraction/.env` 复制值到 `frontend/.env.local`。

```bash
# 用户操作：
# cp ../.env .env.local
# 编辑 .env.local，确保包含 PIMLICO_API_KEY, PRIVATE_KEY, OWNER_PRIVATE_KEY
```

- [ ] **Step 4: 启动 dev server 验证**

```bash
cd experiments/account-abstraction/frontend
npm run dev
```

Expected:
- Next.js 启动在 `http://localhost:3000`
- 浏览器打开页面，看到 Safe Agent Wallet 标题和交易表单
- 填写表单、点"执行交易"
- 看到 GuardResult + SimulationReport + 确认按钮
- 点"确认并执行"
- 看到 TxResult（tx hash + Etherscan 链接）

- [ ] **Step 5: 完整流程验证步骤**

按以下场景手动测试：

1. **合法交易**：to=Smart Account 地址, value=0, data=0x → guard_passed → simulation → 确认 → executed
2. **单笔超限**：value=0.05（超过 TEST_POLICY.maxSingleAmount 0.01） → guard_rejected（红色），无后续步骤
3. **缺少 env var**：临时注释 .env.local 中的 PIMLICO_API_KEY → API 返回 "Missing required env var: PIMLICO_API_KEY"
4. **无效地址**：to=abc → 前端验证拦截，提示格式无效

- [ ] **Step 6: Commit**

```bash
git add .env.local.example
git commit -m "feat: add .env.local.example template"
```

---

### 自检清单

实现完成后逐项检查：

- [ ] `console.log` 无 PRIVATE_KEY / OWNER_PRIVATE_KEY 值输出
- [ ] API response 不包含私钥字段
- [ ] 所有 bigint 字段已序列化为 string
- [ ] env var 缺失时 API 返回明确提示（不暴露值）
- [ ] 表单前端验证：无效地址 / 无效金额被拦截
- [ ] guard_rejected 时不显示 simulation / 确认按钮
- [ ] simulation_failed 时显示 error，不显示确认按钮
- [ ] Phase 2 不重复跑 guard/simulation
