/**
 * PM Forecast Backfill — 補 forecast_history 缺資料
 *
 * Usage:
 *   node scripts/pmBackfillForecasts.js                       # 預設 current 模式 + 11 金屬 + horizon 14
 *   node scripts/pmBackfillForecasts.js --mode=current
 *   node scripts/pmBackfillForecasts.js --mode=rolling --days=30
 *   node scripts/pmBackfillForecasts.js --metal=CU            # 只跑單一金屬
 *   node scripts/pmBackfillForecasts.js --horizon=7
 *   node scripts/pmBackfillForecasts.js --dry-run             # 不寫 DB,印 plan
 *   node scripts/pmBackfillForecasts.js --series-days=60      # 餵給 LLM 的歷史視窗
 *
 * 模式說明:
 *   current  — 對每個金屬「以最新一筆 pm_price_history.as_of_date 為基準」
 *              生成未來 horizon 天預測,寫入 forecast_history
 *   rolling  — 對過去 N 天每一天「假裝那天是 today」生成未來 horizon 天預測,
 *              用於 backfill 歷史視角預測 → 給 pmForecastAccuracyService 算 MAPE
 *
 * 直接呼叫 LLM(generateTextSync),不走 pipeline,避免一份廣泛 task 的依賴。
 * 完全 idempotent — UNIQUE (entity_type, entity_code, forecast_date, target_date, model_used)
 * 上 MERGE,跑兩次同樣參數結果一樣(會 UPDATE 同一 row)。
 */
'use strict';
require('dotenv').config();

const { db, initDb } = require('../database-oracle');
const { generateTextSync } = require('../services/gemini');
const { resolveTaskModel, pickModelKey } = require('../services/llmDefaults');
const { SYSTEM_PROMPT } = (() => {
  const m = require('../services/forecastSkillSeed');
  return {
    // forecastSkillSeed 沒 export SYSTEM_PROMPT,但我們可以用同樣 prompt 的精簡版
    // 或 fallback 用 SKILL 的 LLM call(需另外查 skills 表)
    SYSTEM_PROMPT: null,
  };
})();

// ── 直接 inline 一份 system_prompt(跟 forecast_timeseries_llm Skill 同步)──
// 比起去 DB 撈 skill row 麻煩,inline 比較好;version drift 風險很低(forecast prompt 動就再來)
const FORECAST_SYSTEM_PROMPT = `你是一位專業的時序資料預測分析師。你的任務是依照使用者提供的歷史時序資料 + 背景脈絡,輸出未來 N 天的預測。

== 輸入格式 ==
使用者訊息會是一個 JSON 物件,包含以下欄位:
- series: array,歷史時序,每筆 {date: 'YYYY-MM-DD', value: number}
- horizon_days: number,要預測的未來天數(例 7)
- context_text: string(選填),近期事件、相關指標、政策變化等自由文字
- target_description: string,預測標的的人類可讀描述(例:USD/ton 銅價)
- as_of_date: string(選填),預測基準日期(預設取 series 最後一筆的 date 之後一天)

== 輸出格式(嚴格 JSON,不要任何 markdown 包裝、不要 prose 說明) ==
{
  "forecast": [
    {"date": "YYYY-MM-DD", "mean": <number>, "lower": <number>, "upper": <number>}
  ],
  "confidence": "low" | "medium" | "high",
  "rationale": "<2-4 句中文,說明預測邏輯與主要假設>",
  "key_drivers": ["<驅動因子1>", "<驅動因子2>"],
  "model_used": "<本次使用的 LLM model 名稱>",
  "horizon_days": <number>,
  "as_of_date": "YYYY-MM-DD",
  "target_description": "<原樣回填>"
}

== 預測原則 ==
1. lower / upper 是 80% 信心區間;區間寬度隨 confidence 等級遞增
2. series < 7 筆,confidence='low' 並在 rationale 點明「樣本不足」
3. mean 必須延續 series 最後一筆的數量級
4. confidence: high(series≥30 + 趨勢清楚) / medium(10-30) / low(<10 或結構不確定)

直接以 \`{\` 開始輸出,不要任何前後文字。`;

// ── 11 個金屬代碼 + 中文名 + 預設 unit (顯示用) ─────────────────────────────
const METALS = [
  { code: 'CU', zh: '銅',  unit: 'USD/ton' },
  { code: 'AL', zh: '鋁',  unit: 'USD/ton' },
  { code: 'NI', zh: '鎳',  unit: 'USD/ton' },
  { code: 'SN', zh: '錫',  unit: 'USD/ton' },
  { code: 'ZN', zh: '鋅',  unit: 'USD/ton' },
  { code: 'PB', zh: '鉛',  unit: 'USD/ton' },
  { code: 'AU', zh: '金',  unit: 'USD/oz'  },
  { code: 'AG', zh: '銀',  unit: 'USD/oz'  },
  { code: 'PT', zh: '鉑',  unit: 'USD/oz'  },
  { code: 'PD', zh: '鈀',  unit: 'USD/oz'  },
  { code: 'RH', zh: '銠',  unit: 'USD/oz'  },
];

// ── CLI 參數 parse ───────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    mode: 'current',
    days: 30,
    horizon: 14,
    seriesDays: 60,
    metal: null,
    dryRun: false,
  };
  for (const a of args) {
    if (a.startsWith('--mode='))         out.mode = a.split('=')[1];
    else if (a.startsWith('--days='))    out.days = Number(a.split('=')[1]) || 30;
    else if (a.startsWith('--horizon=')) out.horizon = Number(a.split('=')[1]) || 14;
    else if (a.startsWith('--series-days=')) out.seriesDays = Number(a.split('=')[1]) || 60;
    else if (a.startsWith('--metal='))   out.metal = a.split('=')[1].toUpperCase();
    else if (a === '--dry-run')          out.dryRun = true;
  }
  return out;
}

// ── 從 pm_price_history 撈 series(以 asOfDate 為截止)─────────────────────────
async function fetchSeries(metalCode, asOfDate, seriesDays) {
  const rows = await db.prepare(`
    SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d,
           AVG(price_usd) AS v
    FROM pm_price_history
    WHERE UPPER(metal_code) = UPPER(?)
      AND as_of_date BETWEEN TO_DATE(?, 'YYYY-MM-DD') - ? AND TO_DATE(?, 'YYYY-MM-DD')
      AND price_usd IS NOT NULL
    GROUP BY as_of_date
    ORDER BY as_of_date ASC
  `).all(metalCode, asOfDate, seriesDays, asOfDate);

  return (rows || []).map(r => ({
    date:  r.d || r.D,
    value: Number(r.v ?? r.V),
  })).filter(p => Number.isFinite(p.value) && p.value > 0);
}

// ── 撈最新 as_of_date(用於 current mode)──────────────────────────────────────
async function fetchLatestAsOfDate() {
  const r = await db.prepare(`
    SELECT TO_CHAR(MAX(as_of_date), 'YYYY-MM-DD') AS d FROM pm_price_history
  `).get();
  return r?.d || r?.D || null;
}

// ── LLM call ─────────────────────────────────────────────────────────────────
async function callForecastLLM(apiModel, payload) {
  const history = [
    { role: 'user', parts: [{ text: FORECAST_SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: '好的,我會嚴格依 JSON 格式輸出。' }] },
  ];
  const userPrompt = JSON.stringify(payload);
  const { text } = await generateTextSync(apiModel, history, userPrompt);
  return text;
}

// ── strict JSON parser(容錯)───────────────────────────────────────────────
function parseForecastJson(text) {
  if (!text) return null;

  // 1. 直接 parse
  try { return JSON.parse(text); } catch (_) {}

  // 2. fenced code block
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) {}
  }

  // 3. 第一個 { 到對應 }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (_) {}
  }

  return null;
}

// ── 寫 forecast_history(MERGE upsert)─────────────────────────────────────────
async function upsertForecast(row) {
  // Oracle MERGE upsert by UNIQUE (entity_type, entity_code, forecast_date, target_date, model_used)
  await db.prepare(`
    MERGE INTO forecast_history t
    USING (SELECT
             ? AS entity_type,
             ? AS entity_code,
             TO_DATE(?, 'YYYY-MM-DD') AS forecast_date,
             TO_DATE(?, 'YYYY-MM-DD') AS target_date,
             ? AS model_used
           FROM dual) s
    ON (t.entity_type = s.entity_type
        AND t.entity_code = s.entity_code
        AND t.forecast_date = s.forecast_date
        AND t.target_date = s.target_date
        AND t.model_used = s.model_used)
    WHEN MATCHED THEN UPDATE SET
      horizon_days     = ?,
      predicted_mean   = ?,
      predicted_lower  = ?,
      predicted_upper  = ?,
      confidence       = ?,
      rationale        = ?,
      key_drivers      = ?,
      meta_pipeline    = ?
    WHEN NOT MATCHED THEN INSERT
      (entity_type, entity_code, forecast_date, target_date, horizon_days,
       predicted_mean, predicted_lower, predicted_upper, confidence,
       rationale, key_drivers, model_used, meta_pipeline, creation_date)
    VALUES
      (s.entity_type, s.entity_code, s.forecast_date, s.target_date, ?,
       ?, ?, ?, ?, ?, ?, s.model_used, ?, SYSTIMESTAMP)
  `).run(
    // USING bind:
    row.entity_type, row.entity_code, row.forecast_date, row.target_date, row.model_used,
    // WHEN MATCHED bind:
    row.horizon_days, row.predicted_mean, row.predicted_lower, row.predicted_upper,
    row.confidence, row.rationale, row.key_drivers, row.meta_pipeline,
    // WHEN NOT MATCHED bind:
    row.horizon_days, row.predicted_mean, row.predicted_lower, row.predicted_upper,
    row.confidence, row.rationale, row.key_drivers, row.meta_pipeline,
  );
}

// ── 跑單一 metal × asOfDate 的預測 ───────────────────────────────────────────
async function forecastOne(apiModel, metal, asOfDate, horizon, seriesDays, dryRun) {
  const series = await fetchSeries(metal.code, asOfDate, seriesDays);
  if (series.length < 3) {
    console.log(`  ⊘ ${metal.code} (${metal.zh}) @ ${asOfDate} — series 太少 (${series.length} 筆),skip`);
    return { skipped: 1 };
  }

  const payload = {
    series,
    horizon_days: horizon,
    target_description: `${metal.unit} ${metal.zh}價`,
    as_of_date: asOfDate,
    context_text: `當前 series 最後一筆 ${series.at(-1).date} = ${series.at(-1).value.toFixed(2)} ${metal.unit}`,
  };

  let raw;
  try {
    raw = await callForecastLLM(apiModel, payload);
  } catch (e) {
    console.error(`  ✗ ${metal.code} @ ${asOfDate} — LLM call 失敗: ${e.message}`);
    return { errored: 1 };
  }

  const parsed = parseForecastJson(raw);
  if (!parsed || !Array.isArray(parsed.forecast)) {
    console.error(`  ✗ ${metal.code} @ ${asOfDate} — JSON parse 失敗;raw 前 200 字: ${(raw || '').slice(0, 200)}`);
    return { errored: 1 };
  }

  const forecasts = parsed.forecast.filter(f =>
    f && f.date && Number.isFinite(Number(f.mean))
  );
  if (!forecasts.length) {
    console.warn(`  ⚠ ${metal.code} @ ${asOfDate} — forecast 陣列空 / 無 valid mean`);
    return { errored: 1 };
  }

  if (dryRun) {
    console.log(`  ✓ [DRY] ${metal.code} (${metal.zh}) @ ${asOfDate} — ${forecasts.length} 筆預測, conf=${parsed.confidence || '?'}, sample: ${forecasts[0].date} mean=${forecasts[0].mean}`);
    return { written: forecasts.length, dryRun: true };
  }

  const keyDrivers = Array.isArray(parsed.key_drivers)
    ? parsed.key_drivers.slice(0, 5).join(', ').slice(0, 500)
    : String(parsed.key_drivers || '').slice(0, 500);

  let written = 0;
  for (const f of forecasts) {
    try {
      await upsertForecast({
        entity_type:     'metal',
        entity_code:     metal.code,
        forecast_date:   asOfDate,
        target_date:     f.date,
        horizon_days:    horizon,
        predicted_mean:  Number(f.mean),
        predicted_lower: Number.isFinite(Number(f.lower)) ? Number(f.lower) : null,
        predicted_upper: Number.isFinite(Number(f.upper)) ? Number(f.upper) : null,
        confidence:      String(parsed.confidence || 'medium').slice(0, 20),
        rationale:       String(parsed.rationale || '').slice(0, 4000),
        key_drivers:     keyDrivers,
        model_used:      apiModel,
        meta_pipeline:   'pmBackfillForecasts.js',
      });
      written++;
    } catch (e) {
      console.error(`    ✗ upsert ${metal.code} target=${f.date}: ${e.message}`);
    }
  }
  console.log(`  ✓ ${metal.code} (${metal.zh}) @ ${asOfDate} — wrote ${written}/${forecasts.length}, conf=${parsed.confidence || '?'}`);
  return { written };
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  await initDb();

  // resolve PM Pro model(走跟 PM 任務一樣的邏輯)
  const proKey = await pickModelKey(db, 'pro').catch(() => '');
  const apiModel = await resolveTaskModel(db, proKey || null, 'chat');
  console.log(`[pmBackfillForecasts] 使用 LLM model: ${apiModel} (key="${proKey || '(env fallback)'}")`);
  console.log(`[pmBackfillForecasts] opts: ${JSON.stringify(opts)}`);

  // 確認 pm_price_history 有資料
  const pricesCnt = await db.prepare(`SELECT COUNT(*) AS n FROM pm_price_history`).get();
  const totalPrices = Number(pricesCnt?.n ?? pricesCnt?.N ?? 0);
  console.log(`[pmBackfillForecasts] pm_price_history total rows: ${totalPrices}`);
  if (totalPrices === 0) {
    console.error('pm_price_history 是空的 — 先讓「[PM] 全網金屬資料收集」或 Westmetall 抓取任務跑過再回來');
    process.exit(1);
  }

  const targetMetals = opts.metal
    ? METALS.filter(m => m.code === opts.metal)
    : METALS;
  if (!targetMetals.length) {
    console.error(`找不到 metal=${opts.metal},合法值: ${METALS.map(m => m.code).join(',')}`);
    process.exit(1);
  }

  // 算需要跑的 (asOfDate, metal) pairs
  let pairs = [];
  if (opts.mode === 'current') {
    const latest = await fetchLatestAsOfDate();
    if (!latest) { console.error('pm_price_history 沒有 as_of_date'); process.exit(1); }
    console.log(`[pmBackfillForecasts] current mode — latest as_of_date = ${latest}`);
    for (const m of targetMetals) pairs.push({ metal: m, asOfDate: latest });
  } else if (opts.mode === 'rolling') {
    // 過去 days 天裡每天都有 row 的 distinct dates
    const dateRows = await db.prepare(`
      SELECT DISTINCT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d
      FROM pm_price_history
      WHERE as_of_date >= TRUNC(SYSDATE) - ?
      ORDER BY d DESC
    `).all(opts.days);
    const dates = (dateRows || []).map(r => r.d || r.D).filter(Boolean);
    console.log(`[pmBackfillForecasts] rolling mode — ${dates.length} 個歷史 as_of_date(過去 ${opts.days} 天)`);
    for (const d of dates) {
      for (const m of targetMetals) pairs.push({ metal: m, asOfDate: d });
    }
  } else {
    console.error(`未知 mode: ${opts.mode}(valid: current / rolling)`);
    process.exit(1);
  }

  console.log(`[pmBackfillForecasts] total pairs to process: ${pairs.length}\n`);

  let totalWritten = 0, totalSkipped = 0, totalErrored = 0;
  let i = 0;
  for (const p of pairs) {
    i++;
    process.stdout.write(`[${i}/${pairs.length}] `);
    const r = await forecastOne(apiModel, p.metal, p.asOfDate, opts.horizon, opts.seriesDays, opts.dryRun);
    totalWritten += r.written || 0;
    totalSkipped += r.skipped || 0;
    totalErrored += r.errored || 0;
  }

  console.log('\n══ Summary ══');
  console.log(`  寫入 forecast_history: ${totalWritten}`);
  console.log(`  跳過(series 不足):    ${totalSkipped}`);
  console.log(`  失敗(LLM/parse):       ${totalErrored}`);
  if (opts.dryRun) console.log('  (dry-run — 實際沒寫 DB)');

  console.log('\n══ 驗證 forecast_history 現況 ══');
  const stats = await db.prepare(`
    SELECT entity_code AS code,
           COUNT(*)                              AS rows,
           TO_CHAR(MIN(forecast_date),'YYYY-MM-DD') AS first_fcd,
           TO_CHAR(MAX(forecast_date),'YYYY-MM-DD') AS last_fcd,
           TO_CHAR(MAX(target_date),'YYYY-MM-DD')   AS last_tgt
    FROM forecast_history WHERE entity_type='metal'
    GROUP BY entity_code ORDER BY entity_code
  `).all();
  console.table(stats.map(r => ({
    code: r.code || r.CODE,
    rows: r.rows || r.ROWS,
    first_fcd: r.first_fcd || r.FIRST_FCD,
    last_fcd:  r.last_fcd  || r.LAST_FCD,
    last_tgt:  r.last_tgt  || r.LAST_TGT,
  })));

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
