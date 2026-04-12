// NLS_LANG 必須在 require('oracledb') 之前設定，確保 Oracle Instant Client
// 知道 client charset = UTF-8，不會對已是 UTF-8 的 ERP DB 做多餘的轉換
// (.env 的設定有時在 Windows 上不夠早，所以在這裡強制覆蓋)
process.env.NLS_LANG = 'AMERICAN_AMERICA.AL32UTF8';

require('dotenv').config();
require('./services/logger'); // File-based logging + process lifecycle tracking
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { init } = require('./database-oracle');

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ──
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(
  allowedOrigins.length === 0
    ? {} // no restriction (backward compat / dev)
    : {
        origin: (origin, cb) => {
          // No origin = non-browser (curl / webhook / server-to-server) → allow
          if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
          cb(new Error('CORS blocked'));
        },
        credentials: true,
      }
));

app.use(express.json({
  limit: '100mb',
  verify: (req, _res, buf) => { req.rawBody = buf; }, // for Webex HMAC verification
}));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// ── External Access Control ──
const { createAccessControl } = require('./middleware/accessControl');
app.use(createAccessControl());

// Serve uploaded files statically
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res, filePath) => {
    // Ensure proper MIME + range support for media files (K8s nginx proxy-buffering:off workaround)
    if (filePath.endsWith('.mp3')) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('Accept-Ranges', 'bytes');
    }
  },
}));

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
    app.use('/api/kb', require('./routes/knowledgeBase'));
    console.log('[Route] /api/kb OK');
    app.use('/api/research', require('./routes/research'));
    console.log('[Route] /api/research OK');
    app.use('/api/api-keys', require('./routes/apiKeys'));
    console.log('[Route] /api/api-keys OK');
    app.use('/api/v1', require('./routes/externalKb'));
    console.log('[Route] /api/v1 OK');
    app.use('/api/dashboard', require('./routes/dashboard'));
    console.log('[Route] /api/dashboard OK');
    app.use('/api/db-sources', require('./routes/dbSources'));
    console.log('[Route] /api/db-sources OK');
    app.use('/api/data-permissions', require('./routes/dataPermissions'));
    console.log('[Route] /api/data-permissions OK');
    app.use('/api/monitor', require('./routes/monitor'));
    console.log('[Route] /api/monitor OK');
    app.use('/api/doc-templates', require('./routes/docTemplates'));
    console.log('[Route] /api/doc-templates OK');
    app.use('/api/webex', require('./routes/webex'));
    console.log('[Route] /api/webex OK');
    app.use('/api/help', require('./routes/helpSections'));
    console.log('[Route] /api/help OK');
    app.use('/api/training', require('./routes/training'));
    console.log('[Route] /api/training OK');
    app.use('/api/feedback', require('./routes/feedback'));
    console.log('[Route] /api/feedback OK');
    app.use('/api/transcribe', require('./routes/transcribe'));
    console.log('[Route] /api/transcribe OK');

    // Start Webex Bot listener (WebSocket primary, Polling fallback)
    try {
      const { startListener } = require('./services/webexListener');
      startListener();
    } catch (e) {
      console.error('[WebexListener] Failed to start:', e.message);
    }

    // Auto-restore code skill runners
    try {
      const { db } = require('./database-oracle');
      const { autoRestoreRunners, startHealthMonitor } = require('./services/skillRunner');
      autoRestoreRunners(db);
      startHealthMonitor(db);
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

    const http = require('http');
    const server = http.createServer(app);

    // Socket.io for feedback real-time chat
    try {
      const { initSocket } = require('./services/socketService');
      initSocket(server);
    } catch (e) {
      console.error('[Socket.io] Failed to initialize:', e.message);
    }

    // Feedback SLA cron job
    try {
      const { startSLACron } = require('./services/feedbackSLAService');
      startSLACron();
    } catch (e) {
      console.error('[FeedbackSLA] Failed to start:', e.message);
    }

    let _portRetried = false;
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        if (_portRetried) {
          // Already retried once — give up and let the watcher restart us
          console.error(`[FATAL] Port ${PORT} still in use after retry, exiting...`);
          process.exit(1);
          return;
        }
        _portRetried = true;
        console.warn(`[WARN] Port ${PORT} in use, killing old process and retrying once...`);
        const { execSync } = require('child_process');
        try {
          if (process.platform === 'win32') {
            const out = execSync(
              `powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique"`
            ).toString().trim();
            out.split('\n').map(s => s.trim()).filter(Boolean).forEach(pid => {
              if (Number(pid) > 0 && Number(pid) !== process.pid) {
                try { execSync(`powershell -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`); } catch {}
              }
            });
          } else {
            try { execSync(`fuser -k ${PORT}/tcp`); } catch {}
          }
        } catch {}
        // Wait 2s for the killed process to release the socket, then retry exactly once
        setTimeout(() => server.listen(PORT), 2000);
      }
    });
    server.listen(PORT, () => {
      console.log(`FOXLINK GPT Server running on http://localhost:${PORT}`);
    });

    // Graceful shutdown for K8s rolling update
    process.on('SIGTERM', () => {
      console.log('[Shutdown] SIGTERM received, closing gracefully...');
      server.close(async () => {
        try {
          const { getPool } = require('./database-oracle');
          const p = getPool();
          if (p) await p.close(10);
        } catch (e) { console.error('[Shutdown] Oracle pool close error:', e.message); }
        console.log('[Shutdown] Clean exit');
        process.exit(0);
      });
      // Force exit after 55s (K8s terminationGracePeriodSeconds: 60)
      setTimeout(() => { console.error('[Shutdown] Force exit'); process.exit(1); }, 55000);
    });

    // Start post-listen async schedulers
    const { db } = require('./database-oracle');

    // Cleanup scheduler
    try {
      const enabledRow = await db.prepare(`SELECT value FROM system_settings WHERE key = 'cleanup_auto_enabled'`).get();
      if (enabledRow?.value === '1') {
        const hourRow = await db.prepare(`SELECT value FROM system_settings WHERE key = 'cleanup_auto_hour'`).get();
        const { startScheduler } = require('./services/cleanupService');
        startScheduler(db, parseInt(hourRow?.value || '2'));
      }
    } catch (e) {
      console.error('[Cleanup] Failed to start scheduler:', e.message);
    }

    // Backup scheduler (Oracle mode: schedule-settings preserved, actual backup disabled)
    try {
      const rows = await db.prepare(
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

    // Org sync scheduler
    try {
      const enabledRow = await db.prepare(`SELECT value FROM system_settings WHERE key='org_sync_enabled'`).get();
      if (enabledRow?.value === '1') {
        const hourRow = await db.prepare(`SELECT value FROM system_settings WHERE key='org_sync_hour'`).get();
        const { startScheduler } = require('./services/orgSyncService');
        startScheduler(db, parseInt(hourRow?.value ?? '2'));
      }
    } catch (e) {
      console.error('[OrgSync] Failed to start scheduler:', e.message);
    }

    // Init scheduled tasks
    try {
      const { initScheduler } = require('./services/scheduledTaskService');
      initScheduler(db);
    } catch (e) {
      console.error('[ScheduledTasks] Failed to init scheduler:', e.message);
    }

    // Init AI 戰情 ETL Scheduler
    try {
      const { initEtlScheduler } = require('./services/dashboardService');
      initEtlScheduler(db);
    } catch (e) {
      console.error('[ETL Scheduler] Failed to init:', e.message);
    }

    // Init System Monitor Metrics Collector
    try {
      const { startMetricsCollector } = require('./services/metricsCollector');
      startMetricsCollector(db);
    } catch (e) {
      console.error('[MetricsCollector] Failed to start:', e.message);
    }

    // Init Training Cron (auto-complete, reminders, overdue)
    try {
      const { initTrainingCron } = require('./services/trainingCronService');
      initTrainingCron(db);
    } catch (e) {
      console.error('[TrainingCron] Failed to init:', e.message);
    }

    // Auto-sync Help KB (non-blocking, runs in background)
    setImmediate(async () => {
      try {
        const { syncHelpKb } = require('./services/helpKbSync');
        await syncHelpKb(db);
      } catch (e) {
        console.error('[HelpKB] Failed to sync:', e.message);
      }
    });

    // Auto-seed Help Sections (compare last_modified, upsert changed sections)
    setImmediate(async () => {
      try {
        const { autoSeedHelp } = require('./services/helpAutoSeed');
        await autoSeedHelp(db);
      } catch (e) {
        console.error('[HelpAutoSeed] Failed:', e.message);
      }
    });

    // Periodic cleanup: uploads/generated/ 和 uploads/webex_tmp/ 超過 24h 的暫存檔
    const GENERATED_DIR = path.join(UPLOAD_DIR, 'generated');
    const WEBEX_TMP_DIR = path.join(UPLOAD_DIR, 'webex_tmp');
    const cleanupStaleTmpFiles = () => {
      const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
      const now = Date.now();
      for (const dir of [GENERATED_DIR, WEBEX_TMP_DIR]) {
        if (!fs.existsSync(dir)) continue;
        try {
          let cleaned = 0;
          for (const f of fs.readdirSync(dir)) {
            const fp = path.join(dir, f);
            try {
              const stat = fs.statSync(fp);
              if (stat.isFile() && now - stat.mtimeMs > ttlMs) {
                fs.unlinkSync(fp);
                cleaned++;
              }
            } catch (_) {}
          }
          if (cleaned > 0) console.log(`[TmpCleanup] ${dir}: removed ${cleaned} stale files`);
        } catch (e) {
          console.error(`[TmpCleanup] Error scanning ${dir}:`, e.message);
        }
      }
    };
    // 啟動後立即執行一次，之後每小時執行
    cleanupStaleTmpFiles();
    setInterval(cleanupStaleTmpFiles, 60 * 60 * 1000);
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
})();
