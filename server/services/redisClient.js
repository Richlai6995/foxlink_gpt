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
    if (!(store instanceof MemoryStore)) {
      console.warn('[Redis] Connection failed, falling back to in-memory store:', err.message);
      store = new MemoryStore();
      client.removeAllListeners('error');
      client.on('error', () => {}); // swallow post-disconnect errors
      client.disconnect();
    }
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
   * Touch session — reset TTL (sliding expiration).
   * @param {string} token
   */
  async touchSession(token) {
    const s = getStore();
    if (s instanceof MemoryStore) {
      const entry = s.store.get(`sess:${token}`);
      if (entry) entry.exp = Date.now() + TOKEN_TTL * 1000;
    } else if (s.client && typeof s.client.expire === 'function') {
      await s.client.expire(`sess:${token}`, TOKEN_TTL);
    }
  },
  /**
   * Delete a session (logout).
   * @param {string} token
   */
  async delSession(token) {
    await getStore().del(`sess:${token}`);
  },
  /**
   * Get all active sessions (for online user monitoring).
   * Only works with MemoryStore; Redis would need SCAN.
   * @returns {object[]}
   */
  async getAllSessions() {
    const s = getStore();
    if (s instanceof MemoryStore) {
      const results = [];
      const now = Date.now();
      for (const [key, entry] of s.store) {
        if (!key.startsWith('sess:')) continue;
        if (entry.exp && now > entry.exp) continue;
        try { results.push(JSON.parse(entry.val)); } catch {}
      }
      return results;
    }
    // Redis: use SCAN to find sess:* keys
    if (s.client && typeof s.client.scanStream === 'function') {
      return new Promise((resolve, reject) => {
        const results = [];
        const stream = s.client.scanStream({ match: 'sess:*', count: 100 });
        const keys = [];
        stream.on('data', k => keys.push(...k));
        stream.on('end', async () => {
          try {
            for (const key of keys) {
              const raw = await s.client.get(key);
              if (raw) try { results.push(JSON.parse(raw)); } catch {}
            }
            resolve(results);
          } catch (e) { reject(e); }
        });
        stream.on('error', reject);
      });
    }
    return [];
  },
};
