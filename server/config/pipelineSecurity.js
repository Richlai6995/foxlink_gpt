'use strict';

/**
 * Pipeline DB Write — 安全常數
 *
 * 兩層白名單策略:
 *   - 第一層(本檔) — 硬編黑名單。admin 即使把表加進 DB 白名單也會被這層擋下。
 *     防手抖 + 防白名單資料毀損(有人改 DB 繞過 UI 驗證)。
 *   - 第二層(DB `pipeline_writable_tables`)— admin UI 逐筆核准。
 *
 * 另外規範了 allowed transform / allowed operation enum,避免 JSON 配置寫出不支援的值。
 */

// 絕對禁止被 pipeline 寫入的系統核心表。**不要隨便加/移**。
const FORBIDDEN_TABLES = new Set([
  // 認證 / 使用者
  'users', 'user_sessions', 'user_roles',
  // 聊天 / 會話 / token
  'chat_sessions', 'chat_messages', 'token_usage', 'sensitive_keywords',
  // 稽核 / 系統設定
  'audit_logs', 'system_settings',
  // 排程本身
  'scheduled_tasks', 'scheduled_task_runs',
  // 技能 / MCP / KB 核心
  'skills', 'skill_access', 'skill_call_logs', 'skill_prompt_versions', 'skill_workflows',
  'mcp_servers', 'mcp_call_logs', 'mcp_audit_logs',
  'knowledge_bases', 'kb_chunks', 'kb_thesauri', 'kb_thesaurus_synonyms',
  'dify_knowledge_bases',
  // AI 戰情 metadata(本身就是白名單/schema 管理表,不能被 pipeline 碰)
  'ai_db_sources', 'ai_schema_definitions', 'ai_etl_jobs', 'ai_etl_run_logs',
  'ai_vector_store', 'ai_policy_categories', 'ai_data_policies',
  'ai_user_cat_policies', 'ai_role_cat_policies',
  // Pipeline 白名單自己
  'pipeline_writable_tables',
  // ERP 整合
  'erp_tools',
  // 其他 meta
  'roles', 'data_permissions', 'api_keys', 'user_charts', 'chart_style_templates',
  'help_sections', 'help_translations',
  'doc_templates',
  'webex_auth_logs',
  'factory_translations',
  'feedback_tickets',
]);

// 支援的 operation(UI 下拉 + DB allowed_operations 驗證)
const OPERATIONS = Object.freeze([
  'insert',           // 純 INSERT,UNIQUE 衝突 skip
  'upsert',           // MERGE by unique_key
  'replace_by_date',  // DELETE WHERE date_col=X 再 INSERT
  'append',           // 不管 UNIQUE,純 append
]);

const crypto = require('crypto');

// 支援的 transform(應用在單筆 row value 寫入前)
const TRANSFORMS = Object.freeze({
  upper:        (v) => (v == null ? v : String(v).toUpperCase()),
  lower:        (v) => (v == null ? v : String(v).toLowerCase()),
  trim:         (v) => (v == null ? v : String(v).trim()),
  number:       (v) => {
    if (v == null || v === '' || v === '—') return null;
    const s = String(v).replace(/,/g, '').replace(/%/g, '').trim();
    const n = Number(s);
    return isFinite(n) ? n : null;
  },
  date:         (v) => {
    if (v == null || v === '') return null;
    // 接受 YYYY-MM-DD / YYYY/MM/DD / ISO string,回傳 YYYY-MM-DD 字串(交給 SQL 端 TO_DATE)
    const s = String(v).trim().replace(/\//g, '-');
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  },
  strip_comma:  (v) => (v == null ? v : String(v).replace(/,/g, '')),
  null_if_dash: (v) => (v === '—' || v === '-' || v === '' || v == null ? null : v),
  sha256:       (v) => {
    // URL hash 之類用途。null/空 → null;非字串 → JSON 序列化後 hash。
    if (v == null || v === '') return null;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    // 順手做 URL 正規化(剝 utm/fbclid/gclid、砍 fragment/末尾斜線),才會跟
    // pipelineKbWriter 的 dedupe 算出一致的 hash。
    let normalized = s.trim().toLowerCase();
    try {
      const u = new URL(s.trim());
      const drop = [];
      for (const k of u.searchParams.keys()) {
        if (/^(utm_|fbclid|gclid|mc_|ref_|spm)/i.test(k)) drop.push(k);
      }
      drop.forEach(k => u.searchParams.delete(k));
      u.hash = '';
      let out = u.toString();
      if (out.endsWith('/')) out = out.slice(0, -1);
      normalized = out.toLowerCase();
    } catch (_) { /* 不是合法 URL,fallback to lowercase */ }
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  },
  json_stringify: (v) => {
    // 對於 array / object 欄位想存進 VARCHAR,例 related_metals=["CU","AL"] → "[\"CU\",\"AL\"]"
    if (v == null) return null;
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  },
  array_join_comma: (v) => {
    // 對於 array 想存成 CSV 字串:["CU","AL"] → "CU,AL"
    if (v == null) return null;
    if (Array.isArray(v)) return v.join(',');
    return String(v);
  },
});

// 欄位名 / table 名的語法驗證 — 純 A-Z0-9_ 起首非數字,長度 1~128。
// 阻止 SQL injection 從 config 注入。
const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function isValidIdentifier(s) {
  return typeof s === 'string' && IDENTIFIER_REGEX.test(s);
}

function isForbidden(tableName) {
  return FORBIDDEN_TABLES.has(String(tableName || '').toLowerCase());
}

module.exports = {
  FORBIDDEN_TABLES,
  OPERATIONS,
  TRANSFORMS,
  IDENTIFIER_REGEX,
  isValidIdentifier,
  isForbidden,
};
