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
    // 三種方式命中定價：
    //   1. tp.model = model (直接比對，例如管理員把 token_prices.model 填成 key)
    //   2. llm_models.key = model AND llm_models.name = tp.model (canonical key → 顯示名稱 → price)
    //   3. llm_models.api_model = model AND llm_models.name = tp.model (raw API ID → 顯示名稱 → price)
    const price = await db.prepare(
      `SELECT tp.* FROM token_prices tp
       WHERE (
         LOWER(tp.model)=LOWER(?)
         OR EXISTS (SELECT 1 FROM llm_models lm WHERE LOWER(lm.key)=LOWER(?) AND LOWER(lm.name)=LOWER(tp.model))
         OR EXISTS (SELECT 1 FROM llm_models lm WHERE LOWER(lm.api_model)=LOWER(?) AND LOWER(lm.name)=LOWER(tp.model))
       )
       AND tp.start_date<=${DI} AND (tp.end_date IS NULL OR tp.end_date>=${DI})
       ORDER BY tp.start_date DESC FETCH FIRST 1 ROWS ONLY`
    ).get(model, model, model, date, date);
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

/**
 * 重新計算 token_usage 中 cost=NULL 的所有資料列。
 * 在 server 啟動 migration 時自動執行，也可由管理員手動觸發。
 * @param {object} db
 * @param {number} [limitDays=365] 只回溯幾天（避免全表掃描過久）
 * @returns {Promise<{fixed: number, failed: number}>}
 */
async function recalcNullCosts(db, limitDays = 365) {
  let fixed = 0, failed = 0;
  try {
    const nullRows = await db.prepare(
      `SELECT id, user_id, TO_CHAR(usage_date,'YYYY-MM-DD') AS usage_date,
              model, input_tokens, output_tokens, COALESCE(image_count,0) AS image_count
       FROM token_usage
       WHERE cost IS NULL
         AND usage_date >= SYSDATE - ?
       ORDER BY usage_date DESC`
    ).all(limitDays);

    for (const row of nullRows) {
      try {
        // normalizeModelKey 先嘗試把 raw api_model → canonical key
        const normModel = await normalizeModelKey(db, row.model);
        const { cost, currency } = await calcCallCost(
          db, normModel, row.usage_date,
          row.input_tokens || 0, row.output_tokens || 0, row.image_count || 0
        );
        if (cost == null) { failed++; continue; }

        // 同時修正 model key（如有必要）
        if (normModel !== row.model) {
          // 嘗試 merge 到 canonical key 的同一天 row
          const D = `TO_DATE(?, 'YYYY-MM-DD')`;
          const canonical = await db.prepare(
            `SELECT id FROM token_usage WHERE user_id=? AND usage_date=${D} AND model=? AND id<>?`
          ).get(row.user_id, row.usage_date, normModel, row.id);
          if (canonical) {
            await db.prepare(
              `UPDATE token_usage SET
                 input_tokens=input_tokens+?, output_tokens=output_tokens+?,
                 image_count=COALESCE(image_count,0)+?,
                 cost=COALESCE(cost,0)+?, currency=COALESCE(?,currency)
               WHERE id=?`
            ).run(row.input_tokens||0, row.output_tokens||0, row.image_count||0, cost, currency, canonical.id);
            await db.prepare('DELETE FROM token_usage WHERE id=?').run(row.id);
            fixed++;
            continue;
          }
          await db.prepare('UPDATE token_usage SET model=?, cost=?, currency=? WHERE id=?')
            .run(normModel, cost, currency, row.id);
        } else {
          await db.prepare('UPDATE token_usage SET cost=?, currency=? WHERE id=?')
            .run(cost, currency, row.id);
        }
        fixed++;
      } catch (_) { failed++; }
    }
  } catch (e) {
    console.error('[TokenService] recalcNullCosts error:', e.message);
  }
  if (fixed || failed)
    console.log(`[TokenService] recalcNullCosts: fixed=${fixed} failed=${failed}`);
  return { fixed, failed };
}

module.exports = { upsertTokenUsage, calcCallCost, recalcNullCosts };
