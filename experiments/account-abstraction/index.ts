import "dotenv/config"; // 务必安装 npm install dotenv
import { createPublicClient, http, Hex, parseEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  createSmartAccountClient,
  ENTRYPOINT_ADDRESS_V07,
} from "permissionless";
import { signerToSimpleSmartAccount } from "permissionless/accounts";
import {
  createPimlicoBundlerClient,
  createPimlicoPaymasterClient,
} from "permissionless/clients/pimlico";
import { writeFileSync } from "fs";

const main = async () => {
  // 1. 获取 API Key
  const apiKey = process.env.PIMLICO_API_KEY;
  if (!apiKey) throw new Error("Missing PIMLICO_API_KEY in .env");

  // 2. 创建 Owner 账户 (EOA)
  // 注意：生产环境不要这样生成私钥！
  const privateKey =
    (process.env.PRIVATE_KEY as Hex) ??
    (() => {
      const pk = generatePrivateKey();
      writeFileSync(".env", `PRIVATE_KEY=${pk}\n`, { flag: "a" });
      return pk;
    })();
  const owner = privateKeyToAccount(privateKey);
  console.log("1. Owner EOA Address:", owner.address);

  // 3. 创建 Public Client (用于读取链上信息)
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http("https://sepolia.rpc.thirdweb.com"), // 也可用其他公共RPC
  });

  // 4. 创建 Paymaster Client (用于赞助gas)
  const paymasterClient = createPimlicoPaymasterClient({
    entryPoint: ENTRYPOINT_ADDRESS_V07,
    transport: http(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`),
  });

  // 5. 创建 Bundler Client (用于提交用户操作)
  const bundlerClient = createPimlicoBundlerClient({
    entryPoint: ENTRYPOINT_ADDRESS_V07,
    transport: http(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`),
  });

  // 6. 创建 Simple Smart Account
  const simpleAccount = await signerToSimpleSmartAccount(publicClient, {
    signer: owner,
    entryPoint: ENTRYPOINT_ADDRESS_V07,
    factoryAddress: "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985", // SimpleAccountFactory on Sepolia
  });
  console.log("2. Smart Account Address:", simpleAccount.address);

  // 7. 创建 Smart Account Client (执行交易)
  const smartAccountClient = createSmartAccountClient({
    account: simpleAccount,
    entryPoint: ENTRYPOINT_ADDRESS_V07,
    chain: sepolia,
    bundlerTransport: http(
      `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`
    ),
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
    value: parseEther("0"),    // 转账 0 ETH
    data: "0x",
  });

  console.log("4. UserOperation included in block:");
  console.log(`   Transaction Hash: ${txHash}`);
  console.log(`   View on Etherscan: https://sepolia.etherscan.io/tx/${txHash}`);
};

main().catch((error) => {
  console.error("Error:", error);
});