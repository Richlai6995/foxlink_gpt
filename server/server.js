// NLS_LANG 必須在 require('oracledb') 之前設定，確保 Oracle Instant Client
// 知道 client charset = UTF-8，不會對已是 UTF-8 的 ERP DB 做多餘的轉換
// (.env 的設定有時在 Windows 上不夠早，所以在這裡強制覆蓋)
process.env.NLS_LANG = 'AMERICAN_AMERICA.AL32UTF8';

require('dotenv').config();
require('./services/logger'); // File-based logging + process lifecycle tracking

// ── undici (global fetch) timeout 全域拉長 ──
// Node 18+ 的 fetch 用 undici,預設 headersTimeout=300000ms (5分鐘)。
// Gemini AI Studio 對大檔(>100MB inline audio)response headers 常 5-10 分鐘才回,
// 5 分鐘踩 timeout 會回 "TypeError: fetch failed / cause: Headers Timeout Error",
// 即使我們上層 Promise.race 設 25 分也救不回來(undici 已經 abort connection)。
// 把 headers/body timeout 拉到 30 分鐘,connect timeout 仍短(30s)避免 DNS 卡死。
// 影響範圍:全 process 的 fetch (LLM API / Webex / 任何 HTTP client),這些本來就該允許慢。
{
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({
    headersTimeout: 30 * 60 * 1000,
    bodyTimeout:    30 * 60 * 1000,
    connectTimeout: 30 * 1000,
  }));
  console.log('[undici] global dispatcher set: headersTimeout=30m, bodyTimeout=30m, connectTimeout=30s');
}

require('./services/geminiClient').logStartupInfo(); // [GeminiClient] provider=... line
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { init } = require('./database-oracle');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Trust proxy ──
// 架構:client → nginx-ingress(1 跳)→ pod。trust proxy=1 讓 Express 從 X-Forwarded-For
// 鏈最右邊取 1 個 hop 當 client IP,攻擊者無法藉由偽造 XFF header 注入假 IP。
// 修正前 accessControl.getClientIp 直接信 XFF 第 1 個值,可被偽造繞過 isInternal 判斷。
// env TRUST_PROXY:數字 N 信任最右邊 N 個 hop,字串走 Express 白名單(loopback,linklocal,uniquelocal)
const TRUST_PROXY = process.env.TRUST_PROXY || '1';
app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
console.log(`[Express] trust proxy = ${TRUST_PROXY}`);

// ── Security Headers (helmet) ──
// 開常用安全 headers:HSTS / X-Content-Type-Options / X-Frame-Options / Referrer-Policy 等。
// CSP 暫時關閉(預設規則太嚴會破前端 inline style / eval),後續單獨評估上線。
// crossOriginEmbedderPolicy 關掉 — Vite + module worker / 第三方 iframe 兼容
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // HSTS:強制 HTTPS,內網 HTTP 跑時瀏覽器仍能連(僅對 https 請求生效)
  strictTransportSecurity: {
    maxAge: 60 * 60 * 24 * 180,  // 180 天
    includeSubDomains: true,
  },
}));

// ── CORS ──
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(
  allowedOrigins.length === 0
    ? {} // no restriction (backward compat / dev)
    : {
        origin: (origin, cb) => {
          // No origin = non-browser (curl / webhook / server-to-server) → allow
          // chrome-extension:// = Chrome Extension → allow
          if (!origin || allowedOrigins.includes(origin) || origin.startsWith('chrome-extension://')) {
            return cb(null, true);
          }
          // Disallowed origin: don't throw (causes 500), just omit CORS headers → browser blocks response
          cb(null, false);
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

// ── 安全聯動:外網開放(EXTERNAL_ACCESS_MODE=full)時必須啟用 MFA ──
// 防 ops 失誤把外網打開但忘記開 MFA → 裸奔。緊急狀況改回 webhook_only 收回外網,
// 而非關 MFA 留外網開放。
{
  const accessMode = (process.env.EXTERNAL_ACCESS_MODE || 'webhook_only').toLowerCase().trim();
  const mfaEnabled = process.env.MFA_ENABLED === 'true';
  if (accessMode === 'full' && !mfaEnabled) {
    console.error('[FATAL] EXTERNAL_ACCESS_MODE=full 必須搭配 MFA_ENABLED=true,拒絕啟動');
    process.exit(1);
  }
  console.log(`[Security] accessMode=${accessMode} | mfaEnabled=${mfaEnabled}`);
}

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
    // chat artifacts(tool-artifact-passthrough.md):路徑 /api/chat/artifacts/:id, /api/chat/sessions/:sid/artifacts
    app.use('/api/chat', require('./routes/chatArtifacts'));
    console.log('[Route] /api/chat/artifacts OK');
    app.use('/api/admin', require('./routes/admin'));

    app.use('/api/admin/factory-translations', require('./routes/factoryTranslations'));
    console.log('[Route] /api/admin OK');
    app.use('/api/scheduled-tasks', require('./routes/scheduledTasks'));
    console.log('[Route] /api/scheduled-tasks OK');
    app.use('/api/mcp-servers', require('./routes/mcpServers'));
    console.log('[Route] /api/mcp-servers OK');
    app.use('/api/erp-tools', require('./routes/erpTools'));
    console.log('[Route] /api/erp-tools OK');
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
    app.use('/api/user-charts', require('./routes/userCharts'));
    console.log('[Route] /api/user-charts OK');
    app.use('/api/chart-style-templates', require('./routes/chartStyleTemplates'));
    console.log('[Route] /api/chart-style-templates OK');
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
    app.use('/api/pipeline-writable-tables', require('./routes/pipelineWritableTables'));
    console.log('[Route] /api/pipeline-writable-tables OK');
    app.use('/api/pipeline-kb-write', require('./routes/pipelineKbWrite'));
    console.log('[Route] /api/pipeline-kb-write OK');
    app.use('/api/alert-rules', require('./routes/alertRules'));
    console.log('[Route] /api/alert-rules OK');
    app.use('/api/pm-bom', require('./routes/pmBom'));
    console.log('[Route] /api/pm-bom OK');
    app.use('/api/pm', require('./routes/pmReview'));
    console.log('[Route] /api/pm (review/feedback/accuracy) OK');
    app.use('/api/pm/briefing', require('./routes/pmBriefing'));
    console.log('[Route] /api/pm/briefing (news/prices/reports/preferences) OK');

    // Autoscan user email domains → Webex allowed-domain whitelist
    // 每次啟動時掃描 users.email，union 進白名單（只加不刪，admin 手動加的會保留）
    try {
      const { db } = require('./database-oracle');
      const { autoScanUserDomains } = require('./routes/webex');
      autoScanUserDomains(db).catch(e => console.error('[Webex][DomainAutoScan] unhandled:', e.message));
    } catch (e) {
      console.error('[Webex][DomainAutoScan] init error:', e.message);
    }

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

    // Phase 5 Track B: PM Forecast 校驗每日 cron(每 24h 跑一次,server 啟動 60s 後首跑)
    try {
      const { startAccuracyCron } = require('./services/pmForecastAccuracyService');
      startAccuracyCron();
    } catch (e) {
      console.error('[PmAccuracy] Failed to start:', e.message);
    }

    // Phase 5 Track B-4: PM Prompt Self-Improve cron(每天檢查,只在月初 1 號實際跑)
    try {
      const { startSelfImproveCron } = require('./services/pmPromptSelfImproveService');
      startSelfImproveCron();
    } catch (e) {
      console.error('[PmSelfImprove] Failed to start:', e.message);
    }

    // Phase 5 Track C-3: PM Webex Push cron(每分鐘檢查訂閱觸發)
    try {
      const { startPmWebexPushCron } = require('./services/pmWebexPushService');
      startPmWebexPushCron();
    } catch (e) {
      console.error('[PmWebexPush] Failed to start:', e.message);
    }

    // Phase 5 Track F-3: PM Source 健康監控(每 6h 驗 18 sources)
    try {
      const { startSourceHealthCron } = require('./services/pmSourceHealthService');
      startSourceHealthCron();
    } catch (e) { console.error('[PmSourceHealth] Failed to start:', e.message); }

    // Phase 5 Track F-2 + F-5: PM Token 預算 + cost aggregator(每 1h)
    try {
      const { startTokenBudgetCron } = require('./services/pmTokenBudgetService');
      startTokenBudgetCron();
    } catch (e) { console.error('[PmTokenBudget] Failed to start:', e.message); }

    // Phase 5 Track F-4: PM KB 維護(每 7d archive 90 天前 PM-新聞庫 chunks,預設 dry_run)
    try {
      const { startKbMaintenanceCron } = require('./services/pmKbMaintenanceService');
      startKbMaintenanceCron();
    } catch (e) { console.error('[PmKbMaint] Failed to start:', e.message); }

    // Phase 5 Track A: PM ERP Sync framework + auto-seed 3 template jobs(預設 dry_run + inactive)
    try {
      const { autoSeedPmErpSyncJobs } = require('./services/pmErpSyncSeed');
      const { db } = require('./database-oracle');
      await autoSeedPmErpSyncJobs(db);
    } catch (e) { console.error('[PmErpSyncSeed] Failed:', e.message); }
    try {
      const { startErpSyncCron } = require('./services/pmErpSyncService');
      startErpSyncCron();
    } catch (e) { console.error('[PmErpSync] Failed to start:', e.message); }

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
    process.on('SIGTERM', async () => {
      console.log('[Shutdown] SIGTERM received, closing gracefully...');
      // 把所有 in-flight research jobs 標回可恢復狀態,讓其他 pod 接手
      try {
        const { gracefullyPauseActiveJobs } = require('./services/researchService');
        const { db } = require('./database-oracle');
        await gracefullyPauseActiveJobs(db);
      } catch (e) {
        console.warn('[Shutdown] gracefullyPauseActiveJobs error:', e.message);
      }
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

    // PM retention cleanup scheduler — 預設凌晨清過期資料,時間在 PmSettingsPanel 可改
    try {
      const { startScheduler } = require('./services/pmRetentionCleanup');
      await startScheduler(db);
    } catch (e) {
      console.error('[PmRetention] Failed to start scheduler:', e.message);
    }

    // Research job recovery scheduler:啟動時跑一次 + 每 5 分鐘掃一次 stale jobs
    try {
      const { recoverStaleJobs } = require('./services/researchService');
      // 啟動時跑一次(撿起前次 server crash 留下的 running jobs)
      recoverStaleJobs(db).catch((e) => console.warn('[Research] startup recovery:', e.message));
      // 每 5 分鐘掃一次
      setInterval(() => {
        recoverStaleJobs(db).catch((e) => console.warn('[Research] recovery tick:', e.message));
      }, 5 * 60 * 1000);
    } catch (e) {
      console.error('[Research] Failed to start recovery scheduler:', e.message);
    }

    // KB maintenance scheduler（orphan chunks cleanup, Phase 1 of kb-retrieval v2）
    try {
      const enabledRow = await db.prepare(`SELECT value FROM system_settings WHERE key='kb_cleanup_enabled'`).get();
      if (enabledRow?.value !== '0') {
        const { startScheduler, runOnce } = require('./services/kbMaintenance');
        await startScheduler(db);
        // 啟動時先跑一次（保底；DB 層的 FK/trigger 正常狀況應該會是 0 筆）
        if (process.env.KB_CLEANUP_ON_STARTUP !== 'false') {
          runOnce(db).catch((e) => console.warn('[KbMaintenance] startup run:', e.message));
        }
      }
    } catch (e) {
      console.error('[KbMaintenance] Failed to start scheduler:', e.message);
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

    // Init Phase 3.1 standalone alert rule scheduler (1-min tick polling)
    try {
      const { initAlertRuleScheduler } = require('./services/alertRuleScheduler');
      initAlertRuleScheduler(db);
    } catch (e) {
      console.error('[AlertRuleScheduler] Failed to init:', e.message);
    }

    // Init AI 戰情 ETL Scheduler
    try {
      const { initEtlScheduler } = require('./services/dashboardService');
      initEtlScheduler(db);
    } catch (e) {
      console.error('[ETL Scheduler] Failed to init:', e.message);
    }

    // AI 戰情「費用分析」seed(冪等,只在第一次啟動或表缺時建立)
    try {
      const { runSeed } = require('./data/aiDashboardCostAnalysisSeed');
      runSeed(db).catch(e => console.warn('[CostAnalysisSeed] unhandled:', e.message));
    } catch (e) {
      console.warn('[CostAnalysisSeed] init error:', e.message);
    }

    // AI 戰情「金屬行情分析」seed(冪等,沿用 cost analysis seed 的本地 DB source)
    // 必須在 cost analysis seed 之後跑(因為要 lookup 已建好的 ai_db_sources entry)
    setTimeout(() => {
      try {
        const { runSeed: runMetalSeed } = require('./data/aiDashboardMetalPriceSeed');
        runMetalSeed(db).catch(e => console.warn('[MetalPriceSeed] unhandled:', e.message));
      } catch (e) {
        console.warn('[MetalPriceSeed] init error:', e.message);
      }
    }, 3000);

    // Factory code lookup + 間接員工計數同步(啟動後 5 秒跑,避免拖慢啟動)
    setTimeout(async () => {
      try {
        const { db } = require('./database-oracle');
        const { syncFactoryCodeLookup } = require('./services/factoryCodeLookupSync');
        const { syncIndirectEmpByPcFactory } = require('./services/indirectEmpSync');
        await syncFactoryCodeLookup(db).catch(e => console.warn('[FactoryCodeLookupSync] unhandled:', e.message));
        await syncIndirectEmpByPcFactory(db).catch(e => console.warn('[IndirectEmpSync] unhandled:', e.message));
      } catch (e) {
        console.warn('[ErpLookupSync] init error:', e.message);
      }
    }, 5000);

    // System sync cron 排程(daily / weekly / monthly,設定存於 system_settings,admin 在 ETL 排程頁維護)
    try {
      const { db } = require('./database-oracle');
      const { loadAndStart } = require('./services/systemSyncScheduler');
      loadAndStart(db).catch(e => console.warn('[SystemSyncScheduler] unhandled:', e.message));
    } catch (e) {
      console.warn('[SystemSyncScheduler] init error:', e.message);
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

    // Init ERP Tool metadata drift check cron
    try {
      const { initErpToolCron } = require('./services/erpToolCronService');
      initErpToolCron(db);
    } catch (e) {
      console.error('[ErpToolCron] Failed to init:', e.message);
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

    // Auto-seed builtin forecast skill (forecast_timeseries_llm)
    setImmediate(async () => {
      try {
        const { autoSeedForecastSkill } = require('./services/forecastSkillSeed');
        await autoSeedForecastSkill(db);
      } catch (e) {
        console.error('[ForecastSkillSeed] Failed:', e.message);
      }
    });

    // Auto-seed Excel 精確查詢 code skill (DuckDB SQL on uploaded xlsx)
    setImmediate(async () => {
      try {
        const { autoSeedExcelQuerySkill } = require('./services/excelQuerySkillSeed');
        await autoSeedExcelQuerySkill(db);
      } catch (e) {
        console.error('[ExcelQuerySkillSeed] Failed:', e.message);
      }
    });

    // Auto-seed PM Multi-Agent Workflow skill (pm_deep_analysis_workflow)
    setImmediate(async () => {
      try {
        const { autoSeedPmWorkflowSkill } = require('./services/pmWorkflowSeed');
        await autoSeedPmWorkflowSkill(db);
      } catch (e) {
        console.error('[PMWorkflowSeed] Failed:', e.message);
      }
    });

    // Auto-seed PM BOM What-if skill (pm_what_if_cost_impact) — Phase 4 14.1
    setImmediate(async () => {
      try {
        const { autoSeedPmBomSkill } = require('./services/pmBomSkillSeed');
        await autoSeedPmBomSkill(db);
      } catch (e) {
        console.error('[PMBomSkillSeed] Failed:', e.message);
      }
    });

    // Auto-seed PM (precious metals platform) KBs + scheduled tasks
    // 順序:KBs 先建 → 拿 ID Map → 餵給 task seed,task 的 kb_write 節點直接綁好 kb_id。
    // 兩者都 idempotent;task 預設 status='paused',admin 改 prompt / 加收件人後再 enable。
    setImmediate(async () => {
      try {
        const { autoSeedPmKnowledgeBases } = require('./services/pmKnowledgeBaseSeed');
        const { autoSeedPmScheduledTasks } = require('./services/pmScheduledTaskSeed');
        const kbMap = await autoSeedPmKnowledgeBases(db);
        await autoSeedPmScheduledTasks(db, kbMap);
      } catch (e) {
        console.error('[PMSeed] Failed:', e.message);
      }
    });

    // Auto-seed PM AI 戰情 Dashboard(project + topics + designs)
    // 依賴:LOCAL ai_db_sources + 5 張 PM 表的 ai_schema_definitions(由 D5 + aiSchemaAutoRegister 建)
    setImmediate(async () => {
      try {
        const { autoSeedPmDashboard } = require('./services/pmDashboardSeed');
        await autoSeedPmDashboard(db);
      } catch (e) {
        console.error('[PMDashboardSeed] Failed:', e.message);
      }
    });

    // Warm-up factory code cache from ERP (FND_FLEX_VALUES_VL)
    // 見 docs/factory-share-layer-plan.md §2.2
    setImmediate(async () => {
      try {
        const factoryCache = require('./services/factoryCache');
        await factoryCache.getFactoryMap();
      } catch (e) {
        console.error('[FactoryCache] Warm-up failed:', e.message);
      }
    });

    // Periodic cleanup: uploads/generated/ 和 uploads/webex_tmp/ 超過 24h 的暫存檔
    // uploads/tmp/ 也一併處理（chat pre-upload / multer scratch；24h 內若沒被 /messages 消耗掉就是 orphan）
    const GENERATED_DIR = path.join(UPLOAD_DIR, 'generated');
    const WEBEX_TMP_DIR = path.join(UPLOAD_DIR, 'webex_tmp');
    const MULTER_TMP_DIR = path.join(UPLOAD_DIR, 'tmp');
    const cleanupStaleTmpFiles = () => {
      const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
      const now = Date.now();
      for (const dir of [GENERATED_DIR, WEBEX_TMP_DIR, MULTER_TMP_DIR]) {
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
