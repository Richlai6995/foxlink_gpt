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

  // Health check
  router.get('/_health', (req, res) => {
    res.json({
      module: 'projects-platform',
      version: '0.4-scaffold',
      enabled: ENABLED,
      workers_enabled: WORKERS_ENABLED,
      started_at: _started ? new Date().toISOString() : null,
    });
  });

  // Route stubs — 後續 phase 1 開發逐個實作
  // router.use('/projects', require('./routes/projects'));
  // router.use('/projects/wizard', require('./routes/wizard'));
  // router.use('/projects/:id/channels', require('./routes/channels'));
  // router.use('/projects/:id/tasks', require('./routes/tasks'));
  // router.use('/projects/:id/forms', require('./routes/forms'));
  // router.use('/projects/dashboard', require('./routes/dashboard'));

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
    const migration001 = require('./migrations/001_init');
    await migration001(db);
    console.log('[projects-platform] migrations ✓');
  } catch (e) {
    console.error('[projects-platform] migrations failed:', e.message);
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
