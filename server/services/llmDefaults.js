/**
 * LLM Default Model Resolver
 * Reads system_settings for default embedding / rerank / ocr model keys,
 * resolves them to actual api_model strings from llm_models table,
 * and falls back to env vars if not configured.
 */

const ENV_FALLBACK = {
  embedding: () => process.env.KB_EMBEDDING_MODEL || 'gemini-embedding-001',
  rerank:    () => process.env.KB_RERANK_MODEL    || 'gemini-2.0-flash',
  ocr:       () => process.env.KB_OCR_MODEL       || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
  chat:      () => process.env.GEMINI_MODEL_PRO   || 'gemini-2.5-pro',
  research:  () => process.env.GEMINI_MODEL_PRO   || 'gemini-2.5-pro',
};

const SETTING_KEY = {
  embedding: 'default_embedding_model_key',
  rerank:    'default_rerank_model_key',
  ocr:       'default_ocr_model_key',
  chat:      'default_chat_model_key',
  research:  'research_model_key',
};

/**
 * 取深度研究專用 config:model + reasoning_effort.
 * 預設 reasoning_effort='high' — 深度研究本就需高精度思考;
 * admin 可透過 /api/admin/settings/research 調整.
 * @param {object} db
 * @returns {Promise<{ apiModel: string, reasoningEffort: string }>}
 */
async function resolveResearchConfig(db) {
  const apiModel = await resolveDefaultModel(db, 'research');
  let reasoningEffort = 'high';
  try {
    const row = await db.prepare(
      `SELECT value FROM system_settings WHERE key='research_reasoning_effort'`
    ).get();
    if (row?.value) reasoningEffort = row.value;
  } catch {}
  return { apiModel, reasoningEffort };
}

/**
 * Resolve a default model's api_model string.
 * @param {object} db
 * @param {'embedding'|'rerank'|'ocr'} role
 * @returns {Promise<string>} api_model string (e.g. 'gemini-embedding-001')
 */
async function resolveDefaultModel(db, role) {
  try {
    const skey = SETTING_KEY[role];
    if (!skey) return ENV_FALLBACK[role]?.() || '';

    const setting = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get(skey);
    if (setting?.value) {
      const model = await db.prepare(
        `SELECT api_model FROM llm_models WHERE key=? AND is_active=1`
      ).get(setting.value);
      if (model?.api_model) return model.api_model;
    }
  } catch {}
  return ENV_FALLBACK[role]?.() || '';
}

/**
 * Resolve a default model's full llm_models row (for provider-aware calls).
 * @param {object} db
 * @param {'embedding'|'rerank'|'ocr'} role
 * @returns {Promise<object|null>} llm_models row or null
 */
async function resolveDefaultModelRow(db, role) {
  try {
    const skey = SETTING_KEY[role];
    if (skey) {
      const setting = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get(skey);
      if (setting?.value) {
        const row = await db.prepare(
          `SELECT * FROM llm_models WHERE key=? AND is_active=1`
        ).get(setting.value);
        if (row) return row;
      }
    }
    // Fallback: first active model matching role
    const roleMap = { embedding: 'embedding', rerank: 'rerank', ocr: 'chat' };
    const fallbackRole = roleMap[role] || 'chat';
    return await db.prepare(
      `SELECT * FROM llm_models WHERE model_role=? AND is_active=1 ORDER BY sort_order ASC`
    ).get(fallbackRole) || null;
  } catch { return null; }
}

/**
 * Task / skill / pipeline 共用的 model resolver。
 *
 * 設計目標:解決「task.model='pro'(alias)但 llm_models 表沒有 key='pro' entry」這類
 * 配置錯誤導致 LLM 收到字面 'pro' 名稱去 Vertex 查 → 404 的崩潰。
 *
 * 邏輯:
 *   1. modelKey 空 → 走 resolveDefaultModel(db, role)(env / system_settings 回退)
 *   2. lookup llm_models WHERE key=modelKey,有對到 → 回 api_model
 *   3. lookup miss:
 *      a. modelKey 看起來像真 api name(含 '-' 且 ≥10 字元)→ 直接回(可能是 user 直接寫 api 名)
 *      b. 否則(短 alias 但表沒對到)→ warn + 回 resolveDefaultModel
 *
 * @param {object} db
 * @param {string|null} modelKey  task.model / node.model / skill.model_key
 * @param {string} role  'chat'(預設)/ 'research' / ...,給 fallback 用
 * @returns {Promise<string>} api_model 字串(永不為空,失敗時拿 env fallback)
 */
async function resolveTaskModel(db, modelKey, role = 'chat') {
  if (!modelKey || !String(modelKey).trim()) {
    return await resolveDefaultModel(db, role);
  }
  const k = String(modelKey).trim();
  try {
    const row = await db.prepare(
      `SELECT api_model FROM llm_models WHERE key=? AND is_active=1`
    ).get(k);
    if (row?.api_model) return row.api_model;
  } catch (_) { /* fall through */ }
  // lookup miss
  if (k.includes('-') && k.length >= 10) {
    // 看起來像 api name(gemini-3-flash-preview / gpt-5o-2025-04-25 等)→ 直接用
    return k;
  }
  // alias-like(pro / flash / chat)但表沒對到 → fallback
  console.warn(`[llmDefaults] modelKey "${k}" 在 llm_models 表無 active entry,且不像 API 名,fallback 到 default ${role} model`);
  return await resolveDefaultModel(db, role);
}

module.exports = { resolveDefaultModel, resolveDefaultModelRow, resolveResearchConfig, resolveTaskModel, SETTING_KEY, ENV_FALLBACK };
