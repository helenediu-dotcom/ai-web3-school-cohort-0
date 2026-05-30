// === 七维权限策略（来自 Handbook Permission Policy） ===
// 纯 JavaScript 版本，配合 type: "commonjs"
// 类型注解以 JSDoc 形式保留，方便 IDE 提示

const { parseEther } = require("viem");

/**
 * @typedef {Object} PermissionPolicy
 * @property {string[]} assetWhitelist      - 1. 资产范围
 * @property {bigint}   maxSingleAmount     - 2a. 单笔上限（wei）
 * @property {bigint}   maxDailyAmount      - 2b. 日累计上限（wei）
 * @property {string[]} contractWhitelist   - 3. 目标合约白名单
 * @property {Record<string, string[]>} functionWhitelist - 4. 函数选择器白名单
 * @property {number}   maxSlippageBps      - 5a. 最大滑点（bps）
 * @property {number}   maxPriceDeviationBps - 5b. 最大价格偏离（bps）
 * @property {number}   validFrom           - 6a. 生效时间（unix timestamp）
 * @property {number}   validUntil          - 6b. 失效时间
 * @property {number}   maxTransactionsPerHour  - 6c. 每小时频率上限
 * @property {number}   maxTransactionsPerDay   - 7. 每日频率上限
 */

/**
 * @typedef {Object} UsageTracker
 * @property {bigint}   dailyAmountSpent
 * @property {number}   dailyTxCount
 * @property {number[]} hourlyTxTimestamps
 * @property {string}   lastResetDate
 */

/**
 * @typedef {Object} TransactionRequest
 * @property {string}  to
 * @property {bigint}  value
 * @property {string}  data
 * @property {string}  [tokenAddress]
 */

/**
 * @typedef {{ allowed: true } | { allowed: false, reason: string }} CheckResult
 */

// --- Usage Tracker ---

function createEmptyUsageTracker() {
  return {
    dailyAmountSpent: 0n,
    dailyTxCount: 0,
    hourlyTxTimestamps: [],
    lastResetDate: new Date().toISOString().slice(0, 10),
  };
}

// --- 策略校验 ---

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * @param {PermissionPolicy} policy
 * @param {TransactionRequest} tx
 * @param {UsageTracker} usage
 * @param {number} [now]
 * @returns {CheckResult}
 */
function checkPermission(policy, tx, usage, now) {
  const ts = now ?? Math.floor(Date.now() / 1000);
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
    const selector = tx.data.slice(0, 10).toLowerCase();
    const allowed = policy.functionWhitelist[tx.to.toLowerCase()];
    if (allowed && allowed.length > 0) {
      const lower = allowed.map((s) => s.toLowerCase());
      if (!lower.includes(selector)) {
        return { allowed: false, reason: `函数 ${selector} 不在允许列表中` };
      }
    }
  }

  // 6a. 时间窗口生效
  if (ts < policy.validFrom) {
    return { allowed: false, reason: "Session Key 尚未生效" };
  }

  // 6b. 时间窗口失效
  if (ts > policy.validUntil) {
    return { allowed: false, reason: "Session Key 已过期" };
  }

  // 6c. 每小时频率
  const oneHourAgo = ts - 3600;
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

// --- 更新使用记录 ---

/**
 * @param {UsageTracker} usage
 * @param {TransactionRequest} tx
 * @returns {UsageTracker}
 */
function recordUsage(usage, tx) {
  const today = new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);
  const isNewDay = usage.lastResetDate !== today;

  return {
    dailyAmountSpent: (isNewDay ? 0n : usage.dailyAmountSpent) + tx.value,
    dailyTxCount: (isNewDay ? 0 : usage.dailyTxCount) + 1,
    hourlyTxTimestamps: [...usage.hourlyTxTimestamps, now],
    lastResetDate: today,
  };
}

// --- 演示用策略模板 ---

const TEST_POLICY = {
  assetWhitelist: [],
  maxSingleAmount: parseEther("0.01"),
  maxDailyAmount: parseEther("0.1"),
  contractWhitelist: [],
  functionWhitelist: {},
  maxSlippageBps: 100,
  maxPriceDeviationBps: 200,
  validFrom: Math.floor(Date.now() / 1000) - 60,
  validUntil: Math.floor(Date.now() / 1000) + 86400,
  maxTransactionsPerHour: 5,
  maxTransactionsPerDay: 20,
};

module.exports = {
  TEST_POLICY,
  ETH_ADDRESS,
  createEmptyUsageTracker,
  checkPermission,
  recordUsage,
};
