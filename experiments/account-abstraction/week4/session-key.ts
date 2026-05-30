import { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PermissionPolicy } from "./permission-policy";

// === Session Key：临时受限密钥 ===

export interface SessionKey {
  id: string;                    // 唯一标识
  address: Hex;                  // Session Key 地址（公钥）
  policy: PermissionPolicy;      // 绑定的权限策略
  createdAt: number;             // 创建时间
  revoked: boolean;              // 是否已手动撤销
}

export interface SessionKeyPrivate {
  sessionKey: SessionKey;
  privateKey: Hex;               // 私钥（内存中持有，不落盘）
}

// 创建一个新的 Session Key
export function createSessionKey(policy: PermissionPolicy): SessionKeyPrivate {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const session: SessionKey = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address: account.address,
    policy,
    createdAt: Date.now(),
    revoked: false,
  };

  return { sessionKey: session, privateKey };
}

// 撤销 Session Key
export function revokeSessionKey(session: SessionKey): SessionKey {
  return { ...session, revoked: true };
}

// 检查 Session Key 是否可用
export function isSessionKeyValid(session: SessionKey, now?: number): { valid: true } | { valid: false; reason: string } {
  if (session.revoked) {
    return { valid: false, reason: "Session Key 已被撤销" };
  }
  const ts = now ?? Math.floor(Date.now() / 1000);
  if (ts < session.policy.validFrom) {
    return { valid: false, reason: "Session Key 尚未生效" };
  }
  if (ts > session.policy.validUntil) {
    return { valid: false, reason: "Session Key 已过期" };
  }
  return { valid: true };
}

// Session Key 存储（演示用，内存存储）
// 生产环境应持久化到安全存储，私钥不进数据库
const sessionStore = new Map<string, SessionKeyPrivate>();

export function saveSessionKey(sk: SessionKeyPrivate): void {
  sessionStore.set(sk.sessionKey.id, sk);
}

export function getSessionKey(id: string): SessionKeyPrivate | undefined {
  return sessionStore.get(id);
}

export function listSessions(): SessionKey[] {
  return Array.from(sessionStore.values()).map((sk) => sk.sessionKey);
}

// 模拟：Agent 使用 Session Key 对交易签名
// 在 ERC-4337 流程中，Session Key 用来签名 UserOperation
// 这里演示签名动作本身
export async function signWithSessionKey(
  sk: SessionKeyPrivate,
  userOpHash: Hex
): Promise<Hex> {
  const account = privateKeyToAccount(sk.privateKey);
  return account.sign({ hash: userOpHash });
}
