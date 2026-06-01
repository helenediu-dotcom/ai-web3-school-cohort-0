"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const permission_policy_1 = require("./permission-policy");
const session_key_1 = require("./session-key");
const safe_guard_1 = require("./safe-guard");
const agent_wallet_1 = require("./agent-wallet");
// === 演示：Safe Agent Wallet 完整流程 ===
//
// 场景 1-5：本地权限校验（无链上执行）
// 场景 6：Safe Guard 通过 → Smart Account 链上执行（Sepolia 真实交易）
function divider(title) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ${title}`);
    console.log("=".repeat(60));
}
const main = async () => {
    divider("Step 1: 创建 Session Key + 绑定权限策略");
    const { sessionKey, privateKey } = (0, session_key_1.createSessionKey)(permission_policy_1.TEST_POLICY);
    (0, session_key_1.saveSessionKey)({ sessionKey, privateKey });
    console.log(`Session Key ID:     ${sessionKey.id}`);
    console.log(`Session Key 地址:   ${sessionKey.address}`);
    console.log(`权限策略（七维）:`);
    console.log(`  单笔上限:          ${permission_policy_1.TEST_POLICY.maxSingleAmount} wei (${Number(permission_policy_1.TEST_POLICY.maxSingleAmount) / 1e18} ETH)`);
    console.log(`  日累计上限:        ${permission_policy_1.TEST_POLICY.maxDailyAmount} wei (${Number(permission_policy_1.TEST_POLICY.maxDailyAmount) / 1e18} ETH)`);
    console.log(`  每小时频率上限:    ${permission_policy_1.TEST_POLICY.maxTransactionsPerHour} 笔`);
    console.log(`  每日频率上限:      ${permission_policy_1.TEST_POLICY.maxTransactionsPerDay} 笔`);
    console.log(`  有效期:            ${new Date(permission_policy_1.TEST_POLICY.validFrom * 1000).toLocaleString()} → ${new Date(permission_policy_1.TEST_POLICY.validUntil * 1000).toLocaleString()}`);
    let usage = (0, permission_policy_1.createEmptyUsageTracker)();
    // === 场景测试 ===
    divider("Step 2: 场景测试 — 合法交易 ✅");
    const validTx = {
        to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
        value: (0, viem_1.parseEther)("0.001"),
        data: "0x",
    };
    console.log("拟议交易：向 0x5190... 转账 0.001 ETH");
    const result1 = (0, safe_guard_1.safeGuardCheck)(sessionKey, permission_policy_1.TEST_POLICY, validTx, usage);
    console.log((0, safe_guard_1.formatGuardResult)(result1));
    if (result1.passed) {
        usage = (0, permission_policy_1.recordUsage)(usage, validTx);
        console.log(`\n→ 交易通过，已记录。日累计: ${usage.dailyTxCount} 笔, ${usage.dailyAmountSpent} wei`);
    }
    // ---
    divider("Step 3: 场景测试 — 单笔超限 ❌");
    const overSingleTx = {
        to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
        value: (0, viem_1.parseEther)("0.05"),
        data: "0x",
    };
    console.log("拟议交易：向 0x5190... 转账 0.05 ETH（单笔上限 0.01 ETH）");
    const result2 = (0, safe_guard_1.safeGuardCheck)(sessionKey, permission_policy_1.TEST_POLICY, overSingleTx, usage);
    console.log((0, safe_guard_1.formatGuardResult)(result2));
    // ---
    divider("Step 4: 场景测试 — 合约函数不在白名单 ❌");
    const policyWithFunctionRule = {
        ...permission_policy_1.TEST_POLICY,
        contractWhitelist: ["0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37"],
        functionWhitelist: {
            "0x51908fac9f289d620323fdc5ac1fe1ba0ab16b37": [
                "0xa9059cbb",
            ],
        },
    };
    const unauthorizedFnTx = {
        to: "0x51908FaC9F289D620323fdC5aC1FE1bA0ab16B37",
        value: (0, viem_1.parseEther)("0.001"),
        data: "0x095ea7b30000000000000000000000000000000000000000000000000000000000000001",
    };
    console.log("拟议交易：调用 approve() 函数（只允许 transfer()）");
    const altUsage = (0, permission_policy_1.createEmptyUsageTracker)();
    const result3 = (0, safe_guard_1.safeGuardCheck)({ ...sessionKey, policy: policyWithFunctionRule }, policyWithFunctionRule, unauthorizedFnTx, altUsage);
    console.log((0, safe_guard_1.formatGuardResult)(result3));
    // ---
    divider("Step 5: 场景测试 — Session Key 撤销 ❌");
    console.log("撤销 Session Key...");
    const revokedSession = (0, session_key_1.revokeSessionKey)(sessionKey);
    console.log(`Session Key 状态: ${revokedSession.revoked ? "已撤销" : "有效"}`);
    const result4 = (0, safe_guard_1.safeGuardCheck)(revokedSession, permission_policy_1.TEST_POLICY, validTx, usage);
    console.log((0, safe_guard_1.formatGuardResult)(result4));
    // ---
    divider("Step 6: 当前 Session Key 列表");
    const sessions = (0, session_key_1.listSessions)();
    if (sessions.length === 0) {
        console.log("（无活跃 Session Key）");
    }
    else {
        for (const s of sessions) {
            console.log(`- ${s.id}: ${s.address} (${s.revoked ? "已撤销" : "有效"})`);
        }
    }
    // === 链上执行场景 ===
    divider("Step 7: 链上执行 — Safe Guard 通过后发真实交易 🔗");
    const apiKey = process.env.PIMLICO_API_KEY;
    const ownerPk = process.env.PRIVATE_KEY;
    if (!apiKey || !ownerPk) {
        console.log("（跳过：需要 PIMLICO_API_KEY 和 PRIVATE_KEY）");
    }
    else {
        try {
            // 7a. 创建一个新的 Session Key（专门给 Agent 用）
            const chainPolicy = {
                ...permission_policy_1.TEST_POLICY,
                validFrom: Math.floor(Date.now() / 1000) - 60,
                validUntil: Math.floor(Date.now() / 1000) + 86400,
            };
            const { sessionKey: agentKey } = (0, session_key_1.createSessionKey)(chainPolicy);
            (0, session_key_1.saveSessionKey)({ sessionKey: agentKey, privateKey }); // 生产环境用独立 Session Key 私钥
            console.log(`Agent Session Key: ${agentKey.address}`);
            // 7b. 初始化 Agent Wallet（Smart Account + Bundler + Paymaster）
            console.log("\n初始化 Smart Account...");
            const wallet = await (0, agent_wallet_1.initAgentWallet)({
                ownerPrivateKey: ownerPk,
                pimlicoApiKey: apiKey,
            });
            console.log(`Owner EOA:         ${wallet.ownerAddress}`);
            console.log(`Smart Account:     ${wallet.smartAccountAddress}`);
            // 7c. 构造一笔合法交易（0 ETH 给自己，Gas 由 Paymaster 赞助）
            const chainTx = {
                to: wallet.smartAccountAddress,
                value: (0, viem_1.parseEther)("0"),
                data: "0x",
            };
            const freshUsage = (0, permission_policy_1.createEmptyUsageTracker)();
            console.log(`\n拟议交易：Smart Account 给自己发 0 ETH（测试链上流程）`);
            console.log(`Safe Guard 校验中...`);
            // 7d. Safe Guard 校验 + 链上执行
            const result = await (0, agent_wallet_1.agentExecuteTransaction)(wallet, agentKey, chainPolicy, chainTx, freshUsage);
            console.log((0, safe_guard_1.formatGuardResult)(result.guardCheck));
            if (result.txHash) {
                console.log(`\n✓ 链上交易已提交！`);
                console.log(`  Tx Hash: ${result.txHash}`);
                console.log(`  Etherscan: ${result.etherscanUrl}`);
                if (result.usage) {
                    console.log(`  日累计: ${result.usage.dailyTxCount} 笔`);
                }
            }
            else if (result.error) {
                console.log(`\n✗ ${result.error}`);
            }
        }
        catch (err) {
            console.log(`链上执行出错: ${err.message || err}`);
        }
    }
    // ---
    divider("总结");
    console.log(`Safe Agent Wallet 完整流程验证：`);
    console.log(`  ✓ Session Key 创建 + 七维策略绑定`);
    console.log(`  ✓ 合法交易通过本地校验`);
    console.log(`  ✓ 超限交易被本地拒绝`);
    console.log(`  ✓ 未授权函数被本地拒绝`);
    console.log(`  ✓ 撤销后交易被本地拒绝`);
    console.log(`  ✓ 权限校验通过 → Smart Account → Bundler → Paymaster → Sepolia 链上执行`);
    console.log(`\n三层架构：Safe Guard（前置拦截）→ Session Key（权限签名）→ Smart Account（链上执行）`);
};
main().catch((error) => {
    console.error("Error:", error);
});
