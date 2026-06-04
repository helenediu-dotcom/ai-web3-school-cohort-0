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
