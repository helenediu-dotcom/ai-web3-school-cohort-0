const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

// === Session Key：临时受限密钥 ===

/**
 * @typedef {Object} SessionKey
 * @property {string}          id
 * @property {string}          address
 * @property {import("./permission-policy").PermissionPolicy} policy
 * @property {number}          createdAt
 * @property {boolean}         revoked
 */

/**
 * @typedef {Object} SessionKeyPrivate
 * @property {SessionKey} sessionKey
 * @property {string}     privateKey
 */

// 创建新 Session Key
function createSessionKey(policy) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const session = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address: account.address,
    policy,
    createdAt: Date.now(),
    revoked: false,
  };

  return { sessionKey: session, privateKey };
}

// 撤销
function revokeSessionKey(session) {
  return { ...session, revoked: true };
}

// 检查是否可用
function isSessionKeyValid(session, now) {
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

// 内存存储（演示用）
const sessionStore = new Map();

function saveSessionKey(sk) {
  sessionStore.set(sk.sessionKey.id, sk);
}

function getSessionKey(id) {
  return sessionStore.get(id);
}

function listSessions() {
  return Array.from(sessionStore.values()).map((sk) => sk.sessionKey);
}

// Agent 使用 Session Key 签名
async function signWithSessionKey(sk, userOpHash) {
  const account = privateKeyToAccount(sk.privateKey);
  return account.sign({ hash: userOpHash });
}

module.exports = {
  createSessionKey,
  revokeSessionKey,
  isSessionKeyValid,
  saveSessionKey,
  getSessionKey,
  listSessions,
  signWithSessionKey,
};
