'use strict';

/**
 * /api/db-sources — AI 戰情 Layer 2 資料庫來源管理
 * 僅系統管理員可存取
 *
 * Routes:
 *   GET    /api/db-sources          — 列出所有來源（密碼遮罩）
 *   GET    /api/db-sources/:id      — 取得單筆（密碼遮罩）
 *   POST   /api/db-sources          — 新增
 *   PUT    /api/db-sources/:id      — 更新
 *   DELETE /api/db-sources/:id      — 刪除（若有 schema 參照則拒絕）
 *   POST   /api/db-sources/:id/ping — 測試連線
 */

const express = require('express');
const router  = express.Router();
const { verifyToken } = require('./auth');
const { encryptPassword, decryptPassword } = require('../utils/dbCrypto');

router.use(verifyToken);

// re-export 供其他模組 require('../routes/dbSources').decryptPassword 仍可用
module.exports.decryptPassword = decryptPassword;
module.exports.encryptPassword = encryptPassword;

// ── 只有 admin 可管理 DB 來源 ─────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '僅系統管理員可操作 DB 來源' });
  next();
}

function maskSource(src) {
  return { ...src, password_enc: src.password_enc ? '****' : '' };
}

// ── GET /api/db-sources ──────────────────────────────────────────────────────
// admin: 看全部; 一般 user: 只看 active（供 schema 匯入下拉選單使用）
router.get('/', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const isAdmin = req.user?.role === 'admin';
    const rows = await db.prepare(
      isAdmin
        ? `SELECT * FROM ai_db_sources ORDER BY is_default DESC, name ASC`
        : `SELECT * FROM ai_db_sources WHERE is_active=1 ORDER BY is_default DESC, name ASC`
    ).all();
    res.json(rows.map(maskSource));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/db-sources/:id ──────────────────────────────────────────────────
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const db  = require('../database-oracle').db;
    const row = await db.prepare(`SELECT * FROM ai_db_sources WHERE id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: '找不到 DB 來源' });
    res.json(maskSource(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/db-sources ─────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const {
      name, db_type = 'oracle', host, port, service_name, database_name, schema_name,
      username, password, is_active = 1,
      pool_min = 1, pool_max = 5, pool_timeout = 60,
      ssl_enabled = 0, ssl_ca_cert,
    } = req.body;

    if (!name || !host || !username || !password) {
      return res.status(400).json({ error: 'name, host, username, password 為必填' });
    }
    if (!['oracle', 'mysql', 'mssql'].includes(db_type)) {
      return res.status(400).json({ error: 'db_type 必須為 oracle / mysql / mssql' });
    }

    const passwordEnc = encryptPassword(password);
    const portNum = port || (db_type === 'oracle' ? 1521 : db_type === 'mysql' ? 3306 : 1433);

    const r = await db.prepare(`
      INSERT INTO ai_db_sources
        (name, db_type, host, port, service_name, database_name, schema_name,
         username, password_enc, is_active,
         pool_min, pool_max, pool_timeout, ssl_enabled, ssl_ca_cert)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      name, db_type, host, portNum, service_name || null, database_name || null, schema_name || null,
      username, passwordEnc, is_active,
      pool_min, pool_max, pool_timeout, ssl_enabled, ssl_ca_cert || null,
    );
    const newId = r.lastInsertRowid;
    const created = await db.prepare(`SELECT * FROM ai_db_sources WHERE id=?`).get(newId);
    res.json(maskSource(created));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/db-sources/:id ──────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const db  = require('../database-oracle').db;
    const src = await db.prepare(`SELECT * FROM ai_db_sources WHERE id=?`).get(req.params.id);
    if (!src) return res.status(404).json({ error: '找不到 DB 來源' });

    const {
      name, db_type, host, port, service_name, database_name, schema_name,
      username, password, is_active,
      pool_min, pool_max, pool_timeout, ssl_enabled, ssl_ca_cert,
    } = req.body;

    // 密碼：前端送 '****' 表示不變，送空字串表示清除，送新值表示更新
    let passwordEnc = src.password_enc || src.PASSWORD_ENC;
    if (password && password !== '****') {
      passwordEnc = encryptPassword(password);
    } else if (password === '') {
      passwordEnc = '';
    }

    await db.prepare(`
      UPDATE ai_db_sources SET
        name=?, db_type=?, host=?, port=?,
        service_name=?, database_name=?, schema_name=?,
        username=?, password_enc=?, is_active=?,
        pool_min=?, pool_max=?, pool_timeout=?,
        ssl_enabled=?, ssl_ca_cert=?,
        updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(
      name        ?? (src.name         || src.NAME),
      db_type     ?? (src.db_type      || src.DB_TYPE      || 'oracle'),
      host        ?? (src.host         || src.HOST),
      port        ?? (src.port         || src.PORT),
      service_name  !== undefined ? (service_name  || null) : (src.service_name  || src.SERVICE_NAME  || null),
      database_name !== undefined ? (database_name || null) : (src.database_name || src.DATABASE_NAME || null),
      schema_name   !== undefined ? (schema_name   || null) : (src.schema_name   || src.SCHEMA_NAME   || null),
      username    ?? (src.username     || src.USERNAME),
      passwordEnc,
      is_active   !== undefined ? is_active : (src.is_active ?? src.IS_ACTIVE ?? 1),
      pool_min    ?? (src.pool_min     || src.POOL_MIN     || 1),
      pool_max    ?? (src.pool_max     || src.POOL_MAX     || 5),
      pool_timeout ?? (src.pool_timeout || src.POOL_TIMEOUT || 60),
      ssl_enabled !== undefined ? ssl_enabled : (src.ssl_enabled ?? src.SSL_ENABLED ?? 0),
      ssl_ca_cert !== undefined ? (ssl_ca_cert || null) : (src.ssl_ca_cert || src.SSL_CA_CERT || null),
      req.params.id,
    );

    // 清除此來源的連線池快取（下次查詢時重建）
    try {
      const { invalidatePoolCache } = require('../services/dashboardService');
      invalidatePoolCache(Number(req.params.id));
    } catch (_) {}

    const updated = await db.prepare(`SELECT * FROM ai_db_sources WHERE id=?`).get(req.params.id);
    res.json(maskSource(updated));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/db-sources/:id ───────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const db  = require('../database-oracle').db;
    const src = await db.prepare(`SELECT * FROM ai_db_sources WHERE id=?`).get(req.params.id);
    if (!src) return res.status(404).json({ error: '找不到 DB 來源' });

    const isDefault = src.is_default ?? src.IS_DEFAULT;
    if (isDefault) return res.status(400).json({ error: '預設 ERP 來源不可刪除' });

    // 檢查是否有 schema 參照
    const schemaCount = await db.prepare(
      `SELECT COUNT(*) AS CNT FROM ai_schema_definitions WHERE source_db_id=?`
    ).get(req.params.id);
    const cnt = schemaCount?.CNT ?? schemaCount?.cnt ?? 0;
    if (Number(cnt) > 0) {
      return res.status(400).json({ error: `尚有 ${cnt} 個 Schema 使用此 DB 來源，請先移除後再刪除` });
    }

    await db.prepare(`DELETE FROM ai_db_sources WHERE id=?`).run(req.params.id);

    // 清除連線池快取
    try {
      const { invalidatePoolCache } = require('../services/dashboardService');
      invalidatePoolCache(Number(req.params.id));
    } catch (_) {}

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/db-sources/:id/ping ────────────────────────────────────────────
router.post('/:id/ping', requireAdmin, async (req, res) => {
  try {
    const db  = require('../database-oracle').db;
    const src = await db.prepare(`SELECT * FROM ai_db_sources WHERE id=?`).get(req.params.id);
    if (!src) return res.status(404).json({ error: '找不到 DB 來源' });

    const dbType  = src.db_type  || src.DB_TYPE  || 'oracle';
    const { getAdapter } = require('../services/dbAdapters');
    const adapter = getAdapter(dbType);

    const password = decryptPassword(src.password_enc || src.PASSWORD_ENC);
    const config = {
      host:          src.host         || src.HOST,
      port:          src.port         || src.PORT,
      service_name:  src.service_name || src.SERVICE_NAME,
      database_name: src.database_name || src.DATABASE_NAME,
      username:      src.username     || src.USERNAME,
      password,
    };

    const result = await adapter.ping(config);

    // 更新 last_ping 狀態
    await db.prepare(
      `UPDATE ai_db_sources SET last_ping_at=SYSTIMESTAMP, last_ping_ok=? WHERE id=?`
    ).run(result.ok ? 1 : 0, req.params.id);

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
