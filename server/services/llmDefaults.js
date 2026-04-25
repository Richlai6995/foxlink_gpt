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
  // Phase 4 PM 平台專用 — admin 在「PM 平台設定」UI 設好後,seed task / pickModelKey 都會用
  pm_pro:    'pm_pro_model_key',
  pm_flash:  'pm_flash_model_key',
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

/**
 * 給 seed task / 自動產生流程用:依 hint(pro / flash / embedding 等)從 llm_models 表
 * 挑一個「最有可能對應該角色」的 active key,讓 seed 寫進 task.model 後 resolveTaskModel
 * lookup 得到。
 *
 * 解決的 bug:dev 環境 seed 寫 task.model='pro',prod 環境的 llm_models key 是
 * 'Gemini 3 Pro' / 'Gemini 3 Flash' → lookup miss → 跑去 fallback 或崩潰。
 *
 * 優先序:
 *   1. PM 平台專用 setting (pm_pro_model_key / pm_flash_model_key) — admin 透過 PMSettingsPanel 設
 *   2. (僅 'pro' hint) system_settings.default_chat_model_key
 *   3. llm_models WHERE LOWER(key/name/api_model) LIKE '%hint%' AND is_active=1 ORDER BY sort_order ASC
 *   4. (僅 'flash' hint) 找不到 flash 退回 'pro' 邏輯(別什麼都沒)
 *   5. 空字串(讓 caller 走 resolveDefaultModel)
 *
 * @param {object} db
 * @param {'pro'|'flash'|'embedding'|string} hint
 * @returns {Promise<string>} llm_models.key 或 ''
 */
async function pickModelKey(db, hint) {
  const h = String(hint || '').toLowerCase().trim();
  if (!h) return '';

  // 1. PM 平台專用 setting(pm_pro / pm_flash)— admin 在「PM 平台設定」UI 設的
  const pmSettingKey = h === 'pro' ? SETTING_KEY.pm_pro
                      : h === 'flash' ? SETTING_KEY.pm_flash
                      : null;
  if (pmSettingKey) {
    try {
      const setting = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get(pmSettingKey);
      if (setting?.value) {
        const m = await db.prepare(`SELECT key FROM llm_models WHERE key=? AND is_active=1`).get(setting.value);
        if (m?.key) return m.key;
      }
    } catch (_) {}
  }

  // 2. system_settings.default_chat_model_key(僅 pro hint,給沒設 PM 專用的 fallback)
  if (h === 'pro') {
    try {
      const setting = await db.prepare(`SELECT value FROM system_settings WHERE key='default_chat_model_key'`).get();
      if (setting?.value) {
        const m = await db.prepare(`SELECT key FROM llm_models WHERE key=? AND is_active=1`).get(setting.value);
        if (m?.key) return m.key;
      }
    } catch (_) {}
  }

  // 3. fuzzy match by key/name/api_model contains hint
  try {
    const like = `%${h}%`;
    const rows = await db.prepare(
      `SELECT key FROM llm_models
       WHERE is_active=1
         AND (LOWER(key) LIKE ? OR LOWER(name) LIKE ? OR LOWER(api_model) LIKE ?)
       ORDER BY sort_order ASC, id ASC`
    ).all(like, like, like);
    if (rows && rows.length) {
      // 排除 image/tts/stt/embed/rerank 系列(它們名字也常含 'flash' / 'pro')
      const excludeRe = /(image|tts|stt|speech|rerank|embed)/i;
      const filtered = rows.filter(r => !excludeRe.test(r.key));
      const pick = filtered.length ? filtered[0].key : rows[0].key;
      return pick;
    }
  } catch (_) {}

  // 4. flash 找不到 → 退回 pro
  if (h === 'flash') {
    return await pickModelKey(db, 'pro');
  }

  return '';
}

module.exports = { resolveDefaultModel, resolveDefaultModelRow, resolveResearchConfig, resolveTaskModel, pickModelKey, SETTING_KEY, ENV_FALLBACK };
