const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { verifyToken, verifyAdmin } = require('./auth');
const { resetTransporter } = require('../services/mailService');

router.use(verifyToken);
router.use(verifyAdmin);

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const upload = multer({ dest: path.join(UPLOAD_DIR, 'tmp') });

// GET /api/admin/users (with stats)
router.get('/users', (req, res) => {
  try {
    const db = require('../database').db;
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.name, u.employee_id, u.email, u.role, u.status,
                u.start_date, u.end_date,
                u.allow_text_upload, u.text_max_mb, u.allow_audio_upload, u.audio_max_mb,
                u.allow_image_upload, u.image_max_mb, u.allow_scheduled_tasks,
                u.dept_code, u.dept_name, u.profit_center, u.profit_center_name,
                u.org_section, u.org_section_name, u.org_group_name, u.factory_code,
                u.org_end_date, u.org_synced_at,
                COUNT(DISTINCT cs.id) as session_count
         FROM users u
         LEFT JOIN chat_sessions cs ON cs.user_id = u.id
         GROUP BY u.id
         ORDER BY u.id ASC`
      )
      .all();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users/sync-org-all — 同步所有使用者組織資料 (must be defined BEFORE /:id route)
router.post('/users/sync-org-all', async (req, res) => {
  try {
    const db = require('../database').db;
    const { isConfigured } = require('../services/erpDb');
    if (!isConfigured()) {
      return res.status(400).json({ error: 'Oracle ERP 未設定 (請配置 ERP_DB_* 環境變數)' });
    }
    const { syncOrgToUsers } = require('../services/orgSyncService');
    const result = await syncOrgToUsers(db, null);
    res.json({ ...result, message: `已同步 ${result.synced} 筆組織資料` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users/:id/sync-org — 同步單一使用者組織資料
router.post('/users/:id/sync-org', async (req, res) => {
  try {
    const db = require('../database').db;
    const { isConfigured } = require('../services/erpDb');
    if (!isConfigured()) {
      return res.status(400).json({ error: 'Oracle ERP 未設定 (請配置 ERP_DB_* 環境變數)' });
    }
    const user = db.prepare('SELECT employee_id FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: '使用者不存在' });
    if (!user.employee_id) return res.status(400).json({ error: '此使用者未設定工號，無法同步組織資料' });
    const { syncOrgToUsers } = require('../services/orgSyncService');
    const result = await syncOrgToUsers(db, [String(user.employee_id)]);
    res.json({ ...result, message: `已同步 ${result.synced} 筆組織資料` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/token-usage
router.get('/token-usage', (req, res) => {
  try {
    const db = require('../database').db;
    const { startDate, endDate, userId, model } = req.query;

    let sql = `
      SELECT tu.id, tu.date, tu.model, tu.input_tokens, tu.output_tokens,
             COALESCE(tu.image_count, 0) as image_count,
             ROUND(tu.cost, 6) as cost, tu.currency,
             u.username, u.name, u.employee_id, u.email as user_email,
             u.dept_code, u.dept_name, u.profit_center, u.profit_center_name,
             u.org_section, u.org_section_name, u.org_group_name, u.factory_code
      FROM token_usage tu
      JOIN users u ON tu.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (startDate) { sql += ' AND tu.date >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND tu.date <= ?'; params.push(endDate); }
    if (userId) { sql += ' AND tu.user_id = ?'; params.push(userId); }
    if (model) { sql += ' AND tu.model = ?'; params.push(model); }
    sql += ' ORDER BY tu.date DESC, u.username ASC';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/token-prices
router.get('/token-prices', (req, res) => {
  try {
    const db = require('../database').db;
    const rows = db.prepare('SELECT * FROM token_prices ORDER BY model, start_date DESC').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/token-prices
router.post('/token-prices', (req, res) => {
  try {
    const db = require('../database').db;
    const { model, price_input, price_output, tier_threshold, price_input_tier2, price_output_tier2, price_image_output, currency, start_date, end_date } = req.body;
    if (!model || price_input == null || price_output == null || !start_date) {
      return res.status(400).json({ error: '請填寫必填欄位' });
    }
    const result = db.prepare(
      `INSERT INTO token_prices (model, price_input, price_output, tier_threshold, price_input_tier2, price_output_tier2, price_image_output, currency, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      model, parseFloat(price_input), parseFloat(price_output),
      tier_threshold ? parseInt(tier_threshold) : null,
      price_input_tier2 != null ? parseFloat(price_input_tier2) : null,
      price_output_tier2 != null ? parseFloat(price_output_tier2) : null,
      price_image_output != null && price_image_output !== '' ? parseFloat(price_image_output) : null,
      currency || 'USD', start_date, end_date || null
    );
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/token-prices/:id
router.put('/token-prices/:id', (req, res) => {
  try {
    const db = require('../database').db;
    const { model, price_input, price_output, tier_threshold, price_input_tier2, price_output_tier2, price_image_output, currency, start_date, end_date } = req.body;
    db.prepare(
      `UPDATE token_prices SET model=?, price_input=?, price_output=?, tier_threshold=?, price_input_tier2=?, price_output_tier2=?, price_image_output=?, currency=?, start_date=?, end_date=? WHERE id=?`
    ).run(
      model, parseFloat(price_input), parseFloat(price_output),
      tier_threshold ? parseInt(tier_threshold) : null,
      price_input_tier2 != null ? parseFloat(price_input_tier2) : null,
      price_output_tier2 != null ? parseFloat(price_output_tier2) : null,
      price_image_output != null && price_image_output !== '' ? parseFloat(price_image_output) : null,
      currency || 'USD', start_date, end_date || null, req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/token-prices/:id
router.delete('/token-prices/:id', (req, res) => {
  try {
    const db = require('../database').db;
    db.prepare('DELETE FROM token_prices WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/llm-models
router.get('/llm-models', (req, res) => {
  try {
    const db = require('../database').db;
    const rows = db.prepare('SELECT * FROM llm_models ORDER BY sort_order ASC, id ASC').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/llm-models
router.post('/llm-models', (req, res) => {
  try {
    const db = require('../database').db;
    const { key, name, api_model, description, is_active, sort_order, image_output } = req.body;
    if (!key?.trim() || !name?.trim() || !api_model?.trim()) {
      return res.status(400).json({ error: '請填寫 key、名稱及 API 模型字串' });
    }
    const result = db.prepare(
      `INSERT INTO llm_models (key, name, api_model, description, is_active, sort_order, image_output) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(key.trim(), name.trim(), api_model.trim(), description || null, is_active ? 1 : 0, sort_order || 0, image_output ? 1 : 0);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: 'Key 已存在' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/llm-models/:id
router.put('/llm-models/:id', (req, res) => {
  try {
    const db = require('../database').db;
    const { key, name, api_model, description, is_active, sort_order, image_output } = req.body;
    db.prepare(
      `UPDATE llm_models SET key=?, name=?, api_model=?, description=?, is_active=?, sort_order=?, image_output=? WHERE id=?`
    ).run(key.trim(), name.trim(), api_model.trim(), description || null, is_active ? 1 : 0, sort_order || 0, image_output ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: 'Key 已存在' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/llm-models/:id
router.delete('/llm-models/:id', (req, res) => {
  try {
    const db = require('../database').db;
    db.prepare('DELETE FROM llm_models WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', (req, res) => {
  try {
    const db = require('../database').db;
    const { startDate, endDate, userId, sensitive } = req.query;

    let sql = `
      SELECT al.id, al.session_id, al.content, al.has_sensitive,
             al.sensitive_keywords, al.notified, al.created_at,
             u.username, u.name, u.employee_id
      FROM audit_logs al
      JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (startDate) { sql += ` AND date(al.created_at) >= ?`; params.push(startDate); }
    if (endDate) { sql += ` AND date(al.created_at) <= ?`; params.push(endDate); }
    if (userId) { sql += ' AND al.user_id = ?'; params.push(userId); }
    if (sensitive === '1') { sql += ' AND al.has_sensitive = 1'; }
    sql += ' ORDER BY al.created_at DESC LIMIT 500';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/sensitive-keywords
router.get('/sensitive-keywords', (req, res) => {
  try {
    const db = require('../database').db;
    const rows = db.prepare(`SELECT * FROM sensitive_keywords ORDER BY id DESC`).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/sensitive-keywords
router.post('/sensitive-keywords', (req, res) => {
  const { keyword } = req.body;
  if (!keyword?.trim()) return res.status(400).json({ error: '請輸入關鍵字' });
  try {
    const db = require('../database').db;
    const result = db
      .prepare(`INSERT INTO sensitive_keywords (keyword) VALUES (?)`)
      .run(keyword.trim());
    res.json({ id: result.lastInsertRowid, keyword: keyword.trim() });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: '關鍵字已存在' });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/sensitive-keywords/import  (CSV bulk)
router.post('/sensitive-keywords/import', upload.single('csv_file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請上傳 CSV 檔案' });
  try {
    const db = require('../database').db;
    const content = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);

    const lines = content.split('\n').map((l) => l.trim().replace(/^["']|["']$/g, '').trim());
    // Skip header row if it looks like a header
    const keywords = lines.filter((k) => k && k.toLowerCase() !== 'keyword' && k !== '關鍵字');

    let imported = 0;
    let skipped = 0;
    for (const kw of keywords) {
      try {
        db.prepare(`INSERT OR IGNORE INTO sensitive_keywords (keyword) VALUES (?)`).run(kw);
        imported++;
      } catch {
        skipped++;
      }
    }
    res.json({ success: true, imported, skipped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/sensitive-keywords/:id
router.delete('/sensitive-keywords/:id', (req, res) => {
  try {
    const db = require('../database').db;
    db.prepare(`DELETE FROM sensitive_keywords WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/mail-settings  — read from process.env (source of truth = .env file)
router.get('/mail-settings', (req, res) => {
  res.json({
    server: process.env.SMTP_SERVER || '',
    port: process.env.SMTP_PORT || '25',
    username: process.env.SMTP_USERNAME || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.FROM_ADDRESS || '',
  });
});

// PUT /api/admin/mail-settings  — write back to .env + sync process.env live
router.put('/mail-settings', (req, res) => {
  try {
    const { server, port, username, password, from } = req.body;
    const mapping = {
      SMTP_SERVER: server,
      SMTP_PORT: port,
      SMTP_USERNAME: username,
      SMTP_PASSWORD: password,
      FROM_ADDRESS: from,
    };

    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

    for (const [key, value] of Object.entries(mapping)) {
      if (value === undefined || value === null) continue;
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent = envContent.trimEnd() + `\n${key}=${value}`;
      }
      process.env[key] = String(value); // live update without restart
    }

    fs.writeFileSync(envPath, envContent, 'utf-8');
    resetTransporter();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/mail-settings/test
router.post('/mail-settings/test', async (req, res) => {
  try {
    const { sendMail } = require('../services/mailService');
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: '請輸入收件人' });
    const ok = await sendMail({
      to,
      subject: '[FOXLINK GPT] 郵件測試',
      text: '這是 FOXLINK GPT 的郵件設定測試信件。',
    });
    res.json({ success: ok });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/db/export
router.get('/db/export', (req, res) => {
  try {
    const { exportDb, DB_PATH } = require('../database');
    const buffer = exportDb();
    if (!buffer) return res.status(500).json({ error: 'DB not initialized' });

    const filename = `foxlink_gpt_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/db/import
router.post('/db/import', upload.single('db_file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請上傳資料庫檔案' });
  try {
    const dbModule = require('../database');
    const { DB_PATH } = dbModule;

    // Backup current
    const backupPath = DB_PATH + '.bak';
    if (fs.existsSync(DB_PATH)) {
      fs.copyFileSync(DB_PATH, backupPath);
    }

    // Replace DB file
    fs.copyFileSync(req.file.path, DB_PATH);
    fs.unlinkSync(req.file.path);

    // Reload
    const ok = await dbModule.reload();
    if (ok) {
      res.json({ success: true, message: '資料庫匯入成功，已重新載入' });
    } else {
      // Restore backup
      if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, DB_PATH);
      res.status(500).json({ error: '匯入失敗，已還原備份' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/settings/auto-backup-path
router.get('/settings/auto-backup-path', (req, res) => {
  try {
    const db = require('../database').db;
    const row = db.prepare(`SELECT value FROM system_settings WHERE key = 'auto_backup_path'`).get();
    res.json({ path: row?.value || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/settings/auto-backup-path
router.put('/settings/auto-backup-path', (req, res) => {
  try {
    const db = require('../database').db;
    const { path: backupPath } = req.body;
    const existing = db.prepare(`SELECT key FROM system_settings WHERE key = 'auto_backup_path'`).get();
    if (existing) {
      db.prepare(`UPDATE system_settings SET value = ? WHERE key = 'auto_backup_path'`).run(backupPath || '');
    } else {
      db.prepare(`INSERT INTO system_settings (key, value) VALUES ('auto_backup_path', ?)`).run(backupPath || '');
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/db/auto-backup  — export DB to configured path on server filesystem
router.post('/db/auto-backup', (req, res) => {
  try {
    const db = require('../database').db;
    const { exportDb } = require('../database');
    const row = db.prepare(`SELECT value FROM system_settings WHERE key = 'auto_backup_path'`).get();
    const backupDir = row?.value?.trim();
    if (!backupDir) return res.status(400).json({ error: '尚未設定備份路徑' });

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let filename = `foxlink_gpt_${dateStr}.db`;
    let destPath = path.join(backupDir, filename);
    let ver = 2;
    while (fs.existsSync(destPath)) {
      filename = `foxlink_gpt_${dateStr}_v${ver++}.db`;
      destPath = path.join(backupDir, filename);
    }
    const buffer = exportDb();
    if (!buffer) return res.status(500).json({ error: 'DB not initialized' });
    fs.writeFileSync(destPath, buffer);
    res.json({ success: true, path: destPath, filename });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/settings/auto-backup-schedule
router.get('/settings/auto-backup-schedule', (req, res) => {
  try {
    const db = require('../database').db;
    const rows = db.prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('backup_schedule_enabled','backup_schedule_type','backup_schedule_hour','backup_schedule_weekday')`
    ).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      enabled: map.backup_schedule_enabled === '1',
      type: map.backup_schedule_type || 'daily',
      hour: parseInt(map.backup_schedule_hour ?? '2'),
      weekday: parseInt(map.backup_schedule_weekday ?? '1'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/settings/auto-backup-schedule
router.put('/settings/auto-backup-schedule', (req, res) => {
  try {
    const db = require('../database').db;
    const { enabled, type, hour, weekday } = req.body;

    const upsert = (key, value) => {
      const ex = db.prepare(`SELECT key FROM system_settings WHERE key = ?`).get(key);
      if (ex) {
        db.prepare(`UPDATE system_settings SET value = ? WHERE key = ?`).run(String(value), key);
      } else {
        db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run(key, String(value));
      }
    };

    upsert('backup_schedule_enabled', enabled ? '1' : '0');
    upsert('backup_schedule_type', type || 'daily');
    upsert('backup_schedule_hour', String(parseInt(hour ?? 2)));
    upsert('backup_schedule_weekday', String(parseInt(weekday ?? 1)));

    // Restart scheduler
    const { startBackupScheduler, stopBackupScheduler } = require('../services/backupService');
    if (enabled) {
      startBackupScheduler(db, type || 'daily', parseInt(hour ?? 2), parseInt(weekday ?? 1));
    } else {
      stopBackupScheduler();
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/settings/cleanup
router.get('/settings/cleanup', (req, res) => {
  try {
    const db = require('../database').db;
    const rows = db.prepare(`SELECT key, value FROM system_settings WHERE key LIKE 'cleanup_%'`).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      retention_days: parseInt(map.cleanup_retention_days || '90'),
      sensitive_days: parseInt(map.cleanup_sensitive_days || '365'),
      auto_enabled: map.cleanup_auto_enabled === '1',
      auto_hour: parseInt(map.cleanup_auto_hour || '2'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/settings/cleanup
router.put('/settings/cleanup', (req, res) => {
  try {
    const db = require('../database').db;
    const { retention_days, sensitive_days, auto_enabled, auto_hour } = req.body;

    const settings = {
      cleanup_retention_days: String(Math.max(1, parseInt(retention_days) || 90)),
      cleanup_sensitive_days: String(Math.max(1, parseInt(sensitive_days) || 365)),
      cleanup_auto_enabled: auto_enabled ? '1' : '0',
      cleanup_auto_hour: String(Math.min(23, Math.max(0, parseInt(auto_hour) || 2))),
    };

    for (const [key, value] of Object.entries(settings)) {
      const existing = db.prepare(`SELECT key FROM system_settings WHERE key = ?`).get(key);
      if (existing) {
        db.prepare(`UPDATE system_settings SET value = ? WHERE key = ?`).run(value, key);
      } else {
        db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run(key, value);
      }
    }

    const { startScheduler, stopScheduler } = require('../services/cleanupService');
    if (auto_enabled) {
      startScheduler(db, parseInt(auto_hour) || 2);
    } else {
      stopScheduler();
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/db/cleanup — manual cleanup
router.post('/db/cleanup', (req, res) => {
  try {
    const db = require('../database').db;
    const { runCleanup } = require('../services/cleanupService');

    const normalRow = db.prepare(`SELECT value FROM system_settings WHERE key = 'cleanup_retention_days'`).get();
    const sensitiveRow = db.prepare(`SELECT value FROM system_settings WHERE key = 'cleanup_sensitive_days'`).get();
    const normalDays = parseInt(normalRow?.value || '90');
    const sensitiveDays = parseInt(sensitiveRow?.value || '365');

    const stats = runCleanup(db, normalDays, sensitiveDays);
    console.log('[Cleanup] Manual run done:', stats);
    res.json({ success: true, stats, normalDays, sensitiveDays });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/chat-sessions (all users, for admin view)
router.get('/chat-sessions', (req, res) => {
  try {
    const db = require('../database').db;
    const { userId } = req.query;
    let sql = `
      SELECT cs.id, cs.title, cs.model, cs.created_at, cs.updated_at,
             u.username, u.name, u.employee_id,
             COUNT(cm.id) as message_count
      FROM chat_sessions cs
      JOIN users u ON cs.user_id = u.id
      LEFT JOIN chat_messages cm ON cm.session_id = cs.id
      WHERE 1=1
    `;
    const params = [];
    if (userId) { sql += ' AND cs.user_id = ?'; params.push(userId); }
    sql += ' GROUP BY cs.id ORDER BY cs.updated_at DESC LIMIT 200';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Cost Stats ────────────────────────────────────────────────────────────

/**
 * Build cost data for date range.
 * Returns array of { user_id, employee_id, user_name, date, model, input_tokens, output_tokens, cost, currency }
 * merged with org_cache.
 */
function getCostRows(db, startDate, endDate) {
  // Read org fields directly from users table
  try {
    return db.prepare(`
      SELECT tu.user_id, u.employee_id, u.name AS user_name, u.email AS user_email,
             tu.date, tu.model,
             COALESCE(tu.input_tokens, 0)  AS input_tokens,
             COALESCE(tu.output_tokens, 0) AS output_tokens,
             COALESCE(tu.cost, 0)          AS cost,
             COALESCE(tu.currency, 'USD')  AS currency,
             u.dept_code, u.dept_name, u.profit_center, u.profit_center_name,
             u.org_section, u.org_section_name, u.org_group_name, u.factory_code
      FROM token_usage tu
      JOIN users u ON tu.user_id = u.id
      WHERE tu.date BETWEEN ? AND ?
      ORDER BY tu.date
    `).all(startDate, endDate);
  } catch (e) {
    console.error('[CostStats] token_usage query error:', e.message);
    return [];
  }
}

function toCsv(headers, rows, getRow) {
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(getRow(r).map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\r\n');
}

// POST /api/admin/cost-stats/refresh-org-cache — refresh Oracle org data for all users
router.post('/cost-stats/refresh-org-cache', async (req, res) => {
  try {
    const db = require('../database').db;
    const { isConfigured, getEmployeeOrgData } = require('../services/erpDb');

    if (!isConfigured()) {
      return res.status(400).json({ error: 'Oracle ERP 未設定 (請配置 ERP_DB_* 環境變數)' });
    }

    const users = db.prepare('SELECT employee_id FROM users WHERE employee_id IS NOT NULL AND employee_id != ""').all();
    const empNos = users.map((u) => u.employee_id).filter(Boolean);

    if (empNos.length === 0) {
      return res.json({ updated: 0, message: '沒有設定工號的使用者' });
    }

    const rows = await getEmployeeOrgData(empNos);
    let updated = 0;

    for (const r of rows) {
      const existing = db.prepare('SELECT employee_no FROM org_cache WHERE employee_no=?').get(r.EMPLOYEE_NO);
      const vals = [
        r.C_NAME || null, r.EMAIL || null, r.DEPT_CODE || null, r.DEPT_NAME || null,
        r.PROFIT_CENTER || null, r.PROFIT_CENTER_NAME || null,
        r.ORG_SECTION || null, r.ORG_SECTION_NAME || null, r.ORG_GROUP_NAME || null,
        r.FACTORY_CODE || null, r.END_DATE ? String(r.END_DATE) : null,
        new Date().toISOString(), r.EMPLOYEE_NO,
      ];
      if (existing) {
        db.prepare(`UPDATE org_cache SET c_name=?,email=?,dept_code=?,dept_name=?,
          profit_center=?,profit_center_name=?,org_section=?,org_section_name=?,
          org_group_name=?,factory_code=?,end_date=?,cached_at=? WHERE employee_no=?`).run(...vals);
      } else {
        db.prepare(`INSERT INTO org_cache (c_name,email,dept_code,dept_name,profit_center,
          profit_center_name,org_section,org_section_name,org_group_name,factory_code,
          end_date,cached_at,employee_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...vals);
      }
      updated++;
    }

    res.json({ updated, total: empNos.length, message: `已同步 ${updated} 筆組織資料` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cost-stats/employees?startDate=&endDate=&profitCenter=&orgSection=
router.get('/cost-stats/employees', (req, res) => {
  try {
    const db = require('../database').db;
    const { startDate, endDate, profitCenter, orgSection, deptCode } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '請提供日期區間' });

    let rows = getCostRows(db, startDate, endDate);

    // Aggregate by employee
    const empMap = {};
    for (const r of rows) {
      const key = r.employee_id || `uid_${r.user_id}`;
      if (!empMap[key]) {
        empMap[key] = {
          user_id: r.user_id, employee_id: r.employee_id, user_name: r.user_name,
          user_email: r.user_email, dept_code: r.dept_code, dept_name: r.dept_name,
          profit_center: r.profit_center, profit_center_name: r.profit_center_name,
          org_section: r.org_section, org_section_name: r.org_section_name,
          org_group_name: r.org_group_name, factory_code: r.factory_code,
          input_tokens: 0, output_tokens: 0, cost: 0, currency: r.currency || 'USD',
        };
      }
      empMap[key].input_tokens += r.input_tokens || 0;
      empMap[key].output_tokens += r.output_tokens || 0;
      empMap[key].cost += r.cost || 0;
    }

    let result = Object.values(empMap);

    // Filters
    if (profitCenter) result = result.filter((r) => r.profit_center === profitCenter);
    if (orgSection) result = result.filter((r) => r.org_section === orgSection);
    if (deptCode) result = result.filter((r) => r.dept_code === deptCode);

    result.sort((a, b) => (b.cost || 0) - (a.cost || 0));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cost-stats/summary?startDate=&endDate=
router.get('/cost-stats/summary', (req, res) => {
  try {
    const db = require('../database').db;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '請提供日期區間' });

    const rows = getCostRows(db, startDate, endDate);

    // Aggregate by profit_center
    const pcMap = {};
    for (const r of rows) {
      const key = r.profit_center || '__NONE__';
      if (!pcMap[key]) {
        pcMap[key] = {
          profit_center: r.profit_center || '',
          profit_center_name: r.profit_center_name || '(未設定)',
          org_section: r.org_section || '',
          org_section_name: r.org_section_name || '',
          org_group_name: r.org_group_name || '',
          input_tokens: 0, output_tokens: 0, cost: 0, currency: r.currency || 'USD',
          _user_ids: new Set(),
          dept_breakdown: {},
        };
      }
      pcMap[key].input_tokens += r.input_tokens || 0;
      pcMap[key].output_tokens += r.output_tokens || 0;
      pcMap[key].cost += r.cost || 0;
      pcMap[key]._user_ids.add(r.user_id);
      // dept breakdown
      const dk = r.dept_code || '__';
      if (!pcMap[key].dept_breakdown[dk]) {
        pcMap[key].dept_breakdown[dk] = { dept_code: r.dept_code || '', dept_name: r.dept_name || '(未知)', cost: 0 };
      }
      pcMap[key].dept_breakdown[dk].cost += r.cost || 0;
    }

    const result = Object.values(pcMap).map((pc) => {
      const user_count = pc._user_ids.size;
      const { _user_ids, dept_breakdown, ...rest } = pc;
      return {
        ...rest,
        user_count,
        avg_cost: user_count > 0 ? pc.cost / user_count : 0,
        dept_breakdown: Object.values(dept_breakdown).sort((a, b) => b.cost - a.cost),
      };
    }).sort((a, b) => b.cost - a.cost);

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cost-stats/monthly?startDate=&endDate=
router.get('/cost-stats/monthly', (req, res) => {
  try {
    const db = require('../database').db;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '請提供日期區間' });

    const rows = getCostRows(db, startDate, endDate);

    // Aggregate by profit_center + month
    const map = {};
    for (const r of rows) {
      const month = r.date ? r.date.slice(0, 7) : ''; // YYYY-MM
      const key = `${r.profit_center || '__'}__${month}`;
      if (!map[key]) {
        map[key] = {
          profit_center: r.profit_center || '',
          profit_center_name: r.profit_center_name || '(未設定)',
          org_section: r.org_section || '',
          org_section_name: r.org_section_name || '',
          org_group_name: r.org_group_name || '',
          month,
          input_tokens: 0, output_tokens: 0, cost: 0, currency: r.currency || 'USD',
          _user_ids: new Set(),
        };
      }
      map[key].input_tokens += r.input_tokens || 0;
      map[key].output_tokens += r.output_tokens || 0;
      map[key].cost += r.cost || 0;
      map[key]._user_ids.add(r.user_id);
    }

    const result = Object.values(map).map((m) => {
      const user_count = m._user_ids.size;
      const { _user_ids, ...rest } = m;
      return { ...rest, user_count, avg_cost: user_count > 0 ? m.cost / user_count : 0 };
    }).sort((a, b) => {
      if (a.month !== b.month) return a.month.localeCompare(b.month);
      return b.cost - a.cost;
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cost-stats/export/employees?startDate=&endDate=...  → CSV
router.get('/cost-stats/export/employees', (req, res) => {
  try {
    const db = require('../database').db;
    const { startDate, endDate, profitCenter, deptCode } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '請提供日期區間' });

    let rows = getCostRows(db, startDate, endDate);
    const empMap = {};
    for (const r of rows) {
      const key = r.employee_id || `uid_${r.user_id}`;
      if (!empMap[key]) {
        empMap[key] = { ...r, input_tokens: 0, output_tokens: 0, cost: 0 };
      }
      empMap[key].input_tokens += r.input_tokens || 0;
      empMap[key].output_tokens += r.output_tokens || 0;
      empMap[key].cost += r.cost || 0;
    }
    let result = Object.values(empMap);
    if (profitCenter) result = result.filter((r) => r.profit_center === profitCenter);
    if (deptCode) result = result.filter((r) => r.dept_code === deptCode);
    result.sort((a, b) => (b.cost || 0) - (a.cost || 0));

    const headers = ['工號', '姓名', '部門代碼', '部門名稱', '利潤中心代碼', '利潤中心名稱', '事業處代碼', '事業處名稱', '事業群名稱', '廠區', 'Input Tokens', 'Output Tokens', '費用金額', '幣別'];
    const csv = toCsv(headers, result, (r) => [
      r.employee_id, r.user_name, r.dept_code, r.dept_name,
      r.profit_center, r.profit_center_name, r.org_section, r.org_section_name,
      r.org_group_name, r.factory_code, r.input_tokens, r.output_tokens,
      r.cost?.toFixed(6), r.currency,
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="employees_${startDate}_${endDate}.csv"`);
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cost-stats/export/summary?startDate=&endDate=  → CSV
router.get('/cost-stats/export/summary', (req, res) => {
  try {
    const db = require('../database').db;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '請提供日期區間' });

    const rows = getCostRows(db, startDate, endDate);
    const pcMap = {};
    for (const r of rows) {
      const key = r.profit_center || '__NONE__';
      if (!pcMap[key]) {
        pcMap[key] = {
          profit_center: r.profit_center || '', profit_center_name: r.profit_center_name || '(未設定)',
          org_section: r.org_section || '', org_section_name: r.org_section_name || '',
          org_group_name: r.org_group_name || '', cost: 0, currency: r.currency || 'USD',
          _user_ids: new Set(),
        };
      }
      pcMap[key].cost += r.cost || 0;
      pcMap[key]._user_ids.add(r.user_id);
    }
    const result = Object.values(pcMap).map((pc) => {
      const user_count = pc._user_ids.size;
      return { ...pc, user_count, avg_cost: user_count > 0 ? pc.cost / user_count : 0 };
    }).sort((a, b) => b.cost - a.cost);

    const headers = ['利潤中心代碼', '利潤中心名稱', '事業處代碼', '事業處名稱', '事業群名稱', '使用人數', '費用金額', '人均費用', '幣別'];
    const csv = toCsv(headers, result, (r) => [
      r.profit_center, r.profit_center_name, r.org_section, r.org_section_name,
      r.org_group_name, r.user_count, r.cost?.toFixed(6), r.avg_cost?.toFixed(6), r.currency,
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="summary_${startDate}_${endDate}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cost-stats/export/monthly?startDate=&endDate=  → CSV
router.get('/cost-stats/export/monthly', (req, res) => {
  try {
    const db = require('../database').db;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '請提供日期區間' });

    const rows = getCostRows(db, startDate, endDate);
    const map = {};
    for (const r of rows) {
      const month = r.date ? r.date.slice(0, 7) : '';
      const key = `${r.profit_center || '__'}__${month}`;
      if (!map[key]) {
        map[key] = {
          profit_center: r.profit_center || '', profit_center_name: r.profit_center_name || '(未設定)',
          org_section: r.org_section || '', org_section_name: r.org_section_name || '',
          org_group_name: r.org_group_name || '', month, cost: 0, currency: r.currency || 'USD',
          _user_ids: new Set(),
        };
      }
      map[key].cost += r.cost || 0;
      map[key]._user_ids.add(r.user_id);
    }
    const result = Object.values(map).map((m) => {
      const user_count = m._user_ids.size;
      return { ...m, user_count, avg_cost: user_count > 0 ? m.cost / user_count : 0 };
    }).sort((a, b) =>
      a.month !== b.month ? a.month.localeCompare(b.month) : b.cost - a.cost
    );

    const headers = ['利潤中心代碼', '利潤中心名稱', '事業處代碼', '事業處名稱', '事業群名稱', '月份', '使用人數', '費用金額', '人均費用', '幣別'];
    const csv = toCsv(headers, result, (r) => [
      r.profit_center, r.profit_center_name, r.org_section, r.org_section_name,
      r.org_group_name, r.month, r.user_count, r.cost?.toFixed(6), r.avg_cost?.toFixed(6), r.currency,
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="monthly_${startDate}_${endDate}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Org Sync Schedule ───────────────────────────────────────────────────────

// GET /api/admin/org-sync-schedule
router.get('/org-sync-schedule', (req, res) => {
  try {
    const db = require('../database').db;
    const rows = db.prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('org_sync_enabled','org_sync_hour','org_sync_last_run')`
    ).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      enabled: map.org_sync_enabled === '1',
      hour: parseInt(map.org_sync_hour ?? '2'),
      lastRun: map.org_sync_last_run || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/org-sync-schedule
router.post('/org-sync-schedule', (req, res) => {
  try {
    const db = require('../database').db;
    const { enabled, hour } = req.body;
    const h = parseInt(hour);
    if (isNaN(h) || h < 0 || h > 23) return res.status(400).json({ error: 'hour 必須為 0–23' });

    const upsert = (key, value) => {
      const existing = db.prepare(`SELECT key FROM system_settings WHERE key=?`).get(key);
      if (existing) {
        db.prepare(`UPDATE system_settings SET value=? WHERE key=?`).run(String(value), key);
      } else {
        db.prepare(`INSERT INTO system_settings (key, value) VALUES (?,?)`).run(key, String(value));
      }
    };

    upsert('org_sync_enabled', enabled ? '1' : '0');
    upsert('org_sync_hour', String(h));

    // Restart scheduler in-process
    const { startScheduler, stopScheduler } = require('../services/orgSyncService');
    if (enabled) {
      startScheduler(db, h);
    } else {
      stopScheduler();
    }

    res.json({ ok: true, enabled: !!enabled, hour: h });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/settings/scheduled-tasks
router.get('/settings/scheduled-tasks', (req, res) => {
  try {
    const db = require('../database').db;
    const rows = db.prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('scheduled_tasks_enabled','scheduled_tasks_max_per_user')`
    ).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      enabled: map.scheduled_tasks_enabled === '1',
      max_per_user: parseInt(map.scheduled_tasks_max_per_user || '10'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/settings/scheduled-tasks
router.put('/settings/scheduled-tasks', (req, res) => {
  try {
    const db = require('../database').db;
    const { enabled, max_per_user } = req.body;
    const upsert = (key, value) => {
      const ex = db.prepare(`SELECT key FROM system_settings WHERE key=?`).get(key);
      if (ex) {
        db.prepare(`UPDATE system_settings SET value=? WHERE key=?`).run(String(value), key);
      } else {
        db.prepare(`INSERT INTO system_settings (key, value) VALUES (?,?)`).run(key, String(value));
      }
    };
    if (enabled !== undefined) upsert('scheduled_tasks_enabled', enabled ? '1' : '0');
    if (max_per_user !== undefined) upsert('scheduled_tasks_max_per_user', String(parseInt(max_per_user) || 10));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: Skill Management ───────────────────────────────────────────────────
// GET /api/admin/skills
router.get('/skills', (req, res) => {
  try {
    const db = require('../database').db;
    const rows = db.prepare(`
      SELECT s.*, u.name AS owner_name, u.username AS owner_username
      FROM skills s LEFT JOIN users u ON u.id = s.owner_user_id
      ORDER BY s.pending_approval DESC, s.created_at DESC
    `).all();
    const parse = (v, d = []) => { try { return JSON.parse(v) || d; } catch { return d; } };
    res.json(rows.map(s => ({ ...s, mcp_tool_ids: parse(s.mcp_tool_ids), dify_kb_ids: parse(s.dify_kb_ids), tags: parse(s.tags), endpoint_secret: s.endpoint_secret ? '****' : '' })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/skills/:id/approve
router.put('/skills/:id/approve', (req, res) => {
  try {
    const db = require('../database').db;
    db.prepare('UPDATE skills SET is_public=1, is_admin_approved=1, pending_approval=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/skills/:id/reject
router.put('/skills/:id/reject', (req, res) => {
  try {
    const db = require('../database').db;
    db.prepare('UPDATE skills SET is_public=0, is_admin_approved=0, pending_approval=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/skills/:id — admin 可以直接編輯任何 skill
router.put('/skills/:id', (req, res) => {
  try {
    const db = require('../database').db;
    const s = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ error: '找不到 skill' });
    const { name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
      endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags, is_public, is_admin_approved } = req.body;
    const newSecret = (endpoint_secret && endpoint_secret !== '****') ? endpoint_secret : s.endpoint_secret;
    const parse = (v, d = []) => { try { return JSON.parse(v) || d; } catch { return d; } };
    db.prepare(`
      UPDATE skills SET name=?, description=?, icon=?, type=?, system_prompt=?,
        endpoint_url=?, endpoint_secret=?, endpoint_mode=?, model_key=?,
        mcp_tool_mode=?, mcp_tool_ids=?, dify_kb_ids=?, tags=?,
        is_public=?, is_admin_approved=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      name ?? s.name, description ?? s.description, icon ?? s.icon,
      type ?? s.type, system_prompt ?? s.system_prompt,
      endpoint_url ?? s.endpoint_url, newSecret,
      endpoint_mode ?? s.endpoint_mode, model_key ?? s.model_key,
      mcp_tool_mode ?? s.mcp_tool_mode,
      JSON.stringify(mcp_tool_ids ?? parse(s.mcp_tool_ids)),
      JSON.stringify(dify_kb_ids ?? parse(s.dify_kb_ids)),
      JSON.stringify(tags ?? parse(s.tags)),
      is_public ?? s.is_public, is_admin_approved ?? s.is_admin_approved,
      req.params.id
    );
    res.json(db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Code Skill Runners (/api/admin/skill-runners) ────────────────────────────
const skillRunner = require('../services/skillRunner');

// GET /api/admin/skill-runners — all code skills with runtime status
router.get('/skill-runners', (req, res) => {
  try {
    const db = require('../database').db;
    const skills = db.prepare(`SELECT id, name, icon, code_status, code_port, code_pid, code_error, code_packages FROM skills WHERE type='code' ORDER BY id ASC`).all();
    const result = skills.map((s) => {
      const rt = skillRunner.getStatus(s.id);
      return {
        ...s,
        code_packages: (() => { try { return JSON.parse(s.code_packages || '[]'); } catch { return []; } })(),
        runtime_running: rt.running,
        runtime_port: rt.port,
        runtime_pid: rt.pid,
      };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/skill-runners/:id/start
router.post('/skill-runners/:id/start', async (req, res) => {
  try {
    const db = require('../database').db;
    const skill = db.prepare('SELECT * FROM skills WHERE id=? AND type=?').get(req.params.id, 'code');
    if (!skill) return res.status(404).json({ error: '找不到 code skill' });
    if (!skill.code_snippet) return res.status(400).json({ error: '尚未儲存程式碼，請先儲存 code_snippet' });
    skillRunner.saveCode(skill.id, skill.code_snippet);
    const { port, pid } = await skillRunner.spawnRunner(skill, db);
    res.json({ success: true, port, pid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/skill-runners/:id/stop
router.post('/skill-runners/:id/stop', (req, res) => {
  try {
    const db = require('../database').db;
    const killed = skillRunner.killRunner(parseInt(req.params.id), db);
    res.json({ success: true, killed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/skill-runners/:id/restart
router.post('/skill-runners/:id/restart', async (req, res) => {
  try {
    const db = require('../database').db;
    const skill = db.prepare('SELECT * FROM skills WHERE id=? AND type=?').get(req.params.id, 'code');
    if (!skill) return res.status(404).json({ error: '找不到 code skill' });
    if (!skill.code_snippet) return res.status(400).json({ error: '尚未儲存程式碼' });
    skillRunner.saveCode(skill.id, skill.code_snippet);
    const { port, pid } = await skillRunner.restartRunner(skill, db);
    res.json({ success: true, port, pid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/skill-runners/:id/install — npm install with SSE log stream
router.post('/skill-runners/:id/install', async (req, res) => {
  try {
    const db = require('../database').db;
    const skill = db.prepare('SELECT * FROM skills WHERE id=? AND type=?').get(req.params.id, 'code');
    if (!skill) return res.status(404).json({ error: '找不到 code skill' });

    // Request body can override DB packages (for one-off install without editing skill)
    let packages;
    if (req.body && Array.isArray(req.body.packages)) {
      packages = req.body.packages.filter(p => typeof p === 'string' && p.trim());
      // Persist to DB so next install also uses the updated list
      if (packages.length > 0) {
        db.prepare(`UPDATE skills SET code_packages=? WHERE id=?`)
          .run(JSON.stringify(packages), skill.id);
      }
    } else {
      packages = (() => { try { return JSON.parse(skill.code_packages || '[]'); } catch { return []; } })();
    }

    // SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (line) => {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    };

    skillRunner.ensureRunnerDir(skill.id);
    if (skill.code_snippet) skillRunner.saveCode(skill.id, skill.code_snippet);

    try {
      await skillRunner.installPackages(skill.id, packages, send);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (e) {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/skill-runners/:id/logs — SSE live stdout/stderr
router.get('/skill-runners/:id/logs', (req, res) => {
  const skillId = parseInt(req.params.id);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send existing buffered lines
  const existing = skillRunner.getLogs(skillId);
  for (const line of existing) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ line: '--- subscribing to live log ---' })}\n\n`);

  skillRunner.subscribeLog(skillId, res);

  req.on('close', () => {
    skillRunner.unsubscribeLog(skillId, res);
  });
});

module.exports = router;
