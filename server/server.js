require('dotenv').config();
require('./services/logger'); // File-based logging + process lifecycle tracking
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { init } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Serve uploaded files statically
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// NOTE: uncaughtException / unhandledRejection handlers are in services/logger.js
// with enhanced file-based logging and full stack traces.

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

(async () => {
  try {
    await init();
    console.log('Database initialized');

    const { router: authRouter } = require('./routes/auth');
    app.use('/api/auth', authRouter);
    console.log('[Route] /api/auth OK');
    app.use('/api/users', require('./routes/users'));
    console.log('[Route] /api/users OK');
    app.use('/api/chat', require('./routes/chat'));
    console.log('[Route] /api/chat OK');
    app.use('/api/admin', require('./routes/admin'));
    console.log('[Route] /api/admin OK');
    app.use('/api/scheduled-tasks', require('./routes/scheduledTasks'));
    console.log('[Route] /api/scheduled-tasks OK');
    app.use('/api/mcp-servers', require('./routes/mcpServers'));
    console.log('[Route] /api/mcp-servers OK');
    app.use('/api/dify-kb', require('./routes/difyKnowledgeBases'));
    console.log('[Route] /api/dify-kb OK');
    app.use('/api/roles', require('./routes/roles'));
    console.log('[Route] /api/roles OK');
    app.use('/api/share', require('./routes/share'));
    console.log('[Route] /api/share OK');
    app.use('/api/skills', require('./routes/skills'));
    console.log('[Route] /api/skills OK');

    // Auto-restore code skill runners
    try {
      const { db } = require('./database');
      const { autoRestoreRunners } = require('./services/skillRunner');
      autoRestoreRunners(db);
    } catch (e) {
      console.error('[SkillRunner] autoRestoreRunners failed:', e.message);
    }

    // Serve frontend in production
    const staticPath = path.join(__dirname, 'public');
    if (fs.existsSync(staticPath)) {
      app.use(express.static(staticPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(staticPath, 'index.html'));
      });
    }

    app.listen(PORT, () => {
      console.log(`FOXLINK GPT Server running on http://localhost:${PORT}`);

      // Start cleanup scheduler if configured
      try {
        const { db } = require('./database');
        const enabledRow = db.prepare(`SELECT value FROM system_settings WHERE key = 'cleanup_auto_enabled'`).get();
        if (enabledRow?.value === '1') {
          const hourRow = db.prepare(`SELECT value FROM system_settings WHERE key = 'cleanup_auto_hour'`).get();
          const { startScheduler } = require('./services/cleanupService');
          startScheduler(db, parseInt(hourRow?.value || '2'));
        }
      } catch (e) {
        console.error('[Cleanup] Failed to start scheduler:', e.message);
      }

      // Start backup scheduler if configured
      try {
        const { db } = require('./database');
        const rows = db.prepare(
          `SELECT key, value FROM system_settings WHERE key IN ('backup_schedule_enabled','backup_schedule_type','backup_schedule_hour','backup_schedule_weekday')`
        ).all();
        const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        if (map.backup_schedule_enabled === '1') {
          const { startBackupScheduler } = require('./services/backupService');
          startBackupScheduler(
            db,
            map.backup_schedule_type || 'daily',
            parseInt(map.backup_schedule_hour ?? '2'),
            parseInt(map.backup_schedule_weekday ?? '1')
          );
        }
      } catch (e) {
        console.error('[Backup] Failed to start scheduler:', e.message);
      }

      // Start org sync scheduler if configured
      try {
        const { db } = require('./database');
        const enabledRow = db.prepare(`SELECT value FROM system_settings WHERE key='org_sync_enabled'`).get();
        if (enabledRow?.value === '1') {
          const hourRow = db.prepare(`SELECT value FROM system_settings WHERE key='org_sync_hour'`).get();
          const { startScheduler } = require('./services/orgSyncService');
          startScheduler(db, parseInt(hourRow?.value ?? '2'));
        }
      } catch (e) {
        console.error('[OrgSync] Failed to start scheduler:', e.message);
      }

      // Init scheduled tasks (load all active tasks from DB)
      try {
        const { db } = require('./database');
        const { initScheduler } = require('./services/scheduledTaskService');
        initScheduler(db);
      } catch (e) {
        console.error('[ScheduledTasks] Failed to init scheduler:', e.message);
      }
    });
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
})();
