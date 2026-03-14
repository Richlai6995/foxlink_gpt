'use strict';
/**
 * Shared token usage accounting.
 * Used by chat.js, researchService.js, and any other service that calls Gemini.
 */

/**
 * Normalize a raw API model ID (e.g. 'gemini-3-pro-preview') to the llm_models key
 * (e.g. 'pro') so that all token_usage rows are keyed consistently, enabling
 * correct cost calculation and a clean admin report.
 * Falls back to the original value if no matching llm_models row is found.
 */
/**
 * Normalize various model identifiers to the canonical llm_models key.
 * Handles:
 *   api_model  → key  (e.g. 'gemini-3-pro-preview'  → 'pro')
 *   name       → key  (e.g. 'Gemini 3 Pro'           → 'pro')
 *   key        → key  (passthrough, no DB match needed but safe)
 */
async function normalizeModelKey(db, model) {
  if (!model) return model;
  try {
    const row = await db.prepare(
      `SELECT key FROM llm_models
       WHERE (LOWER(api_model)=LOWER(?) OR LOWER(name)=LOWER(?))
       AND is_active=1 FETCH FIRST 1 ROWS ONLY`
    ).get(model, model);
    if (row?.key) return row.key;
  } catch (_) {}
  return model;
}

async function calcCallCost(db, model, date, inputTokens, outputTokens, imageCount) {
  try {
    const DI = `TO_DATE(?, 'YYYY-MM-DD')`;
    // 同時比對 key（直接）或 llm_models.name（管理員用顯示名稱設定時也能命中）
    const price = await db.prepare(
      `SELECT tp.* FROM token_prices tp
       WHERE (tp.model=? OR EXISTS (
         SELECT 1 FROM llm_models lm WHERE lm.key=? AND lm.name=tp.model
       ))
       AND tp.start_date<=${DI} AND (tp.end_date IS NULL OR tp.end_date>=${DI})
       ORDER BY tp.start_date DESC FETCH FIRST 1 ROWS ONLY`
    ).get(model, model, date, date);
    if (!price) return { cost: null, currency: null };

    const useT2 = price.tier_threshold && price.price_input_tier2 != null && inputTokens > price.tier_threshold;
    const priceIn  = useT2 ? price.price_input_tier2               : price.price_input;
    const priceOut = useT2 ? (price.price_output_tier2 ?? price.price_output) : price.price_output;
    const tokenCost = (inputTokens * priceIn + outputTokens * priceOut) / 1_000_000;
    const imageCost = (imageCount || 0) * (price.price_image_output || 0);
    return { cost: tokenCost + imageCost, currency: price.currency };
  } catch (e) {
    console.error('[TokenService] calcCallCost error:', e.message);
    return { cost: null, currency: null };
  }
}

async function upsertTokenUsage(db, userId, date, model, inputTokens, outputTokens, imageCount = 0) {
  try {
    if (!inputTokens && !outputTokens) return;
    // Normalize raw API model ID → llm_models key (e.g. 'gemini-3-pro-preview' → 'pro')
    const normalizedModel = await normalizeModelKey(db, model);
    model = normalizedModel;
    const { cost, currency } = await calcCallCost(db, model, date, inputTokens, outputTokens, imageCount);
    const D = `TO_DATE(?, 'YYYY-MM-DD')`;
    const existing = await db
      .prepare(`SELECT id FROM token_usage WHERE user_id=? AND usage_date=${D} AND model=?`)
      .get(userId, date, model);
    if (existing) {
      await db.prepare(
        `UPDATE token_usage
         SET input_tokens=input_tokens+?, output_tokens=output_tokens+?,
             image_count=COALESCE(image_count,0)+?,
             cost=CASE WHEN ? IS NOT NULL THEN COALESCE(cost,0)+? ELSE cost END,
             currency=COALESCE(?, currency)
         WHERE user_id=? AND usage_date=${D} AND model=?`
      ).run(inputTokens, outputTokens, imageCount, cost, cost, currency, userId, date, model);
    } else {
      await db.prepare(
        `INSERT INTO token_usage (user_id, usage_date, model, input_tokens, output_tokens, image_count, cost, currency)
         VALUES (?,${D},?,?,?,?,?,?)`
      ).run(userId, date, model, inputTokens, outputTokens, imageCount, cost, currency);
    }
  } catch (e) {
    console.error('[TokenService] upsertTokenUsage error:', e.message);
  }
}

module.exports = { upsertTokenUsage, calcCallCost };
