'use strict';
/**
 * Shared token usage accounting.
 * Used by chat.js, researchService.js, and any other service that calls Gemini.
 */

async function calcCallCost(db, model, date, inputTokens, outputTokens, imageCount) {
  try {
    const DI = `TO_DATE(?, 'YYYY-MM-DD')`;
    const price = await db.prepare(
      `SELECT * FROM token_prices WHERE model=? AND start_date<=${DI} AND (end_date IS NULL OR end_date>=${DI}) ORDER BY start_date DESC FETCH FIRST 1 ROWS ONLY`
    ).get(model, date, date);
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
