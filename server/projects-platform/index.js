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

  // 🆕 Cortex BOM dev-test route(admin-only · 只在 ENABLE_CORTEX_BOM 掛 = dark-launch)
  //    放 requireVisible 前(用自身 requireAdminMode · 不需 BOM sidebar 設定)
  if (process.env.ENABLE_CORTEX_BOM === 'true') {
    router.use('/bom', require('./routes/bom'));
  }

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

  // Sprint M — AI 13 項深化(pricing / cleansheet / daily-report)
  router.use('/ai', require('./routes/ai'));

  // Sprint P — 多級簽核
  router.use('/approvals', require('./routes/approvals'));

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
    await require('./migrations/011_approvals')(db);

    // 🆕 Cortex BOM/RBAC rollout S0 — 全 gate 在 ENABLE_CORTEX_BOM 後(dark-launch)
    //    flag 未開 → 完全不執行 = schema 與 commit 前一致 = 對現有使用者零影響(可證明)
    //    flag 開 → 建 4 RBAC 表 + 46 BOM 表(全加性 · 冪等 · 不動既有表資料)
    if (process.env.ENABLE_CORTEX_BOM === 'true') {
      await require('./migrations/012_rbac')(db);                   // 三軸 RBAC 軸① 地基
      await require('./migrations/013a_bom_masters')(db);           // BOM superset Layer 1/2 master
      await require('./migrations/013b_bom_collection')(db);        // BOM superset Layer 3 結構鏈(FK projects)
      await require('./migrations/013c_cleansheet')(db);            // BOM superset 案級 cleansheet 計算鏈
      await require('./migrations/013d_factory_matrix_audit')(db);  // BOM superset Factory Matrix + audit
      await require('./migrations/013e_process_group')(db);         // process_group(DL 分組)+ 對齊真 Cleansheet 製程(S1)
      await require('./migrations/013f_equip_area_facility')(db);   // 案級設備(area/bucket/util)+ 廠房(sqft/util)新表(S1d)
      await require('./migrations/013g_process_output_override')(db);// case_process.weekly_output_override(品檢/支援製程承線速率 · S1d)
      await require('./migrations/013h_drop_legacy_equip')(db);      // DROP 設備舊模型 4 表(S1d 作廢 · 排最後)
      await require('./migrations/013i_simplified_line')(db);        // 案級 SIMPLIFIED 成本 line 輸入表(WHOOP · S1c)
      await require('./migrations/013j_price_vendor_link')(db);      // snapshot 加 bom_item_mfg_id + is_chosen(per-vendor 報價 · B-5b)
      await require('./migrations/013k_nre')(db);                    // NRE 一次性工程費(Track N · bom_nre_item + config)
      await require('./migrations/013l_run_nre_cols')(db);           // run_result 加 nre_per_unit(AMORTIZED 折進 total · Track N)
      await require('./migrations/013m_quote_version')(db);          // 報價定版/送審(bom_quote_version · 流程終點)
      await require('./migrations/013n_import_profile')(db);         // BOM 匯入設定檔(統一 canonical + mapping profile)
      await require('./migrations/013o_variant_effectivity')(db);    // BOM 變異維度 + 逐料 effectivity(super-BOM · 顏色/包裝)
      await require('./migrations/013p_run_variant_config')(db);     // bom_cs_run 記 config(切配置 → 撈該 config 的 run · B-2)
      await require('./migrations/013q_bom_v2_hierarchy')(db);       // BOM 層級 v2:半成品料號 + FLK 候選描述(R-1)
      await require('./migrations/013r_template_label')(db);         // 範本命名 template_label(C-2.5)
      await require('./migrations/013s_template_versioning')(db);    // 範本版本化 is_active + effective_from(C-3)
      await require('./migrations/013t_negotiation')(db);            // 議價紀錄 bom_negotiation_round(P1)
      await require('./migrations/013u_nre_negotiated')(db);         // NRE 議價欄 unit_price_negotiated(v0.16 #7)
      console.log('[projects-platform] Cortex BOM/RBAC migrations (S0) ✓');
    } else {
      console.log('[projects-platform] Cortex BOM/RBAC migrations skipped (ENABLE_CORTEX_BOM != true)');
    }

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
  // K8s 拆 pod:web pods 設 RUN_SCHEDULERS=false 不掛 cron(只 scheduler pod 掛)
  if (process.env.RUN_SCHEDULERS === 'false') {
    console.log('[projects-platform] workers skipped · RUN_SCHEDULERS=false (web pod)');
    return;
  }
  try {
    // Sprint M-13 — 主管日報 cron(預設關 · 看 PROJECTS_DAILY_REPORT_ENABLED env)
    const dailyReport = require('./services/dailyReportService');
    dailyReport.startCron();

    _started = true;
    console.log('[projects-platform] workers started');
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
    const dailyReport = require('./services/dailyReportService');
    dailyReport.stopCron();

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
