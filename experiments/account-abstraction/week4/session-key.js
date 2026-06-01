"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionKey = createSessionKey;
exports.revokeSessionKey = revokeSessionKey;
exports.isSessionKeyValid = isSessionKeyValid;
exports.saveSessionKey = saveSessionKey;
exports.getSessionKey = getSessionKey;
exports.listSessions = listSessions;
exports.signWithSessionKey = signWithSessionKey;
const accounts_1 = require("viem/accounts");
// 创建一个新的 Session Key
function createSessionKey(policy) {
    const privateKey = (0, accounts_1.generatePrivateKey)();
    const account = (0, accounts_1.privateKeyToAccount)(privateKey);
    const session = {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        address: account.address,
        policy,
        createdAt: Date.now(),
        revoked: false,
    };
    return { sessionKey: session, privateKey };
}
// 撤销 Session Key
function revokeSessionKey(session) {
    return { ...session, revoked: true };
}
// 检查 Session Key 是否可用
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
// Session Key 存储（演示用，内存存储）
// 生产环境应持久化到安全存储，私钥不进数据库
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
// 模拟：Agent 使用 Session Key 对交易签名
// 在 ERC-4337 流程中，Session Key 用来签名 UserOperation
// 这里演示签名动作本身
async function signWithSessionKey(sk, userOpHash) {
    const account = (0, accounts_1.privateKeyToAccount)(sk.privateKey);
    return account.sign({ hash: userOpHash });
}
