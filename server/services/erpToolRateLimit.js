'use strict';

/**
 * ERP Tool Rate Limit
 * 使用 Redis counter 做 per-user / global 的 rate limit
 */

const { getStore } = require('./redisClient');

function windowSeconds(window) {
  if (window === 'hour') return 3600;
  if (window === 'day')  return 86400;
  return 60; // minute 預設
}

/**
 * Check + bump 計數。超過上限時丟錯。
 * @param {object} tool - { id, rate_limit_per_user, rate_limit_global, rate_limit_window }
 * @param {number} userId
 */
async function enforce(tool, userId) {
  const perUser = Number(tool.rate_limit_per_user || 0);
  const global  = Number(tool.rate_limit_global || 0);
  if (!perUser && !global) return;

  const sec = windowSeconds(tool.rate_limit_window);
  const bucket = Math.floor(Date.now() / 1000 / sec);
  const store = getStore();

  if (perUser && userId) {
    const key = `erp:rl:u:${userId}:t:${tool.id}:${bucket}`;
    const cur = Number(await store.get(key)) || 0;
    if (cur >= perUser) {
      throw new Error(`呼叫過於頻繁:使用者每${windowLabel(tool.rate_limit_window)}上限 ${perUser} 次`);
    }
    await store.set(key, sec + 60, String(cur + 1));
  }

  if (global) {
    const key = `erp:rl:g:t:${tool.id}:${bucket}`;
    const cur = Number(await store.get(key)) || 0;
    if (cur >= global) {
      throw new Error(`呼叫過於頻繁:全域每${windowLabel(tool.rate_limit_window)}上限 ${global} 次`);
    }
    await store.set(key, sec + 60, String(cur + 1));
  }
}

function windowLabel(w) {
  if (w === 'hour') return '小時';
  if (w === 'day')  return '天';
  return '分鐘';
}

module.exports = { enforce };
