'use strict';
/**
 * pendingPasswordStore.js — 加密 PDF「待輸入密碼」短期 token store(Phase 1c)
 *
 * 流程:
 *   1. skill 偵測 PDF 加密 → POST /api/_internal/pdf-pending-password 註冊
 *      { pdfPath, pdfName, userId, sessionId } → return { token, expiresIn }
 *   2. skill 回 artifact { mime:'application/x.pdf-password-prompt',
 *      content: JSON.stringify({token, file_name}) }
 *   3. 前端認 mime → 跳 modal 收密碼 → POST /api/pdf-docx-jobs/decrypt-submit
 *      { token, password, format?, vision_model? }
 *   4. decrypt-submit 從本 store 拿出 → ownership check → submitJob
 *
 * **密碼從未進 chat history** — 走前端 modal → REST endpoint,不經 LLM。
 *
 * 為什麼 in-memory:K8s 多 pod 場景,使用者 modal POST 可能命中不同 pod;
 * 簡化期間先單 pod 模式(實測 K8s ingress 多半 sticky session;若有問題改 Redis)。
 * 每筆 token 預設 15 分鐘過期,過期自動清。
 */

const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

const _store = new Map(); // token → { pdfPath, pdfName, userId, sessionId, expiresAt, createdAt, attempts }

/**
 * 註冊一筆待輸入密碼。
 * @returns {{ token: string, expiresIn: number }}
 */
function register({ pdfPath, pdfName, userId, sessionId }) {
  if (!pdfPath || !userId) throw new Error('register: pdfPath/userId required');
  const token = crypto.randomUUID();
  _store.set(token, {
    pdfPath,
    pdfName: pdfName || '',
    userId: Number(userId),
    sessionId: sessionId || null,
    expiresAt: Date.now() + TTL_MS,
    createdAt: Date.now(),
    attempts: 0,
  });
  return { token, expiresIn: Math.floor(TTL_MS / 1000) };
}

/**
 * 取出 + 不刪除(預檢看 ownership);verify=true 時驗 userId。
 */
function peek(token, { verifyUserId } = {}) {
  const entry = _store.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { _store.delete(token); return null; }
  if (verifyUserId != null && entry.userId !== Number(verifyUserId)) return null;
  return { ...entry };
}

/**
 * 取出 + 刪除(consume)。
 */
function consume(token, { verifyUserId } = {}) {
  const entry = peek(token, { verifyUserId });
  if (entry) _store.delete(token);
  return entry;
}

/**
 * 記一次密碼錯誤(modal 再讓使用者試一次),3 次就丟 token。
 */
function recordWrongPassword(token) {
  const entry = _store.get(token);
  if (!entry) return false;
  entry.attempts++;
  if (entry.attempts >= 3) {
    _store.delete(token);
    return false; // 超出嘗試,token gone
  }
  return true; // 還可以試
}

function stats() {
  return { size: _store.size, ttlMs: TTL_MS };
}

// Auto-sweep
let _sweeperHandle = null;
function startSweeper() {
  if (_sweeperHandle) return;
  _sweeperHandle = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [k, v] of _store) {
      if (v.expiresAt < now) { _store.delete(k); cleaned++; }
    }
    if (cleaned > 0) console.log(`[pendingPassword] sweeper cleaned ${cleaned} expired tokens, remaining=${_store.size}`);
  }, SWEEP_INTERVAL_MS).unref();
}

module.exports = {
  register, peek, consume, recordWrongPassword, stats, startSweeper,
  TTL_MS,
};
