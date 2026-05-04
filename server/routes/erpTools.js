'use strict';

/**
 * ERP Tools Routes
 * - 註冊 / CRUD / inspect metadata
 * - LOV 解析
 * - 試跑 / 執行
 * - Audit log / 完整結果快取
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

const metaSvc = require('../services/erpToolMetadata');
const schemaGen = require('../services/erpToolSchemaGen');
const lovResolver = require('../services/erpToolLovResolver');
const executor = require('../services/erpToolExecutor');
const resultCache = require('../services/erpToolResultCache');
const proxySkill = require('../services/erpToolProxySkill');
const erpDb = require('../services/erpDb');
const { resolveGranteeNamesInRows, getLangFromReq } = require('../services/granteeNameResolver');

router.use(verifyToken);

function getDb() { return require('../database-oracle').db; }

function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: '僅管理員可操作 ERP Tools' });
    return false;
  }
  return true;
}

function parseJson(s, fallback) {
  if (!s) return fallback;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

/**
 * 正規化 params:有動態 LOV(sql/system/erp_tool)但沒設 llm_resolve_mode 的參數
 * 預設 'auto',讓 LLM 對話能以 CODE/NAME 自然提問。
 * Admin 顯式選 value_only / label_only 時尊重其設定。
 */
function normalizeParamsLlmMode(params) {
  if (!Array.isArray(params)) return params;
  return params.map(p => {
    if (!p || !p.lov_config || !p.lov_config.type || p.lov_config.type === 'static') return p;
    if (p.llm_resolve_mode) return p;
    return { ...p, llm_resolve_mode: 'auto' };
  });
}

function serializeTool(row, lang) {
  const get = (k) => row[k] ?? row[k.toUpperCase()];
  const t = {
    id: get('id'),
    code: get('code'),
    name: get('name'),
    description: get('description'),
    tags: parseJson(get('tags'), []),
    db_owner: get('db_owner'),
    package_name: get('package_name'),
    object_name: get('object_name'),
    overload: get('overload'),
    routine_type: get('routine_type'),
    metadata_hash: get('metadata_hash'),
    metadata_checked_at: get('metadata_checked_at'),
    metadata_drifted: Number(get('metadata_drifted') ?? 0),
    access_mode: get('access_mode'),
    requires_approval: Number(get('requires_approval') ?? 0),
    allow_llm_auto: Number(get('allow_llm_auto') ?? 1),
    allow_inject: Number(get('allow_inject') ?? 0),
    allow_manual: Number(get('allow_manual') ?? 1),
    params: parseJson(get('params_json'), []),
    returns: parseJson(get('returns_json'), null),
    tool_schema: parseJson(get('tool_schema_json'), null),
    inject_config: parseJson(get('inject_config_json'), null),
    answer_output_format: parseJson(get('answer_output_format_json'), null),
    max_rows_llm: Number(get('max_rows_llm') ?? 50),
    max_rows_ui: Number(get('max_rows_ui') ?? 1000),
    timeout_sec: Number(get('timeout_sec') ?? 30),
    rate_limit_per_user: get('rate_limit_per_user') ?? null,
    rate_limit_global:   get('rate_limit_global')   ?? null,
    rate_limit_window:   get('rate_limit_window')   || 'minute',
    allow_dry_run:       Number(get('allow_dry_run') ?? 1),
    endpoint_mode:       get('endpoint_mode') || 'tool',
    proxy_skill_id: get('proxy_skill_id'),
    enabled: Number(get('enabled') ?? 1),
    created_at: get('created_at'),
    updated_at: get('updated_at'),
  };
  return t;
}

// ── POST /api/erp-tools/inspect :抓 metadata 預覽 ────────────────────────────
router.post('/inspect', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { owner, package: packageName, name } = req.body || {};
    const result = await metaSvc.inspectRoutine({
      owner,
      packageName: packageName || null,
      objectName: name,
    });
    // 為前端加上 suggested code / params preview
    const enriched = {
      ...result,
      overloads: result.overloads.map(ov => {
        const { params, returns } = metaSvc.overloadToParams(ov);
        const suggested_code = schemaGen.generateCode({
          packageName: result.package_name,
          objectName: result.object_name,
          overload: ov.overload,
        });
        const metadata_hash = metaSvc.computeMetadataHash(ov);
        return {
          overload: ov.overload,
          routine_type: ov.routine_type,
          has_unsupported: ov.has_unsupported,
          unsupported_list: ov.unsupported_list,
          params,
          returns,
          suggested_code,
          metadata_hash,
        };
      }),
    };
    res.json(enriched);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── GET /api/erp-tools ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const rows = await db.prepare(`
      SELECT t.*, s.is_public AS is_public, s.is_admin_approved AS is_admin_approved
      FROM erp_tools t
      LEFT JOIN skills s ON s.id = t.proxy_skill_id
      ORDER BY t.created_at DESC
    `).all();
    res.json(rows.map(r => {
      const t = serializeTool(r);
      t.is_public = Number(r.is_public ?? r.IS_PUBLIC ?? 1);
      return t;
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/erp-tools/my/list :使用者可手動觸發的 ERP tool 清單 ─────────────
router.get('/my/list', async (req, res) => {
  const db = getDb();
  try {
    // Admin 看全部,否則透過 proxy_skill 的 is_public 或 skill_access 過濾
    const isAdmin = req.user.role === 'admin';
    let rows;
    if (isAdmin) {
      rows = await db.prepare(`
        SELECT * FROM erp_tools
        WHERE enabled = 1 AND allow_manual = 1
        ORDER BY name
      `).all();
    } else {
      rows = await db.prepare(`
        SELECT t.* FROM erp_tools t
        LEFT JOIN skills s ON s.id = t.proxy_skill_id
        LEFT JOIN skill_access sa ON sa.skill_id = s.id
        WHERE t.enabled = 1 AND t.allow_manual = 1
          AND (s.is_public = 1
               OR s.owner_user_id = ?
               OR (sa.grantee_type = 'user'       AND sa.grantee_id = ?)
               OR (sa.grantee_type = 'role'       AND sa.grantee_id = ?)
               OR (sa.grantee_type = 'dept'       AND sa.grantee_id = ?)
               OR (sa.grantee_type = 'factory'    AND sa.grantee_id = ?))
        ORDER BY t.name
      `).all(
        req.user.id,
        String(req.user.id),
        String(req.user.role_id ?? ''),
        String(req.user.dept_code ?? ''),
        String(req.user.factory_code ?? '')
      );
    }
    // 去重(skill_access join 可能產生重複)
    const seen = new Set();
    const unique = [];
    for (const r of rows) {
      const id = r.id || r.ID;
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(serializeTool(r));
    }

    // 合併翻譯:依 ?lang= 或 x-lang header
    const lang = getLangFromReq(req);
    if (lang && lang !== 'zh-TW' && unique.length > 0) {
      const ids = unique.map(t => t.id);
      try {
        const placeholders = ids.map(() => '?').join(',');
        const transRows = await db.prepare(`
          SELECT tool_id, name, description, params_labels_json
          FROM erp_tool_translations
          WHERE lang = ? AND tool_id IN (${placeholders})
        `).all(lang, ...ids);
        const byId = new Map();
        for (const r of (transRows || [])) {
          byId.set(r.tool_id || r.TOOL_ID, {
            name:        r.name || r.NAME,
            description: r.description || r.DESCRIPTION,
            params_labels: parseJson(r.params_labels_json || r.PARAMS_LABELS_JSON, {}),
          });
        }
        for (const t of unique) {
          const tr = byId.get(t.id);
          if (!tr) continue;
          if (tr.name) t.name = tr.name;
          if (tr.description) t.description = tr.description;
          if (tr.params_labels && t.params) {
            t.params = t.params.map(p => {
              const lbl = tr.params_labels[p.name];
              return lbl ? { ...p, display_name: lbl } : p;
            });
          }
        }
      } catch (e) {
        console.warn('[ErpTools] my/list translation merge failed:', e.message);
      }
    }
    res.json(unique);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/erp-tools/pending-approvals(Phase2 站位)───────────────────────
router.get('/pending-approvals', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const rows = await db.prepare(`
      SELECT pa.*, t.code, t.name, t.access_mode
      FROM erp_tool_pending_approval pa
      JOIN erp_tools t ON t.id = pa.tool_id
      WHERE pa.status = 'pending'
      ORDER BY pa.created_at DESC
    `).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/erp-tools/translate-result :翻譯 ERP 結果(Redis cache + glossary) ──
router.post('/translate-result', async (req, res) => {
  try {
    const { text, target_lang } = req.body || {};
    if (!text || !String(text).trim()) return res.json({ translated: '', cached: false });
    const lang = String(target_lang || '').toLowerCase();
    if (lang !== 'en' && lang !== 'vi') {
      return res.json({ translated: text, cached: false, skipped: 'lang_not_supported' });
    }
    const translator = require('../services/erpResultTranslator');
    const out = await translator.translateResult(String(text), lang);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Glossary CRUD(Admin 專用)────────────────────────────────────────────────
router.get('/glossary/list', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const rows = await db.prepare(`SELECT * FROM erp_translation_glossary ORDER BY source_text`).all();
    res.json((rows || []).map(r => ({
      id:          r.id          || r.ID,
      source_text: r.source_text || r.SOURCE_TEXT,
      en_text:     r.en_text     || r.EN_TEXT,
      vi_text:     r.vi_text     || r.VI_TEXT,
      notes:       r.notes       || r.NOTES,
      scope:       r.scope       || r.SCOPE,
      updated_at:  r.updated_at  || r.UPDATED_AT,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/glossary', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const { source_text, en_text, vi_text, notes, scope } = req.body || {};
    if (!source_text) return res.status(400).json({ error: 'source_text 必填' });
    const existing = await db.prepare(`SELECT id FROM erp_translation_glossary WHERE source_text = ?`).get(source_text);
    if (existing) {
      await db.prepare(`
        UPDATE erp_translation_glossary
        SET en_text=?, vi_text=?, notes=?, scope=?, updated_at=SYSTIMESTAMP
        WHERE source_text=?
      `).run(en_text || null, vi_text || null, notes || null, scope || 'global', source_text);
    } else {
      await db.prepare(`
        INSERT INTO erp_translation_glossary (source_text, en_text, vi_text, notes, scope)
        VALUES (?, ?, ?, ?, ?)
      `).run(source_text, en_text || null, vi_text || null, notes || null, scope || 'global');
    }
    require('../services/erpResultTranslator').invalidateGlossaryCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/glossary/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    await db.prepare(`DELETE FROM erp_translation_glossary WHERE id = ?`).run(req.params.id);
    require('../services/erpResultTranslator').invalidateGlossaryCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/erp-tools/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const row = await db.prepare(`SELECT * FROM erp_tools WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ERP tool 不存在' });
    const tool = serializeTool(row);
    const trans = await db.prepare(`SELECT * FROM erp_tool_translations WHERE tool_id = ?`).all(tool.id);
    tool.translations = trans.map(t => ({
      lang: t.lang || t.LANG,
      name: t.name || t.NAME,
      description: t.description || t.DESCRIPTION,
      params_labels: parseJson(t.params_labels_json || t.PARAMS_LABELS_JSON, {}),
    }));
    res.json(tool);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/erp-tools ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const b = req.body || {};
    if (!b.db_owner || !b.object_name || !b.routine_type) {
      return res.status(400).json({ error: 'db_owner / object_name / routine_type 必填' });
    }
    if (!metaSvc.isSchemaAllowed(b.db_owner)) {
      return res.status(403).json({ error: `Owner "${b.db_owner}" 不在白名單(ERP_ALLOWED_SCHEMAS)` });
    }
    const code = (b.code && b.code.trim()) || schemaGen.generateCode({
      packageName: b.package_name,
      objectName: b.object_name,
      overload: b.overload,
    });
    const params = normalizeParamsLlmMode(Array.isArray(b.params) ? b.params : []);
    const returns = b.returns || null;
    const toolSchema = b.tool_schema || schemaGen.generateToolSchema({
      code, name: b.name, description: b.description,
      access_mode: b.access_mode, params,
    });

    // Inject 參數校驗:allow_inject=1 時所有參數必須有 inject_value 或 inject_source
    if (Number(b.allow_inject) === 1) {
      const bad = params.filter(p => {
        const io = (p.in_out || 'IN').toUpperCase();
        if (io !== 'IN' && io !== 'IN/OUT' && io !== 'INOUT' && io !== 'IN OUT') return false;
        return (p.inject_source == null || p.inject_source === '')
            && (p.inject_value == null || p.inject_value === '');
      });
      if (bad.length > 0) {
        return res.status(400).json({
          error: `Inject 模式參數必須設固定值或系統值: ${bad.map(p => p.name).join(', ')}`,
        });
      }
    }

    const ins = await db.prepare(`
      INSERT INTO erp_tools
        (code, name, description, tags,
         db_owner, package_name, object_name, overload, routine_type,
         metadata_json, metadata_hash, metadata_checked_at, metadata_drifted,
         access_mode, requires_approval, allow_llm_auto, allow_inject, allow_manual,
         params_json, returns_json, tool_schema_json, inject_config_json,
         max_rows_llm, max_rows_ui, timeout_sec,
         rate_limit_per_user, rate_limit_global, rate_limit_window, allow_dry_run,
         endpoint_mode, answer_output_format_json, enabled, created_by)
      VALUES (?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, SYSTIMESTAMP, 0,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?)
    `).run(
      code, b.name || code, b.description || null, JSON.stringify(b.tags || []),
      String(b.db_owner).toUpperCase(),
      b.package_name ? String(b.package_name).toUpperCase() : null,
      String(b.object_name).toUpperCase(),
      b.overload || null, b.routine_type,
      JSON.stringify(b.metadata_snapshot || null), b.metadata_hash || null,
      b.access_mode || 'READ_ONLY',
      b.requires_approval ? 1 : 0,
      b.access_mode === 'WRITE' ? (b.allow_llm_auto ? 1 : 0) : (b.allow_llm_auto !== false ? 1 : 0),
      b.allow_inject ? 1 : 0,
      b.allow_manual !== false ? 1 : 0,
      JSON.stringify(params), JSON.stringify(returns),
      JSON.stringify(toolSchema), JSON.stringify(b.inject_config || null),
      Number(b.max_rows_llm) || 50,
      Number(b.max_rows_ui) || 1000,
      Number(b.timeout_sec) || 30,
      b.rate_limit_per_user == null ? null : Number(b.rate_limit_per_user),
      b.rate_limit_global   == null ? null : Number(b.rate_limit_global),
      b.rate_limit_window   || 'minute',
      b.allow_dry_run === 0 ? 0 : 1,
      b.endpoint_mode || 'tool',
      b.answer_output_format ? JSON.stringify(b.answer_output_format) : null,
      b.enabled === false ? 0 : 1,
      req.user.id
    );

    const toolId = ins.lastInsertRowid;
    // 同步代理 skill row
    try {
      await proxySkill.createProxySkill(db, {
        id: toolId,
        name: b.name || code,
        description: b.description || null,
        tool_schema: toolSchema,
        tags: b.tags || [],
      }, req.user.id);
    } catch (e) {
      console.warn('[ErpTools] proxy skill create failed:', e.message);
    }
    res.status(201).json({ id: toolId, code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/erp-tools/:id ───────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const row = await db.prepare(`SELECT * FROM erp_tools WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ERP tool 不存在' });
    const cur = serializeTool(row);
    const b = req.body || {};

    const params = normalizeParamsLlmMode(Array.isArray(b.params) ? b.params : cur.params);
    const returns = b.returns !== undefined ? b.returns : cur.returns;
    const code = (b.code && b.code.trim()) || cur.code;
    const toolSchema = b.tool_schema || schemaGen.generateToolSchema({
      code, name: b.name ?? cur.name, description: b.description ?? cur.description,
      access_mode: b.access_mode ?? cur.access_mode, params,
    });

    if ((b.allow_inject !== undefined ? b.allow_inject : cur.allow_inject)) {
      const bad = params.filter(p => {
        const io = (p.in_out || 'IN').toUpperCase();
        if (io !== 'IN' && io !== 'IN/OUT' && io !== 'INOUT' && io !== 'IN OUT') return false;
        return (p.inject_source == null || p.inject_source === '')
            && (p.inject_value == null || p.inject_value === '');
      });
      if (bad.length > 0) {
        return res.status(400).json({
          error: `Inject 模式參數必須設固定值或系統值: ${bad.map(p => p.name).join(', ')}`,
        });
      }
    }

    await db.prepare(`
      UPDATE erp_tools SET
        code = ?, name = ?, description = ?, tags = ?,
        access_mode = ?, requires_approval = ?,
        allow_llm_auto = ?, allow_inject = ?, allow_manual = ?,
        params_json = ?, returns_json = ?,
        tool_schema_json = ?, inject_config_json = ?,
        max_rows_llm = ?, max_rows_ui = ?, timeout_sec = ?,
        rate_limit_per_user = ?, rate_limit_global = ?, rate_limit_window = ?, allow_dry_run = ?,
        endpoint_mode = ?, answer_output_format_json = ?, enabled = ?, updated_at = SYSTIMESTAMP
      WHERE id = ?
    `).run(
      code, b.name ?? cur.name, b.description ?? cur.description,
      JSON.stringify(b.tags ?? cur.tags),
      b.access_mode ?? cur.access_mode,
      (b.requires_approval ?? cur.requires_approval) ? 1 : 0,
      (b.allow_llm_auto ?? cur.allow_llm_auto) ? 1 : 0,
      (b.allow_inject ?? cur.allow_inject) ? 1 : 0,
      (b.allow_manual ?? cur.allow_manual) ? 1 : 0,
      JSON.stringify(params), JSON.stringify(returns),
      JSON.stringify(toolSchema),
      JSON.stringify(b.inject_config ?? cur.inject_config),
      Number(b.max_rows_llm ?? cur.max_rows_llm),
      Number(b.max_rows_ui ?? cur.max_rows_ui),
      Number(b.timeout_sec ?? cur.timeout_sec),
      b.rate_limit_per_user === undefined ? cur.rate_limit_per_user
        : (b.rate_limit_per_user == null ? null : Number(b.rate_limit_per_user)),
      b.rate_limit_global === undefined ? cur.rate_limit_global
        : (b.rate_limit_global == null ? null : Number(b.rate_limit_global)),
      b.rate_limit_window ?? cur.rate_limit_window ?? 'minute',
      (b.allow_dry_run ?? cur.allow_dry_run ?? 1) ? 1 : 0,
      b.endpoint_mode ?? cur.endpoint_mode ?? 'tool',
      (b.answer_output_format !== undefined
        ? (b.answer_output_format ? JSON.stringify(b.answer_output_format) : null)
        : (cur.answer_output_format ? JSON.stringify(cur.answer_output_format) : null)),
      (b.enabled ?? cur.enabled) ? 1 : 0,
      req.params.id
    );
    // 同步更新代理 skill
    try {
      await proxySkill.updateProxySkill(db, {
        id: Number(req.params.id),
        name: b.name ?? cur.name,
        description: b.description ?? cur.description,
        tool_schema: toolSchema,
        tags: b.tags ?? cur.tags,
        proxy_skill_id: cur.proxy_skill_id,
        created_by: req.user.id,
        endpoint_mode: b.endpoint_mode ?? cur.endpoint_mode ?? 'tool',
      });
    } catch (e) {
      console.warn('[ErpTools] proxy skill update failed:', e.message);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/erp-tools/:id ────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    await proxySkill.deleteProxySkill(db, req.params.id);
    await db.prepare(`DELETE FROM erp_tools WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/erp-tools/:id/refresh-metadata ─────────────────────────────────
// Body: { apply?: boolean } — apply=true 時智慧合併並寫回 params_json;否則只回 diff
router.post('/:id/refresh-metadata', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const row = await db.prepare(`SELECT * FROM erp_tools WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ERP tool 不存在' });
    const cur = serializeTool(row);
    const latest = await metaSvc.inspectRoutine({
      owner: cur.db_owner,
      packageName: cur.package_name,
      objectName: cur.object_name,
    });
    const ov = latest.overloads.find(o => (o.overload || null) === (cur.overload || null));
    if (!ov) return res.status(404).json({ error: '找不到對應 overload' });
    const newHash = metaSvc.computeMetadataHash(ov);
    const drifted = newHash !== cur.metadata_hash;
    const { params: latestParams, returns: latestReturns } = metaSvc.overloadToParams(ov);

    // ── Diff 計算 ────────────────────────────────────────────────────────
    const oldByName = new Map((cur.params || []).map(p => [p.name, p]));
    const newByName = new Map(latestParams.map(p => [p.name, p]));
    const added = [];
    const removed = [];
    const changed = [];
    for (const np of latestParams) {
      const op = oldByName.get(np.name);
      if (!op) { added.push(np); continue; }
      const diffs = [];
      if (op.in_out !== np.in_out) diffs.push(`in_out: ${op.in_out} → ${np.in_out}`);
      if (op.data_type !== np.data_type) diffs.push(`data_type: ${op.data_type} → ${np.data_type}`);
      if ((op.data_length || null) !== (np.data_length || null)) diffs.push(`data_length: ${op.data_length} → ${np.data_length}`);
      if ((op.data_precision || null) !== (np.data_precision || null)) diffs.push(`precision: ${op.data_precision} → ${np.data_precision}`);
      if ((op.data_scale || null) !== (np.data_scale || null)) diffs.push(`scale: ${op.data_scale} → ${np.data_scale}`);
      if (!!op.required !== !!np.required) diffs.push(`required: ${op.required} → ${np.required}`);
      if ((op.position || null) !== (np.position || null)) diffs.push(`position: ${op.position} → ${np.position}`);
      if (diffs.length > 0) changed.push({ name: np.name, diffs });
    }
    for (const op of (cur.params || [])) {
      if (!newByName.has(op.name)) removed.push(op);
    }

    let applied = false;
    let mergedParams = null;
    if (req.body?.apply === true) {
      // ── 智慧合併:保留 user-config,更新 metadata 欄位 ──────────────────
      mergedParams = latestParams.map(np => {
        const op = oldByName.get(np.name);
        if (!op) return np;  // 新參數,用 fresh defaults
        // 保留 user 設定的欄位
        const preserved = {
          display_name:  op.display_name ?? null,
          ai_hint:       op.ai_hint ?? '',
          lov_config:    op.lov_config ?? null,
          default_value: op.default_value ?? null,
          default_config: op.default_config ?? undefined,
          inject_value:  op.inject_value ?? null,
          inject_source: op.inject_source ?? null,
        };
        if (op.visible !== undefined)   preserved.visible  = op.visible;
        if (op.editable !== undefined)  preserved.editable = op.editable;
        // 把 undefined 去掉(避免序列化出多餘 key)
        Object.keys(preserved).forEach(k => preserved[k] === undefined && delete preserved[k]);
        return { ...np, ...preserved };
      });

      // 重新生成 tool_schema
      const newSchema = schemaGen.generateToolSchema({
        code: cur.code,
        name: cur.name,
        description: cur.description,
        access_mode: cur.access_mode,
        params: mergedParams,
      });

      await db.prepare(`
        UPDATE erp_tools SET
          params_json      = ?,
          returns_json     = ?,
          tool_schema_json = ?,
          metadata_hash    = ?,
          metadata_checked_at = SYSTIMESTAMP,
          metadata_drifted = 0,
          updated_at       = SYSTIMESTAMP
        WHERE id = ?
      `).run(
        JSON.stringify(mergedParams),
        JSON.stringify(latestReturns),
        JSON.stringify(newSchema),
        newHash,
        req.params.id,
      );

      // 同步代理 skill 的 tool_schema
      try {
        if (cur.proxy_skill_id) {
          await db.prepare(`UPDATE skills SET tool_schema = ? WHERE id = ?`)
            .run(JSON.stringify(newSchema), cur.proxy_skill_id);
        }
      } catch (e) {
        console.warn('[ErpTools] proxy skill schema sync failed:', e.message);
      }
      applied = true;
    } else {
      // dry-run 只更新 hash/checked_at
      await db.prepare(`
        UPDATE erp_tools SET metadata_hash = ?, metadata_checked_at = SYSTIMESTAMP,
                             metadata_drifted = ?
        WHERE id = ?
      `).run(newHash, drifted ? 1 : 0, req.params.id);
    }

    res.json({
      drifted,
      applied,
      old_hash: cur.metadata_hash,
      new_hash: newHash,
      latest_params: latestParams,
      latest_returns: latestReturns,
      current_params: cur.params,
      current_returns: cur.returns,
      merged_params: mergedParams,  // apply=true 時才有
      diff: {
        added:   added.map(p => ({ name: p.name, in_out: p.in_out, data_type: p.data_type })),
        removed: removed.map(p => ({ name: p.name, in_out: p.in_out, data_type: p.data_type })),
        changed,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/erp-tools/:id/translate :LLM 批次翻譯 name/desc/params_labels ──
router.post('/:id/translate', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const row = await db.prepare(`SELECT * FROM erp_tools WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ERP tool 不存在' });
    const tool = serializeTool(row);

    const { translateText } = require('../services/translationService');

    // 翻譯 name / description
    const nameT = tool.name ? await translateText(tool.name) : { zh: '', en: '', vi: '' };
    const descT = tool.description ? await translateText(tool.description) : { zh: '', en: '', vi: '' };

    // 翻譯每個 param 的 label(來源優先順序:display_name > ai_hint > name)
    const labels = {};
    for (const p of (tool.params || [])) {
      const source = (p.display_name?.trim()) || (p.ai_hint?.trim()) || p.name;
      if (!source) continue;
      try {
        labels[p.name] = await translateText(source);
      } catch (e) {
        console.warn(`[ErpTranslate] param ${p.name} failed:`, e.message);
        labels[p.name] = { zh: source, en: source, vi: source };
      }
    }

    const langs = ['zh-TW', 'en', 'vi'];
    const transOut = {};
    for (const lang of langs) {
      const suffix = lang === 'zh-TW' ? 'zh' : lang;
      const paramLabels = {};
      for (const [pname, t] of Object.entries(labels)) {
        paramLabels[pname] = t[suffix] || null;
      }
      const payload = {
        name: nameT[suffix] || null,
        description: descT[suffix] || null,
        params_labels: paramLabels,
      };
      transOut[lang] = payload;
      // UPSERT
      const existing = await db.prepare(`SELECT id FROM erp_tool_translations WHERE tool_id=? AND lang=?`).get(tool.id, lang);
      if (existing) {
        await db.prepare(`
          UPDATE erp_tool_translations
          SET name=?, description=?, params_labels_json=?, updated_at=SYSTIMESTAMP
          WHERE tool_id=? AND lang=?
        `).run(payload.name, payload.description, JSON.stringify(paramLabels), tool.id, lang);
      } else {
        await db.prepare(`
          INSERT INTO erp_tool_translations (tool_id, lang, name, description, params_labels_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(tool.id, lang, payload.name, payload.description, JSON.stringify(paramLabels));
      }
    }

    res.json({ ok: true, translations: transOut });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/erp-tools/:id/lov/:paramName ───────────────────────────────────
router.post('/:id/lov/:paramName', async (req, res) => {
  const db = getDb();
  try {
    const row = await db.prepare(`SELECT params_json FROM erp_tools WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ERP tool 不存在' });
    const params = parseJson(row.params_json || row.PARAMS_JSON, []);
    const p = params.find(x => x.name === req.params.paramName);
    if (!p) return res.status(404).json({ error: '找不到該參數' });
    if (!p.lov_config) return res.json({ items: [], type: 'none' });
    const result = await lovResolver.resolveLov(p.lov_config, req.user, {
      search: req.body?.search || req.query?.search,
      exact_value: req.body?.exact_value || req.query?.exact_value,
      limit: Number(req.body?.limit || req.query?.limit) || undefined,
      paramInputs: (req.body && typeof req.body.paramInputs === 'object') ? req.body.paramInputs : {},
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});


// ── POST /api/erp-tools/:id/execute ──────────────────────────────────────────
router.post('/:id/execute', async (req, res) => {
  const db = getDb();
  try {
    const toolId = Number(req.params.id);
    const { inputs, trigger_source, session_id, confirmation_token, include_full, dry_run } = req.body || {};
    const result = await executor.execute(db, toolId, inputs || {}, req.user, {
      trigger_source: trigger_source || 'manual_form',
      session_id: session_id || null,
      confirmation_token: confirmation_token || null,
      include_full: include_full === true,
      dry_run: dry_run === true,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({
      error: e.message,
      code: e.orig?.code,
      duration_ms: e.durationMs,
      audit_log_id: e.auditLogId,
    });
  }
});

// ── GET /api/erp-tools/audit-log :全域 audit log(join tool/user) ────────────
router.get('/audit-log/all', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const toolId = req.query.tool_id ? Number(req.query.tool_id) : null;
    const where = toolId ? `WHERE al.tool_id = ${toolId}` : '';
    const rows = await db.prepare(`
      SELECT al.*, t.code AS tool_code, t.name AS tool_name, t.access_mode AS tool_access_mode,
             u.username AS user_name, u.name AS user_display_name
      FROM erp_tool_audit_log al
      LEFT JOIN erp_tools t ON t.id = al.tool_id
      LEFT JOIN users u     ON u.id = al.user_id
      ${where}
      ORDER BY al.created_at DESC
      FETCH FIRST ${limit} ROWS ONLY
    `).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/erp-tools/:id/audit-log ─────────────────────────────────────────
router.get('/:id/audit-log', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await db.prepare(`
      SELECT * FROM erp_tool_audit_log
      WHERE tool_id = ?
      ORDER BY created_at DESC
      FETCH FIRST ${limit} ROWS ONLY
    `).all(req.params.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/erp-tools/results/:cacheKey ─────────────────────────────────────
router.get('/results/:cacheKey', async (req, res) => {
  try {
    const cacheKey = req.params.cacheKey.startsWith('erp:result:')
      ? req.params.cacheKey
      : 'erp:result:' + req.params.cacheKey;
    const full = await resultCache.loadResult(cacheKey);
    if (!full) return res.status(404).json({ error: '結果已過期或不存在' });
    res.json(full);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/erp-tools/:id/schema-debug :檢查當前 tool_schema 與 proxy skill schema ──
router.get('/:id/schema-debug', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const row = await db.prepare(`SELECT tool_schema_json, params_json, proxy_skill_id FROM erp_tools WHERE id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const pid = row.proxy_skill_id || row.PROXY_SKILL_ID;
    let proxySchema = null;
    if (pid) {
      const sk = await db.prepare(`SELECT tool_schema, endpoint_mode FROM skills WHERE id=?`).get(pid);
      proxySchema = { tool_schema: parseJson(sk?.tool_schema || sk?.TOOL_SCHEMA, null), endpoint_mode: sk?.endpoint_mode || sk?.ENDPOINT_MODE };
    }
    res.json({
      erp_tool_schema: parseJson(row.tool_schema_json || row.TOOL_SCHEMA_JSON, null),
      erp_params: parseJson(row.params_json || row.PARAMS_JSON, []),
      proxy_skill_id: pid,
      proxy: proxySchema,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/erp-tools/config/check ──────────────────────────────────────────
router.get('/config/check', async (req, res) => {
  res.json({
    erp_configured: erpDb.isConfigured(),
    allowed_schemas: (process.env.ERP_ALLOWED_SCHEMAS || '').split(',').filter(Boolean),
    lov_max_rows: parseInt(process.env.ERP_TOOL_LOV_MAX_ROWS || '500', 10),
    result_cache_ttl: parseInt(process.env.ERP_TOOL_RESULT_CACHE_TTL || '1800', 10),
  });
});

// ── PUT /api/erp-tools/:id/toggle — 快速啟用/停用/公開 ────────────────────────
router.put('/:id/toggle', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const { field, value } = req.body;
    const allowed = ['enabled', 'is_public'];
    if (!allowed.includes(field)) return res.status(400).json({ error: '不允許的欄位' });

    if (field === 'is_public') {
      // 公開/非公開存在代理 skill row
      const row = await db.prepare(`SELECT proxy_skill_id FROM erp_tools WHERE id = ?`).get(req.params.id);
      const pid = row?.proxy_skill_id ?? row?.PROXY_SKILL_ID;
      if (pid) {
        await db.prepare(`UPDATE skills SET is_public = ?, is_admin_approved = ? WHERE id = ?`)
          .run(value ? 1 : 0, value ? 1 : 0, pid);
      }
    } else {
      await db.prepare(`UPDATE erp_tools SET ${field} = ?, updated_at = SYSTIMESTAMP WHERE id = ?`)
        .run(value ? 1 : 0, req.params.id);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET/POST/DELETE /api/erp-tools/:id/access — 分享(proxy 到 skill_access) ──
router.get('/:id/access', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const row = await db.prepare(`SELECT proxy_skill_id FROM erp_tools WHERE id = ?`).get(req.params.id);
    const pid = row?.proxy_skill_id ?? row?.PROXY_SKILL_ID;
    if (!pid) return res.json([]);
    const shares = await db.prepare(`
      SELECT a.*, u.name AS granted_by_name
      FROM skill_access a
      LEFT JOIN users u ON u.id = a.granted_by
      WHERE a.skill_id = ?
      ORDER BY a.granted_at DESC
    `).all(pid);
    await resolveGranteeNamesInRows(shares, getLangFromReq(req), db);
    res.json(shares);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/access', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const row = await db.prepare(`SELECT proxy_skill_id FROM erp_tools WHERE id = ?`).get(req.params.id);
    const pid = row?.proxy_skill_id ?? row?.PROXY_SKILL_ID;
    if (!pid) return res.status(404).json({ error: '代理 skill 不存在，請重新儲存此 ERP 工具' });
    const { grantee_type, grantee_id, share_type } = req.body;
    const id = require('crypto').randomUUID();
    await db.prepare(`
      INSERT INTO skill_access (id, skill_id, grantee_type, grantee_id, granted_by, share_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, pid, grantee_type, String(grantee_id), req.user.id, share_type || 'use');
    res.status(201).json({ id });
  } catch (e) {
    if (e.message?.includes('SKILL_ACCESS_UQ')) return res.status(409).json({ error: '已存在相同授權' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/access/:accessId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    await db.prepare(`DELETE FROM skill_access WHERE id = ?`).run(req.params.accessId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
