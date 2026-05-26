const path = require('path');
const fs = require('fs');

// 手动加载 .env 并检查
const envPath = path.resolve(__dirname, '.env');
console.log('Looking for .env at:', envPath);
console.log('File exists?', fs.existsSync(envPath));
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  console.log('File content:', content);
}

require('dotenv').config({ path: envPath });
console.log('After dotenv.config(), process.env.PIMLICO_API_KEY =', process.env.PIMLICO_API_KEY);

const { createPublicClient, http, parseEther } = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { sepolia } = require("viem/chains");
const { entryPoint07Address } = require("viem/account-abstraction");
const { createSmartAccountClient } = require("permissionless");
const { toSimpleSmartAccount } = require("permissionless/accounts");
const { createPimlicoClient } = require("permissionless/clients/pimlico");
const { writeFileSync } = require("fs");

const main = async () => {
  const apiKey = process.env.PIMLICO_API_KEY;
  if (!apiKey) throw new Error("Missing PIMLICO_API_KEY in .env");

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    privateKey = generatePrivateKey();
    writeFileSync(".env", `\nPRIVATE_KEY=${privateKey}`, { flag: "a" });
    console.log("新生成的私钥已保存到 .env");
  }
  const owner = privateKeyToAccount(privateKey);
  console.log("1. Owner EOA Address:", owner.address);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http("https://ethereum-sepolia.publicnode.com"),
  });

  const pimlicoClient = createPimlicoClient({
    transport: http(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`),
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });

  const simpleSmartAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: owner,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });
  console.log("2. Smart Account Address:", simpleSmartAccount.address);

  const smartAccountClient = createSmartAccountClient({
    account: simpleSmartAccount,
    chain: sepolia,
    bundlerTransport: http(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });

  console.log("3. Sending UserOperation...");
  const txHash = await smartAccountClient.sendTransaction({
    to: simpleSmartAccount.address,
    value: parseEther("0"),
    data: "0x",
  });

  console.log("4. UserOperation included in block:");
  console.log(`   Transaction Hash: ${txHash}`);
  console.log(`   View on Etherscan: https://sepolia.etherscan.io/tx/${txHash}`);
};

main().catch(console.error);