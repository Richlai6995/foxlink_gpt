/**
 * Factory Code Lookup Sync
 *
 * 把 ERP KFF (FND_FLEX_VALUES_VL, FLEX_VALUE_SET_ID=1008041) + 本地 factory_code_translations
 * 平展寫進本地 factory_code_lookup,讓 AI 戰情的 SQL 能直接 JOIN 取中文/英文/越南文名稱。
 *
 * 流程:
 *   1. 呼叫 factoryCache.forceReload() 強制讀 ERP 最新資料
 *   2. 讀本地 factory_code_translations(en / vi)
 *   3. MERGE 進 factory_code_lookup (upsert)
 *   4. 清掉 ERP 已消失的舊 code(optional,預設保留避免誤刪)
 *
 * 失敗策略:ERP 不通時回傳 { ok:false, reason },不破壞流程。
 * 呼叫時機:server 啟動後 5 秒、admin 按 forceReload cache 時。
 */

'use strict';

const factoryCache = require('./factoryCache');

async function syncFactoryCodeLookup(db, { forceReload = false } = {}) {
  if (!db) return { ok: false, reason: 'db not ready' };

  try {
    if (forceReload) {
      await factoryCache.forceReload();
    }
    const zhMap = await factoryCache.getFactoryMap();
    const codes = await factoryCache.getSortedCodes();

    if (!codes || codes.length === 0) {
      return { ok: false, reason: 'ERP KFF empty or not configured' };
    }

    // 讀 en / vi 翻譯
    const transRows = await db.prepare(
      `SELECT factory_code, lang, factory_name FROM factory_code_translations WHERE lang IN ('en','vi')`
    ).all();
    const transMap = new Map(); // code → { en, vi }
    for (const r of (transRows || [])) {
      const code = r.FACTORY_CODE || r.factory_code;
      const lang = r.LANG || r.lang;
      const name = r.FACTORY_NAME || r.factory_name;
      if (!code) continue;
      if (!transMap.has(code)) transMap.set(code, {});
      if (lang === 'en') transMap.get(code).en = name;
      else if (lang === 'vi') transMap.get(code).vi = name;
    }

    let inserted = 0;
    let updated = 0;
    for (const code of codes) {
      const zh  = zhMap.get(code) || null;
      const t   = transMap.get(code) || {};
      const en  = t.en || null;
      const vi  = t.vi || null;

      const existing = await db.prepare(
        `SELECT code FROM factory_code_lookup WHERE code=?`
      ).get(code);

      if (existing?.CODE || existing?.code) {
        await db.prepare(
          `UPDATE factory_code_lookup
             SET name_zh=?, name_en=?, name_vi=?, last_synced_at=SYSTIMESTAMP
           WHERE code=?`
        ).run(zh, en, vi, code);
        updated++;
      } else {
        await db.prepare(
          `INSERT INTO factory_code_lookup (code, name_zh, name_en, name_vi)
           VALUES (?, ?, ?, ?)`
        ).run(code, zh, en, vi);
        inserted++;
      }
    }

    console.log(`[FactoryCodeLookupSync] ok — inserted=${inserted} updated=${updated} total=${codes.length}`);
    return { ok: true, inserted, updated, total: codes.length };
  } catch (e) {
    console.error('[FactoryCodeLookupSync] error:', e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { syncFactoryCodeLookup };
