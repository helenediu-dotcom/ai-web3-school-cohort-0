// lib/types.ts — API response types for the frontend
// 所有 bigint 字段已序列化为 string（JSON 不支持 bigint）

export type RiskLevel = "critical" | "high" | "medium" | "low" | "trivial";

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

// Discriminated union: success=true 时包含完整报告字段，success=false 时仅包含 error
export interface SimulationSuccess {
  success: true;
  callSim: CallSim;
  gasEstimate: GasEstimate;
  summary: string;
  riskLevel: RiskLevel;
  warnings: string[];
  error?: string;
}

export interface SimulationFailed {
  success: false;
  error?: string;
}

export type Simulation = SimulationSuccess | SimulationFailed;

// POST /api/execute response
export type ExecuteResponse =
  | Phase1Response
  | Phase2Response;

export interface Phase1Response {
  stage: "guard_passed" | "guard_rejected" | "simulation_failed";
  guardCheck: GuardCheck;
  simulation: Simulation | null;
  sessionId?: string; // guard_passed 时返回，Phase 2 用
  /** 灰区引擎自动批准（跳过人工确认） */
  autoApproved?: boolean;
  /** 自动批准的理由 */
  autoApprovalReason?: string;
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
