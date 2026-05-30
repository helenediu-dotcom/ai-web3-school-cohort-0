import { Address, Hex, parseEther } from "viem";

// === 七维权限策略（来自 Handbook Permission Policy） ===

export interface PermissionPolicy {
  assetWhitelist: Address[];         // 1. 资产范围
  maxSingleAmount: bigint;           // 2a. 单笔上限（wei）
  maxDailyAmount: bigint;            // 2b. 日累计上限（wei）
  contractWhitelist: Address[];      // 3. 目标合约白名单
  functionWhitelist: Record<Address, Hex[]>; // 4. 函数选择器白名单
  maxSlippageBps: number;            // 5a. 最大滑点（bps）
  maxPriceDeviationBps: number;      // 5b. 最大价格偏离（bps）
  validFrom: number;                 // 6a. 生效时间（unix timestamp）
  validUntil: number;                // 6b. 失效时间
  maxTransactionsPerHour: number;    // 6c. 每小时频率上限
  maxTransactionsPerDay: number;     // 7. 每日频率上限
}

// === 使用追踪 ===

export interface UsageTracker {
  dailyAmountSpent: bigint;
  dailyTxCount: number;
  hourlyTxTimestamps: number[];
  lastResetDate: string; // YYYY-MM-DD
}

export function createEmptyUsageTracker(): UsageTracker {
  return {
    dailyAmountSpent: 0n,
    dailyTxCount: 0,
    hourlyTxTimestamps: [],
    lastResetDate: new Date().toISOString().slice(0, 10),
  };
}

// === 交易请求 ===

export interface TransactionRequest {
  to: Address;
  value: bigint;
  data: Hex;
  tokenAddress?: Address;
}

// === 校验结果 ===

export type CheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

// === 策略校验 ===

export function checkPermission(
  policy: PermissionPolicy,
  tx: TransactionRequest,
  usage: UsageTracker,
  now: number = Math.floor(Date.now() / 1000)
): CheckResult {
  const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
  const asset = (tx.tokenAddress || ETH_ADDRESS).toLowerCase();

  // 1. 资产范围检查
  if (policy.assetWhitelist.length > 0) {
    const whitelist = policy.assetWhitelist.map((a) => a.toLowerCase());
    if (!whitelist.includes(asset)) {
      return { allowed: false, reason: `资产 ${asset} 不在白名单中` };
    }
  }

  // 2a. 单笔金额上限
  if (tx.value > policy.maxSingleAmount) {
    return {
      allowed: false,
      reason: `单笔金额超过上限 (${tx.value} > ${policy.maxSingleAmount})`,
    };
  }

  // 2b. 日累计金额上限
  if (usage.dailyAmountSpent + tx.value > policy.maxDailyAmount) {
    return {
      allowed: false,
      reason: `日累计金额将超过上限 (${usage.dailyAmountSpent} + ${tx.value} > ${policy.maxDailyAmount})`,
    };
  }

  // 3. 合约白名单
  if (policy.contractWhitelist.length > 0) {
    const isWhitelisted = policy.contractWhitelist.some(
      (c) => c.toLowerCase() === tx.to.toLowerCase()
    );
    if (!isWhitelisted) {
      return { allowed: false, reason: `目标合约 ${tx.to} 不在白名单中` };
    }
  }

  // 4. 函数选择器白名单
  if (tx.data !== "0x" && tx.data.length >= 10) {
    const selector = tx.data.slice(0, 10).toLowerCase() as Hex;
    const allowed = policy.functionWhitelist[tx.to.toLowerCase() as Address];
    if (allowed && allowed.length > 0) {
      const lower = allowed.map((s) => s.toLowerCase());
      if (!lower.includes(selector)) {
        return { allowed: false, reason: `函数 ${selector} 不在允许列表中` };
      }
    }
  }

  // 6a. 时间窗口生效
  if (now < policy.validFrom) {
    return { allowed: false, reason: "Session Key 尚未生效" };
  }

  // 6b. 时间窗口失效
  if (now > policy.validUntil) {
    return { allowed: false, reason: "Session Key 已过期" };
  }

  // 6c. 每小时频率
  const oneHourAgo = now - 3600;
  const recent = usage.hourlyTxTimestamps.filter((t) => t > oneHourAgo);
  if (recent.length >= policy.maxTransactionsPerHour) {
    return {
      allowed: false,
      reason: `每小时交易数已达上限 (${policy.maxTransactionsPerHour})`,
    };
  }

  // 7. 每日频率
  if (usage.dailyTxCount >= policy.maxTransactionsPerDay) {
    return {
      allowed: false,
      reason: `每日交易数已达上限 (${policy.maxTransactionsPerDay})`,
    };
  }

  return { allowed: true };
}

// === 更新使用记录 ===

export function recordUsage(
  usage: UsageTracker,
  tx: TransactionRequest
): UsageTracker {
  const today = new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);

  // 日期翻转，重置日计数
  const isNewDay = usage.lastResetDate !== today;
  return {
    dailyAmountSpent: (isNewDay ? 0n : usage.dailyAmountSpent) + tx.value,
    dailyTxCount: (isNewDay ? 0 : usage.dailyTxCount) + 1,
    hourlyTxTimestamps: [...usage.hourlyTxTimestamps, now],
    lastResetDate: today,
  };
}

// === 演示用策略模板 ===

export const TEST_POLICY: PermissionPolicy = {
  assetWhitelist: [],               // 只允许 ETH
  maxSingleAmount: parseEther("0.01"),
  maxDailyAmount: parseEther("0.1"),
  contractWhitelist: [],            // 空 = 不限制合约地址（演示用）
  functionWhitelist: {},
  maxSlippageBps: 100,              // 1%
  maxPriceDeviationBps: 200,        // 2%
  validFrom: Math.floor(Date.now() / 1000) - 60,
  validUntil: Math.floor(Date.now() / 1000) + 86400, // 24h
  maxTransactionsPerHour: 5,
  maxTransactionsPerDay: 20,
};
