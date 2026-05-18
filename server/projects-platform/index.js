/**
 * projects-platform — module entry
 *
 * Feature flag controlled. Mount points all under /api/projects/*.
 * 嚴格 try/catch error boundary,exception 不冒泡出此 namespace。
 *
 * Spec: docs/projects-platform-spec.md v0.4
 * Decoupling: docs/projects-platform-decoupling-architecture.md
 */

const express = require('express');

const ENABLED = process.env.ENABLE_PROJECTS_PLATFORM === 'true';
const WORKERS_ENABLED = process.env.ENABLE_PROJECTS_WORKERS !== 'false'; // 預設跟著 ENABLED

let _started = false;

/**
 * 建立並回傳 Router(/api/projects/*)
 * 由 server.js 在 mount 階段呼叫;若 feature flag off 則回 null。
 */
function buildRouter() {
  if (!ENABLED) {
    console.log('[projects-platform] disabled (ENABLE_PROJECTS_PLATFORM != true)');
    return null;
  }

  // 確保 plugins 已 boot(idempotent — 同 plugin 重複 register 會 override)
  require('./plugins/registry').bootAll();

  const router = express.Router();

  // Error boundary middleware — 任何下游 throw 都被攔住
  router.use((req, res, next) => {
    const _origNext = next;
    Promise.resolve()
      .then(() => _origNext())
      .catch((e) => {
        console.error('[projects-platform] uncaught middleware:', e);
        if (!res.headersSent) {
          res.status(500).json({ error: 'projects-platform internal error' });
        }
      });
  });

  // 沿用 Cortex 既有 verifyToken auth middleware(共用 service,只 import 不修改)
  const { verifyToken } = require('../routes/auth');
  router.use(verifyToken);

  // Inject sidebar visibility into req(每個 request 都跑)
  const { injectVisibility, requireVisible } = require('./middleware/sidebarPermissionMiddleware');
  router.use(injectVisibility);

  // /me 路由不需 requireVisible(client 要拿 visibility info 判定 sidebar)
  router.use('/me', require('./routes/me'));

  // Health check(不限 admin,給外層 monitor 用)
  router.get('/_health', (req, res) => {
    res.json({
      module: 'projects-platform',
      version: '0.4-scaffold',
      enabled: ENABLED,
      workers_enabled: WORKERS_ENABLED,
      started_at: _started ? new Date().toISOString() : null,
    });
  });

  // 其他 /api/projects/* 全部都要 visible(沒 visible 直接 403)
  router.use(requireVisible);

  // Internal Admin(限 admin mode,middleware 內部再 require)
  router.use('/internal-admin', require('./routes/internalAdmin'));

  // Sprint 1 — Projects CRUD(含 Sprint 2 channels + Sprint C tasks nested under /:id/)
  router.use('/projects', require('./routes/projects'));

  // Sprint 2 — message-scoped routes(/messages/:mid/...)
  router.use('/messages', require('./routes/channels').messageScoped);

  // Sprint D — 跨專案儀表板 + Status SUMMARY
  router.use('/dashboard', require('./routes/dashboard'));

  // Sprint G — KB 雙層搜尋
  router.use('/kb', require('./routes/kb'));

  // Sprint K — 域內通訊(跨專案 channel)
  router.use('/comm-rooms', require('./routes/commRooms'));

  // Phase 1 polish — AI #1 RFQ extract(Wizard helper)
  router.use('/wizard', require('./routes/wizard'));

  // Route stubs — 後續 sprint 逐個實作
  // router.use('/projects/:id/tasks', require('./routes/tasks'));       // Sprint 6
  // router.use('/projects/:id/forms', require('./routes/forms'));       // Sprint 4
  // router.use('/projects/dashboard', require('./routes/dashboard'));   // Sprint 8

  // Final 404 fallback for /api/projects/*
  router.use((req, res) => {
    res.status(404).json({ error: 'projects-platform route not found', path: req.path });
  });

  // Final error handler
  router.use((err, req, res, next) => {
    console.error('[projects-platform] route error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'projects-platform error', message: err.message });
    }
  });

  return router;
}

/**
 * 跑 migrations(從外層 runMigrations 內呼叫,idempotent)
 */
async function runMigrations(db) {
  if (!ENABLED) return;
  try {
    // Plugin 必須先 boot — 005_seed 要從 registry 拉 plugin 資料
    require('./plugins/registry').bootAll();

    await require('./migrations/001_init')(db);
    await require('./migrations/002_channels')(db);
    await require('./migrations/003_workflow')(db);
    await require('./migrations/004_tasks')(db);
    await require('./migrations/005_seed')(db);
    await require('./migrations/006_messages')(db);
    await require('./migrations/007_kb')(db);
    await require('./migrations/008_roles')(db);
    await require('./migrations/009_kb_sediment')(db);
    await require('./migrations/010_comm_rooms')(db);
    console.log('[projects-platform] migrations ✓');
  } catch (e) {
    console.error('[projects-platform] migrations failed:', e.message, e.stack);
    // 不 throw — 讓 Cortex 主 migrations 繼續
  }
}

/**
 * 啟動 background workers(在 server boot 完成後呼叫)
 */
function startWorkers() {
  if (!ENABLED || !WORKERS_ENABLED) {
    console.log('[projects-platform] workers disabled');
    return;
  }
  try {
    // const statusSummaryWorker = require('./workers/statusSummaryWorker');
    // const slaWatcherWorker = require('./workers/slaWatcherWorker');
    // const kbArchiveWorker = require('./workers/kbArchiveWorker');
    // statusSummaryWorker.start();
    // slaWatcherWorker.start();
    // kbArchiveWorker.start();
    _started = true;
    console.log('[projects-platform] workers started (scaffold,實際 worker 未實作)');
  } catch (e) {
    console.error('[projects-platform] workers start failed:', e.message);
  }
}

/**
 * 停止 workers(graceful shutdown 用)
 */
function stopWorkers() {
  if (!_started) return;
  try {
    // statusSummaryWorker.stop();
    // slaWatcherWorker.stop();
    // kbArchiveWorker.stop();
    _started = false;
    console.log('[projects-platform] workers stopped');
  } catch (e) {
    console.error('[projects-platform] workers stop failed:', e.message);
  }
}

module.exports = {
  ENABLED,
  WORKERS_ENABLED,
  buildRouter,
  runMigrations,
  startWorkers,
  stopWorkers,
};
