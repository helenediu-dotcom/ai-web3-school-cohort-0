import "dotenv/config";
import { createPublicClient, http, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { SessionKey } from "./session-key";
import { PermissionPolicy, TransactionRequest, UsageTracker, recordUsage } from "./permission-policy";
import { safeGuardCheck, GuardCheck } from "./safe-guard";

// === Agent Wallet：权限层 + 链上执行层的桥接 ===

const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export interface AgentWalletConfig {
  ownerPrivateKey: Hex;
  pimlicoApiKey: string;
}

export interface AgentWalletInstance {
  pimlicoClient: ReturnType<typeof createPimlicoClient>;
  smartAccount: Awaited<ReturnType<typeof toSimpleSmartAccount>>;
  smartAccountAddress: Hex;
  ownerAddress: Hex;
}

export interface AgentTransactionResult {
  guardCheck: GuardCheck;
  txHash?: Hex;
  etherscanUrl?: string;
  usage?: UsageTracker;
  error?: string;
}

// 初始化 Agent Wallet（Smart Account + Pimlico Client）
export async function initAgentWallet(
  config: AgentWalletConfig
): Promise<AgentWalletInstance> {
  const owner = privateKeyToAccount(config.ownerPrivateKey);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http("https://sepolia.rpc.thirdweb.com"),
  });

  const pimlicoTransport = http(
    `https://api.pimlico.io/v1/sepolia/rpc?apikey=${config.pimlicoApiKey}`
  );

  // createPimlicoClient = bundler + paymaster 合一
  const pimlicoClient = createPimlicoClient({
    chain: sepolia,
    transport: pimlicoTransport,
    entryPoint: { address: ENTRYPOINT_V07, version: "0.7" },
  });

  const simpleAccount = await toSimpleSmartAccount({
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
export async function agentExecuteTransaction(
  wallet: AgentWalletInstance,
  session: SessionKey,
  policy: PermissionPolicy,
  tx: TransactionRequest,
  usage: UsageTracker
): Promise<AgentTransactionResult> {
  // 1. Safe Guard 校验
  const guardCheck = safeGuardCheck(session, policy, tx, usage);

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
    const newUsage = recordUsage(usage, tx);

    return {
      guardCheck,
      txHash,
      etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
      usage: newUsage,
    };
  } catch (err: any) {
    return {
      guardCheck,
      error: `链上执行失败：${err.message || err}`,
    };
  }
}
