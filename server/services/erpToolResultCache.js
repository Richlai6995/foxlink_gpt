'use strict';

/**
 * ERP Tool Result Cache
 * Redis 儲存完整結果(gzip JSON),TTL 預設 30 分鐘
 */

const zlib = require('zlib');
const { getStore } = require('./redisClient');

const TTL = parseInt(process.env.ERP_TOOL_RESULT_CACHE_TTL || '1800', 10);

function makeKey(auditLogId) {
  return `erp:result:${auditLogId}`;
}

async function saveResult(auditLogId, fullResult) {
  try {
    const store = getStore();
    const json = JSON.stringify(fullResult);
    const gz = zlib.gzipSync(json).toString('base64');
    await store.set(makeKey(auditLogId), TTL, gz);
    return makeKey(auditLogId);
  } catch (e) {
    console.warn('[ErpToolResultCache] save failed:', e.message);
    return null;
  }
}

async function loadResult(cacheKey) {
  try {
    const store = getStore();
    const gz = await store.get(cacheKey);
    if (!gz) return null;
    const json = zlib.gunzipSync(Buffer.from(gz, 'base64')).toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    console.warn('[ErpToolResultCache] load failed:', e.message);
    return null;
  }
}

module.exports = { saveResult, loadResult, makeKey };
