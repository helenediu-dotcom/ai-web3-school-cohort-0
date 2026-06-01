"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_POLICY = void 0;
exports.createEmptyUsageTracker = createEmptyUsageTracker;
exports.checkPermission = checkPermission;
exports.recordUsage = recordUsage;
const viem_1 = require("viem");
function createEmptyUsageTracker() {
    return {
        dailyAmountSpent: 0n,
        dailyTxCount: 0,
        hourlyTxTimestamps: [],
        lastResetDate: new Date().toISOString().slice(0, 10),
    };
}
// === 策略校验 ===
function checkPermission(policy, tx, usage, now = Math.floor(Date.now() / 1000)) {
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
        const isWhitelisted = policy.contractWhitelist.some((c) => c.toLowerCase() === tx.to.toLowerCase());
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
function recordUsage(usage, tx) {
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
exports.TEST_POLICY = {
    assetWhitelist: [], // 只允许 ETH
    maxSingleAmount: (0, viem_1.parseEther)("0.01"),
    maxDailyAmount: (0, viem_1.parseEther)("0.1"),
    contractWhitelist: [], // 空 = 不限制合约地址（演示用）
    functionWhitelist: {},
    maxSlippageBps: 100, // 1%
    maxPriceDeviationBps: 200, // 2%
    validFrom: Math.floor(Date.now() / 1000) - 60,
    validUntil: Math.floor(Date.now() / 1000) + 86400, // 24h
    maxTransactionsPerHour: 5,
    maxTransactionsPerDay: 20,
};
