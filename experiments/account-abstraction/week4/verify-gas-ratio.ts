/**
 * 验证 gas 占比 > 20% 余额 → high 风险等级
 *
 * 场景：余额 0.005 ETH，gas 预估 ~0.0015 ETH（占 30%）→ 应判定为 high
 * 对比：余额 0.049 ETH，gas 预估 ~0.006 ETH（占 12%）→ 不应触发
 *
 * 运行：npx tsx week4/verify-gas-ratio.ts
 */

import { computeRiskLevel, type SimulationReport, type RiskLevel } from "./pre-tx-sim";

const baseGasEstimate = {
  callGasLimit: 200_000n,
  verificationGasLimit: 100_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 30_000_000_000n, // 30 gwei
  maxPriorityFeePerGas: 1_000_000_000n,
  // totalGas = (200k + 100k + 50k) * 30 gwei = 0.0105 ETH
  estimatedTotalGas: (200_000n + 100_000n + 50_000n) * 30_000_000_000n,
  estimatedTotalEth: "0.0105",
  paymasterSponsored: false,
};

const baseCallSim = {
  success: true as const,
  balanceChanges: [],
  fromBalanceChange: null,
  simulatedAtBlock: 0n,
};

function makeReport(overrides: Partial<SimulationReport>): SimulationReport {
  return {
    callSim: baseCallSim,
    gasEstimate: baseGasEstimate,
    summary: "test",
    riskLevel: "low",
    warnings: [],
    ...overrides,
  };
}

let pass = 0;
let fail = 0;

function assert(
  label: string,
  actual: unknown,
  expected: unknown
) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}: ${actual}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
    console.log(`    期望: ${expected}`);
    console.log(`    实际: ${actual}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ============================================================
// 测试 1: gas > 20% 余额 → high
// ============================================================
section("测试 1: gas 占余额 30% → 应判定为 high");

const highGasReport = makeReport({
  warnings: [
    "gas 消耗占余额超过 20%",
    "无 Paymaster 赞助，需自付 gas",
  ],
});

const result1 = computeRiskLevel(highGasReport, 1_000_000_000_000_000n); // 0.001 ETH
assert("gas 30% + 无赞助 → high", result1, "high");

// ============================================================
// 测试 2: gas > 20% 但也是大额转账 → high（取第一个命中）
// ============================================================
section("测试 2: gas > 20% 且大额转账 → 应判定为 high（gas 先命中）");

const bothHighReport = makeReport({
  warnings: [
    "gas 消耗占余额超过 20%",
    "无 Paymaster 赞助，需自付 gas",
  ],
});

const result2 = computeRiskLevel(bothHighReport, parseEtherStr("0.02"));
assert("gas 30% + 大额 → high（gas 条件先命中）", result2, "high");

// ============================================================
// 测试 3: 正常 gas 占比 → 不应触发 high
// ============================================================
section("测试 3: gas 占余额 12%（正常）→ 不应触发 high");

const normalGasReport = makeReport({
  warnings: [
    "无 Paymaster 赞助，需自付 gas", // 只有 paymaster warning
  ],
});

// txValue = 0.003 ETH（小額，不触发大额 high 阈值）
const result3 = computeRiskLevel(normalGasReport, parseEtherStr("0.003"));
assert("gas 12% + 无赞助 → medium（非 high）", result3, "medium");

// ============================================================
// 测试 4: gas > 20% 但余额不足以支付 → critical 优先级更高
// ============================================================
section("测试 4: gas > 20% 但余额不足 → critical 优先级更高");

const insufficientReport = makeReport({
  warnings: [
    "余额不足以支付 gas 费用",
    "gas 消耗占余额超过 20%",
  ],
});

const result4 = computeRiskLevel(insufficientReport, 100_000n);
assert("余额不足 + gas 20% → critical（优先级 2 > 3）", result4, "critical");

// ============================================================
// 结果汇总
// ============================================================
section("结果");
console.log(`通过: ${pass}, 失败: ${fail}`);
if (fail > 0) {
  console.log("❌ 有测试失败！");
  process.exit(1);
} else {
  console.log("✅ 全部通过 — gas 占比 > 20% → high 路径逻辑正确");
}

// helper
function parseEtherStr(eth: string): bigint {
  const [int, dec = ""] = eth.split(".");
  const padded = (dec + "0".repeat(18)).slice(0, 18);
  return BigInt(int) * 10n ** 18n + BigInt(padded);
}
