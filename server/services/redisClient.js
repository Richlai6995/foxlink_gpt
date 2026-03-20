/**
 * Redis client with in-memory fallback for local development.
 * Set REDIS_URL in .env to enable Redis (e.g. redis://redis:6379).
 * If REDIS_URL is not set, falls back to a simple in-memory Map (single-process only).
 */
const TOKEN_TTL = parseInt(process.env.SESSION_TTL_SECONDS || '28800', 10); // 8 hours

// ── In-memory fallback ────────────────────────────────────────────────────────
class MemoryStore {
  constructor() {
    this.store = new Map();
  }
  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.exp && Date.now() > entry.exp) {
      this.store.delete(key);
      return null;
    }
    return entry.val;
  }
  async set(key, ttlSeconds, value) {
    this.store.set(key, { val: value, exp: Date.now() + ttlSeconds * 1000 });
  }
  async del(key) {
    this.store.delete(key);
  }
}

// ── Redis wrapper ─────────────────────────────────────────────────────────────
class RedisStore {
  constructor(client) {
    this.client = client;
  }
  async get(key) {
    return this.client.get(key);
  }
  async set(key, ttlSeconds, value) {
    await this.client.setex(key, ttlSeconds, value);
  }
  async del(key) {
    await this.client.del(key);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
let store = null;

function getStore() {
  if (store) return store;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[Redis] REDIS_URL not set — using in-memory token store (single-pod only)');
    store = new MemoryStore();
    return store;
  }

  const Redis = require('ioredis');
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: false,
    retryStrategy: () => null, // no retry, fallback immediately
  });

  client.on('connect', () => console.log('[Redis] Connected:', redisUrl));
  client.on('error', (err) => {
    console.warn('[Redis] Connection failed, falling back to in-memory store:', err.message);
    store = new MemoryStore();
    client.disconnect();
  });

  store = new RedisStore(client);
  return store;
}

// ── Public API ────────────────────────────────────────────────────────────────
module.exports = {
  TOKEN_TTL,
  /**
   * Save session data under token key with TTL.
   * @param {string} token
   * @param {object} data
   */
  async setSession(token, data) {
    await getStore().set(`sess:${token}`, TOKEN_TTL, JSON.stringify(data));
  },
  /**
   * Retrieve session data by token. Returns null if missing/expired.
   * @param {string} token
   * @returns {object|null}
   */
  async getSession(token) {
    const raw = await getStore().get(`sess:${token}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  /**
   * Delete a session (logout).
   * @param {string} token
   */
  async delSession(token) {
    await getStore().del(`sess:${token}`);
  },
};
