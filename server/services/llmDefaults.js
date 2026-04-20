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
};

const SETTING_KEY = {
  embedding: 'default_embedding_model_key',
  rerank:    'default_rerank_model_key',
  ocr:       'default_ocr_model_key',
  chat:      'default_chat_model_key',
};

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

module.exports = { resolveDefaultModel, resolveDefaultModelRow, SETTING_KEY, ENV_FALLBACK };
