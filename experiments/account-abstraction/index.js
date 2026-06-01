"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config"); // 务必安装 npm install dotenv
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const chains_1 = require("viem/chains");
const permissionless_1 = require("permissionless");
const accounts_2 = require("permissionless/accounts");
const pimlico_1 = require("permissionless/clients/pimlico");
const fs_1 = require("fs");
const main = async () => {
    // 1. 获取 API Key
    const apiKey = process.env.PIMLICO_API_KEY;
    if (!apiKey)
        throw new Error("Missing PIMLICO_API_KEY in .env");
    // 2. 创建 Owner 账户 (EOA)
    // 注意：生产环境不要这样生成私钥！
    const privateKey = process.env.PRIVATE_KEY ??
        (() => {
            const pk = (0, accounts_1.generatePrivateKey)();
            (0, fs_1.writeFileSync)(".env", `PRIVATE_KEY=${pk}\n`, { flag: "a" });
            return pk;
        })();
    const owner = (0, accounts_1.privateKeyToAccount)(privateKey);
    console.log("1. Owner EOA Address:", owner.address);
    // 3. 创建 Public Client (用于读取链上信息)
    const publicClient = (0, viem_1.createPublicClient)({
        chain: chains_1.sepolia,
        transport: (0, viem_1.http)("https://sepolia.rpc.thirdweb.com"), // 也可用其他公共RPC
    });
    // 4. 创建 Paymaster Client (用于赞助gas)
    const paymasterClient = (0, pimlico_1.createPimlicoPaymasterClient)({
        entryPoint: permissionless_1.ENTRYPOINT_ADDRESS_V07,
        transport: (0, viem_1.http)(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`),
    });
    // 5. 创建 Bundler Client (用于提交用户操作)
    const bundlerClient = (0, pimlico_1.createPimlicoBundlerClient)({
        entryPoint: permissionless_1.ENTRYPOINT_ADDRESS_V07,
        transport: (0, viem_1.http)(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`),
    });
    // 6. 创建 Simple Smart Account
    const simpleAccount = await (0, accounts_2.signerToSimpleSmartAccount)(publicClient, {
        signer: owner,
        entryPoint: permissionless_1.ENTRYPOINT_ADDRESS_V07,
        factoryAddress: "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985", // SimpleAccountFactory on Sepolia
    });
    console.log("2. Smart Account Address:", simpleAccount.address);
    // 7. 创建 Smart Account Client (执行交易)
    const smartAccountClient = (0, permissionless_1.createSmartAccountClient)({
        account: simpleAccount,
        entryPoint: permissionless_1.ENTRYPOINT_ADDRESS_V07,
        chain: chains_1.sepolia,
        bundlerTransport: (0, viem_1.http)(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`),
        middleware: {
            sponsorUserOperation: paymasterClient.sponsorUserOperation, // 开启gas赞助
            gasPrice: async () => {
                const { fast } = await bundlerClient.getUserOperationGasPrice();
                return fast;
            },
        },
    });
    // 8. 发送一笔 UserOperation
    console.log("3. Sending UserOperation...");
    const txHash = await smartAccountClient.sendTransaction({
        to: simpleAccount.address, // 给自己转账
        value: (0, viem_1.parseEther)("0"), // 转账 0 ETH
        data: "0x",
    });
    console.log("4. UserOperation included in block:");
    console.log(`   Transaction Hash: ${txHash}`);
    console.log(`   View on Etherscan: https://sepolia.etherscan.io/tx/${txHash}`);
};
main().catch((error) => {
    console.error("Error:", error);
});
