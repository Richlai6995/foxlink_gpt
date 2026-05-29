'use strict';
/**
 * pendingPasswordStore.js — 加密 PDF「待輸入密碼」短期 token store(Phase 1c)
 *
 * 2026-05-29 改 Redis-backed:K8s 多 pod 場景必要(skill pod A 註冊 token,
 * modal POST 命中 pod B → 原 in-memory Map 找不到 → 失敗)。
 * Redis 未設(本機 dev)自動降級 in-memory Map(redisClient 內建 fallback)。
 *
 * 流程:
 *   1. skill 偵測 PDF 加密 → POST /api/_internal/pdf-pending-password 註冊
 *      { pdfPath, pdfName, userId, sessionId } → return { token, expiresIn }
 *   2. skill 回 pdf_password_prompt → chat.js sendEvent → 前端 modal
 *   3. modal POST /api/pdf-docx-jobs/decrypt-submit { token, password, ... }
 *   4. decrypt-submit → peek(verifyUserId) → ownership check
 *      → inspect 驗密碼(對 → consume + submitJob;錯 → recordWrongPassword)
 *
 * 密碼從未進 chat history — 走前端 modal → REST endpoint,不經 LLM。
 */

const crypto = require('crypto');
const { getSharedValue, setSharedValue, getStore } = require('./redisClient');

const TTL_SEC = 15 * 60;
const TTL_MS = TTL_SEC * 1000; // backward compat
const KEY_PREFIX = 'pdfpwd:';

function _key(token) { return `${KEY_PREFIX}${token}`; }

/**
 * 註冊一筆待輸入密碼。
 * @returns {Promise<{ token: string, expiresIn: number }>}
 */
async function register({ pdfPath, pdfName, userId, sessionId }) {
  if (!pdfPath || !userId) throw new Error('register: pdfPath/userId required');
  const token = crypto.randomUUID();
  const entry = {
    pdfPath,
    pdfName: pdfName || '',
    userId: Number(userId),
    sessionId: sessionId || null,
    attempts: 0,
    createdAt: Date.now(),
  };
  await setSharedValue(_key(token), JSON.stringify(entry), TTL_SEC);
  return { token, expiresIn: TTL_SEC };
}

/**
 * 取出不刪除;verify=true 時驗 userId。
 * @returns {Promise<object|null>}
 */
async function peek(token, { verifyUserId } = {}) {
  if (!token) return null;
  const raw = await getSharedValue(_key(token));
  if (!raw) return null;
  let entry;
  try { entry = JSON.parse(raw); }
  catch { return null; }
  if (verifyUserId != null && Number(entry.userId) !== Number(verifyUserId)) return null;
  return entry;
}

/**
 * 取出 + 刪除(decrypt-submit 成功時 call)。
 */
async function consume(token, { verifyUserId } = {}) {
  const entry = await peek(token, { verifyUserId });
  if (entry) {
    try { await getStore().del(_key(token)); } catch (_) {}
  }
  return entry;
}

/**
 * 密碼錯誤 → 累加 attempts,3 次清掉 token。
 * Race condition 容忍(兩個 wrong 同時可能少算 1 次,3 次容忍可接受)。
 * @returns {Promise<boolean>} 還可以再試
 */
async function recordWrongPassword(token) {
  const raw = await getSharedValue(_key(token));
  if (!raw) return false;
  let entry;
  try { entry = JSON.parse(raw); }
  catch { return false; }
  entry.attempts = (Number(entry.attempts) || 0) + 1;
  if (entry.attempts >= 3) {
    try { await getStore().del(_key(token)); } catch (_) {}
    return false;
  }
  await setSharedValue(_key(token), JSON.stringify(entry), TTL_SEC);
  return true;
}

function stats() {
  // Redis-backed 無法 trivially 算 size(要 SCAN),回 -1 表示 unknown
  return { backend: process.env.REDIS_URL ? 'redis' : 'memory', ttlMs: TTL_MS };
}

// no-op:redisClient memory store 沒過期 sweep 但 entry.exp 過期 get 時會自動刪;
// Redis 用 setex 內建 TTL,自動過期。保留 export 給既有 server.js 呼叫不 break。
function startSweeper() {
  console.log(`[pendingPassword] using ${process.env.REDIS_URL ? 'Redis' : 'in-memory'} store, TTL=${TTL_SEC}s`);
}

module.exports = {
  register, peek, consume, recordWrongPassword, stats, startSweeper,
  TTL_MS, TTL_SEC,
};
