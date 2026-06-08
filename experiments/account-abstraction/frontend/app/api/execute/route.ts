// app/api/execute/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parseEther, Hex } from "viem";
import { initAgentWallet, AgentWalletInstance } from "../../../../week4/agent-wallet";
import {
  createSessionKey,
  saveSessionKey,
  SessionKey,
} from "../../../../week4/session-key";
import {
  TEST_POLICY,
  PermissionPolicy,
  TransactionRequest,
  UsageTracker,
  createEmptyUsageTracker,
} from "../../../../week4/permission-policy";
import { safeGuardCheck, GuardCheck } from "../../../../week4/safe-guard";
import {
  runPreTxSimulation,
  SimulationReport,
} from "../../../../week4/pre-tx-sim";
import {
  greyZoneEngine,
  GreyZoneDecision,
} from "../../../../week4/grey-zone";

// ── Demo-only server-side state ──
// 生产环境应改用 Redis / DB
const sessionCache = new Map<
  string,
  {
    wallet: AgentWalletInstance;
    sessionKey: SessionKey;
    sessionPrivateKey: Hex;
    policy: PermissionPolicy;
    tx: TransactionRequest;
    guardCheck: GuardCheck;
    simulation: SimulationReport;
  }
>();

// ── Env var check (不输出私钥值) ──
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// ── bigint → string 递归序列化 ──
function serializeBigInt(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = serializeBigInt(v);
    }
    return result;
  }
  return obj;
}

// POST /api/execute
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, value, data, autoConfirm, sessionId } = body;

    // ── Phase 2: autoConfirm = true, 直接执行 ──
    if (autoConfirm) {
      if (!sessionId) {
        return NextResponse.json(
          { stage: "execution_failed", error: "缺少 sessionId" },
          { status: 400 }
        );
      }

      const cached = sessionCache.get(sessionId);
      if (!cached) {
        return NextResponse.json(
          { stage: "execution_failed", error: "Session 已过期或不存在" },
          { status: 400 }
        );
      }
      const { wallet, tx } = cached;

      try {
        const { fast: gasPrice } =
          await wallet.pimlicoClient.getUserOperationGasPrice();

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

        // 成功后清理 session（失败时保留，允许重试）
        sessionCache.delete(sessionId);

        return NextResponse.json({
          stage: "executed",
          txHash,
          etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
        });
      } catch (err: any) {
        // 保留 session，用户可重试
        console.error("[execute] Chain execution failed:", err.message || err);
        return NextResponse.json({
          stage: "execution_failed",
          error: "链上执行失败，请重试",
        });
      }
    }

    // ── Phase 1: autoConfirm = false, 跑 guard + simulation ──

    // Validate required fields
    if (!to || value === undefined) {
      return NextResponse.json(
        { error: "缺少必填字段：to, value" },
        { status: 400 }
      );
    }

    // Read env vars (不输出值到日志)
    const pimlicoApiKey = requireEnv("PIMLICO_API_KEY");
    const ownerPrivateKey = requireEnv("OWNER_PRIVATE_KEY") as Hex;

    // Validate private key format
    if (!ownerPrivateKey.startsWith("0x") || ownerPrivateKey.length !== 66) {
      return NextResponse.json(
        { error: "OWNER_PRIVATE_KEY 格式无效：应为 0x + 64 hex 字符" },
        { status: 500 }
      );
    }

    // Parse transaction
    let valueBigInt: bigint;
    try {
      valueBigInt = parseEther(String(value));
    } catch {
      return NextResponse.json(
        { error: "value 格式无效：应为 ETH 字符串（如 0.001）" },
        { status: 400 }
      );
    }

    const tx: TransactionRequest = {
      to: to as Hex,
      value: valueBigInt,
      data: (data as Hex) || "0x",
    };

    // 1. Init wallet + session
    const wallet = await initAgentWallet({
      ownerPrivateKey,
      pimlicoApiKey,
    });

    // 日志只输出地址，不输出私钥
    console.log(`[execute] Owner EOA:   ${wallet.ownerAddress}`);
    console.log(`[execute] Smart Account: ${wallet.smartAccountAddress}`);

    const policy: PermissionPolicy = {
      ...TEST_POLICY,
      validFrom: Math.floor(Date.now() / 1000) - 60,
      validUntil: Math.floor(Date.now() / 1000) + 86400,
    };
    const { sessionKey, privateKey: sessionPk } = createSessionKey(policy);
    saveSessionKey({ sessionKey, privateKey: sessionPk });
    console.log(`[execute] Session Key: ${sessionKey.id}`);

    const usage: UsageTracker = createEmptyUsageTracker();

    // 2. Safe Guard
    const guardCheck = safeGuardCheck(sessionKey, policy, tx, usage);

    if (!guardCheck.passed) {
      const serialized = serializeBigInt({
        stage: "guard_rejected",
        guardCheck,
        simulation: null,
      });
      return NextResponse.json(serialized);
    }

    // 3. Pre-tx Simulation
    let fromBalance: bigint;
    try {
      fromBalance = await wallet.publicClient.getBalance({
        address: wallet.smartAccountAddress,
      });
    } catch {
      fromBalance = 0n;
    }

    let simulation: SimulationReport;
    try {
      simulation = await runPreTxSimulation(
        {
          smartAccount: {
            client: wallet.publicClient,
          },
          smartAccountAddress: wallet.smartAccountAddress,
          pimlicoClient: wallet.pimlicoClient,
        },
        tx,
        fromBalance
      );
    } catch (err: any) {
      console.error("[execute] Simulation failed:", err.message || err);
      const serialized = serializeBigInt({
        stage: "simulation_failed",
        guardCheck,
        simulation: {
          success: false,
          error: err.message || "Simulation 执行失败",
        },
      });
      return NextResponse.json(serialized);
    }

    // 4. Store session for Phase 2
    const sid = `sid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionCache.set(sid, {
      wallet,
      sessionKey,
      sessionPrivateKey: sessionPk,
      policy,
      tx,
      guardCheck,
      simulation,
    });

    // 映射 SimulationReport → 前端 Simulation discriminated union
    const simulationResponse = simulation.callSim.success
      ? {
          success: true as const,
          callSim: simulation.callSim,
          gasEstimate: simulation.gasEstimate,
          summary: simulation.summary,
          riskLevel: simulation.riskLevel,
          warnings: simulation.warnings,
        }
      : {
          success: false as const,
          error: simulation.callSim.revertReason || "链上模拟执行失败",
        };

    // 灰区决策：medium 风险时运行规则引擎
    let autoApproved: boolean | undefined;
    let autoApprovalReason: string | undefined;
    if (simulation.riskLevel === "medium") {
      const greyDecision = greyZoneEngine(
        "medium",
        guardCheck,
        tx.value,
        tx.to
      );
      if (greyDecision.decision === "auto_approve") {
        autoApproved = true;
        autoApprovalReason = greyDecision.reason;
      }
    }
    // low / trivial 也自动通过（不需引擎判断）
    if (simulation.riskLevel === "low" || simulation.riskLevel === "trivial") {
      autoApproved = true;
      autoApprovalReason =
        simulation.riskLevel === "trivial"
          ? "风险极低，静默通过"
          : "风险低，自动通过";
    }
    // critical / high → autoApproved 为 undefined（前端强制人工确认）

    const serialized = serializeBigInt({
      stage: "guard_passed",
      guardCheck,
      simulation: simulationResponse,
      sessionId: sid,
      autoApproved,
      autoApprovalReason,
    });
    return NextResponse.json(serialized);
  } catch (err: any) {
    console.error("[execute] Unhandled error:", err.message || err);
    return NextResponse.json(
      { error: "服务器内部错误" },
      { status: 500 }
    );
  }
}
