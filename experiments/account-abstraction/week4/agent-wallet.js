"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAgentWallet = initAgentWallet;
exports.agentExecuteTransaction = agentExecuteTransaction;
require("dotenv/config");
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const chains_1 = require("viem/chains");
const permissionless_1 = require("permissionless");
const accounts_2 = require("permissionless/accounts");
const pimlico_1 = require("permissionless/clients/pimlico");
const permission_policy_1 = require("./permission-policy");
const safe_guard_1 = require("./safe-guard");

const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

// 初始化 Agent Wallet（Smart Account + Pimlico Client）
async function initAgentWallet(config) {
    const owner = (0, accounts_1.privateKeyToAccount)(config.ownerPrivateKey);

    const publicClient = (0, viem_1.createPublicClient)({
        chain: chains_1.sepolia,
        transport: (0, viem_1.http)("https://sepolia.rpc.thirdweb.com"),
    });

    const pimlicoTransport = (0, viem_1.http)(
        `https://api.pimlico.io/v1/sepolia/rpc?apikey=${config.pimlicoApiKey}`
    );

    // createPimlicoClient = bundler + paymaster 合一
    const pimlicoClient = (0, pimlico_1.createPimlicoClient)({
        chain: chains_1.sepolia,
        transport: pimlicoTransport,
        entryPoint: { address: ENTRYPOINT_V07, version: "0.7" },
    });

    const simpleAccount = await (0, accounts_2.toSimpleSmartAccount)({
        client: publicClient,
        owner: owner,
        entryPoint: { address: ENTRYPOINT_V07, version: "0.7" },
        factoryAddress: "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
    });

    return {
        pimlicoClient,
        smartAccount: simpleAccount,
        smartAccountAddress: simpleAccount.address,
        ownerAddress: owner.address,
    };
}

// Agent 发起交易（Safe Guard 前置校验 → 链上执行）
async function agentExecuteTransaction(wallet, session, policy, tx, usage) {
    // 1. Safe Guard 校验
    const guardCheck = (0, safe_guard_1.safeGuardCheck)(session, policy, tx, usage);

    if (!guardCheck.passed) {
        return { guardCheck, error: "Safe Guard 硬约束不通过，交易已拦截" };
    }

    if (guardCheck.requiresHumanReview) {
        return {
            guardCheck,
            error: `需要人工确认：${guardCheck.humanReviewReason}`,
        };
    }

    // 2. 获取 Gas 价格（Pimlico v1 要求预填充）
    const { fast: gasPrice } = await wallet.pimlicoClient.getUserOperationGasPrice();

    // 3. 提交链上（gas 预填充 + paymaster 赞助）
    try {
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
        const newUsage = (0, permission_policy_1.recordUsage)(usage, tx);

        return {
            guardCheck,
            txHash,
            etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
            usage: newUsage,
        };
    } catch (err) {
        return {
            guardCheck,
            error: `链上执行失败：${err.message || err}`,
        };
    }
}
