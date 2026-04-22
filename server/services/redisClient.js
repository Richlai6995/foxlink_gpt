/**
 * Redis client with in-memory fallback for local development.
 * Set REDIS_URL in .env to enable Redis (e.g. redis://redis:6379).
 * If REDIS_URL is not set, falls back to a simple in-memory Map (single-process only).
 */
const TOKEN_TTL       = parseInt(process.env.SESSION_TTL_SECONDS       || '28800',   10); // 8 hours (一般使用者)
const ADMIN_TOKEN_TTL = parseInt(process.env.ADMIN_SESSION_TTL_SECONDS || '2592000', 10); // 30 days (管理員)

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
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    lazyConnect: false,
    retryStrategy(times) {
      if (times > 10) {
        // 超過 10 次放棄 Redis，降級到 in-memory
        console.warn('[Redis] 超過 10 次重試，降級為 in-memory store');
        store = new MemoryStore();
        return null;
      }
      return Math.min(times * 500, 3000);   // 500ms, 1s, 1.5s … 最多 3s
    },
  });

  client.on('connect', () => console.log('[Redis] Connected:', redisUrl));
  client.on('error', (err) => {
    console.warn('[Redis] error:', err.message);
  });

  store = new RedisStore(client);
  return store;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Distributed lock via Redis SET NX EX.
 * Falls back to a process-level mutex in MemoryStore mode (local dev).
 */
const _memLocks = new Set();

module.exports = {
  TOKEN_TTL,
  ADMIN_TOKEN_TTL,
  // Expose low-level store getter for services that need direct access
  // (erpToolResultCache, erpResultTranslator 都有用)
  getStore,

  /**
   * Try to acquire a distributed lock.
   * Returns true if acquired, false if someone else holds it.
   * @param {string} key  Lock key (e.g. 'lock:help_kb_sync')
   * @param {number} ttlSeconds  Auto-expire (prevents deadlock if pod crashes)
   */
  async tryLock(key, ttlSeconds = 120) {
    const s = getStore();
    if (s instanceof MemoryStore) {
      if (_memLocks.has(key)) return false;
      _memLocks.add(key);
      return true;
    }
    // ioredis SET NX EX
    const result = await s.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  },

  /**
   * Generic shared key-value get (for cross-pod state like cursors).
   * @param {string} key
   * @returns {string|null}
   */
  async getSharedValue(key) {
    const s = getStore();
    return s.get(key);
  },

  /**
   * Generic shared key-value set with TTL.
   * @param {string} key
   * @param {string} value
   * @param {number} ttlSeconds
   */
  async setSharedValue(key, value, ttlSeconds = 600) {
    const s = getStore();
    await s.set(key, ttlSeconds, value);
  },

  /**
   * Release a distributed lock.
   */
  async unlock(key) {
    const s = getStore();
    if (s instanceof MemoryStore) {
      _memLocks.delete(key);
      return;
    }
    await s.client.del(key);
  },

  /**
   * Save session data under token key with TTL.
   * @param {string} token
   * @param {object} data
   * @param {boolean} [isAdmin=false] 管理員使用 30 天 TTL
   */
  async setSession(token, data, isAdmin = false) {
    const ttl = isAdmin ? ADMIN_TOKEN_TTL : TOKEN_TTL;
    await getStore().set(`sess:${token}`, ttl, JSON.stringify(data));
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
   * @param {boolean} [isAdmin=false] 管理員使用 30 天 TTL，一般使用者使用 SESSION_TTL
   */
  async touchSession(token, isAdmin = false) {
    const ttl = isAdmin ? ADMIN_TOKEN_TTL : TOKEN_TTL;
    const s = getStore();
    if (s instanceof MemoryStore) {
      const entry = s.store.get(`sess:${token}`);
      if (entry) entry.exp = Date.now() + ttl * 1000;
    } else if (s.client && typeof s.client.expire === 'function') {
      await s.client.expire(`sess:${token}`, ttl);
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
