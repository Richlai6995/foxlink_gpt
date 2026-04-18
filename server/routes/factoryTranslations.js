/**
 * Factory Translations Admin API
 *
 * 管理 factory_code 的 en / vi 翻譯。
 * zh-TW 來自 ERP FND_FLEX_VALUES_VL（唯讀，透過 factoryCache 取得）。
 *
 * 見 docs/factory-share-layer-plan.md §2.3
 */
const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');
const factoryCache = require('../services/factoryCache');

router.use(verifyToken);
router.use(verifyAdmin);

// ─── GET /api/admin/factory-translations ─────────────────────────────────────
// 列出所有 factory_code 現況 + en/vi 翻譯
router.get('/', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await factoryCache.getFactoryMap(); // ensure loaded
    const codes = await factoryCache.getSortedCodes();
    const zhMap = await factoryCache.getFactoryMap();

    const transRows = await db.prepare(
      `SELECT factory_code, lang, factory_name, updated_at
       FROM factory_code_translations`
    ).all();
    const transMap = new Map(); // code -> { en, vi, updated_at }
    for (const r of transRows) {
      const code = r.factory_code;
      if (!transMap.has(code)) transMap.set(code, {});
      const slot = transMap.get(code);
      slot[r.lang] = r.factory_name;
      slot[`${r.lang}_updated_at`] = r.updated_at;
    }

    const items = codes.map(code => {
      const t = transMap.get(code) || {};
      return {
        factory_code: code,
        zh_TW: zhMap.get(code) || code,  // from ERP cache (read-only)
        en: t.en || null,
        vi: t.vi || null,
        en_updated_at: t.en_updated_at || null,
        vi_updated_at: t.vi_updated_at || null,
      };
    });

    res.json({
      items,
      cache_status: factoryCache.getCacheStatus(),
    });
  } catch (e) {
    console.error('[FactoryTranslations] GET error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /api/admin/factory-translations/:code/:lang ─────────────────────────
// Upsert 單筆翻譯
router.put('/:code/:lang', async (req, res) => {
  try {
    const { code, lang } = req.params;
    const { factory_name } = req.body;
    if (!['en', 'vi'].includes(lang)) {
      return res.status(400).json({ error: 'lang must be en or vi' });
    }
    if (!factory_name || typeof factory_name !== 'string') {
      return res.status(400).json({ error: 'factory_name required' });
    }
    const db = require('../database-oracle').db;

    const existing = await db.prepare(
      `SELECT id FROM factory_code_translations WHERE factory_code=? AND lang=?`
    ).get(code, lang);

    if (existing) {
      await db.prepare(
        `UPDATE factory_code_translations
         SET factory_name=?, updated_at=SYSTIMESTAMP
         WHERE factory_code=? AND lang=?`
      ).run(factory_name, code, lang);
    } else {
      await db.prepare(
        `INSERT INTO factory_code_translations (factory_code, lang, factory_name)
         VALUES (?, ?, ?)`
      ).run(code, lang, factory_name);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[FactoryTranslations] PUT error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/admin/factory-translations/:code/:lang ──────────────────────
router.delete('/:code/:lang', async (req, res) => {
  try {
    const { code, lang } = req.params;
    if (!['en', 'vi'].includes(lang)) {
      return res.status(400).json({ error: 'lang must be en or vi' });
    }
    const db = require('../database-oracle').db;
    await db.prepare(
      `DELETE FROM factory_code_translations WHERE factory_code=? AND lang=?`
    ).run(code, lang);
    res.json({ ok: true });
  } catch (e) {
    console.error('[FactoryTranslations] DELETE error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/admin/factory-translations/refresh-cache ──────────────────────
// 強制重刷 ERP cache
router.post('/refresh-cache', async (req, res) => {
  try {
    const status = await factoryCache.forceReload();
    res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[FactoryTranslations] refresh-cache error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/admin/factory-translations/llm-translate ──────────────────────
// 批次 LLM 翻譯 en/vi（預設只補缺，可選 overwrite=true 覆寫）
router.post('/llm-translate', async (req, res) => {
  try {
    const { langs = ['en', 'vi'], overwrite = false } = req.body || {};
    const db = require('../database-oracle').db;

    await factoryCache.getFactoryMap();
    const codes = await factoryCache.getSortedCodes();
    const zhMap = await factoryCache.getFactoryMap();

    if (!codes.length) {
      return res.json({ ok: true, message: 'No factories to translate', translated: {} });
    }

    const existingRows = await db.prepare(
      `SELECT factory_code, lang FROM factory_code_translations`
    ).all();
    const existing = new Set(existingRows.map(r => `${r.factory_code}::${r.lang}`));

    const result = { translated: {}, skipped: {}, errors: {} };

    for (const lang of langs) {
      if (!['en', 'vi'].includes(lang)) continue;

      const toTranslate = [];
      for (const code of codes) {
        const key = `${code}::${lang}`;
        if (!overwrite && existing.has(key)) {
          result.skipped[lang] = (result.skipped[lang] || 0) + 1;
          continue;
        }
        toTranslate.push({ code, zh: zhMap.get(code) || code });
      }
      if (!toTranslate.length) continue;

      // 分 chunk 避免單次 LLM call 過慢或 output 被截斷
      const CHUNK_SIZE = 15;
      let totalTranslated = 0;
      const chunkErrors = [];

      for (let i = 0; i < toTranslate.length; i += CHUNK_SIZE) {
        const chunk = toTranslate.slice(i, i + CHUNK_SIZE);
        try {
          const translations = await _llmTranslateBatch(chunk, lang);
          for (const { code, name } of translations) {
            if (!name) continue;
            const isExisting = existing.has(`${code}::${lang}`);
            if (isExisting) {
              await db.prepare(
                `UPDATE factory_code_translations
                 SET factory_name=?, updated_at=SYSTIMESTAMP
                 WHERE factory_code=? AND lang=?`
              ).run(name, code, lang);
            } else {
              await db.prepare(
                `INSERT INTO factory_code_translations (factory_code, lang, factory_name)
                 VALUES (?, ?, ?)`
              ).run(code, lang, name);
              existing.add(`${code}::${lang}`);
            }
          }
          totalTranslated += translations.length;
          console.log(`[FactoryTranslations] ${lang} chunk ${Math.floor(i / CHUNK_SIZE) + 1}: translated ${translations.length}`);
        } catch (e) {
          console.error(`[FactoryTranslations] ${lang} chunk ${Math.floor(i / CHUNK_SIZE) + 1} failed:`, e.message);
          chunkErrors.push(e.message);
        }
      }

      result.translated[lang] = totalTranslated;
      if (chunkErrors.length) result.errors[lang] = chunkErrors.join('; ');
    }

    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[FactoryTranslations] llm-translate error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Internal: LLM batch translate ───────────────────────────────────────────
async function _llmTranslateBatch(items, targetLang) {
  const { getGenerativeModel, extractText } = require('../services/geminiClient');
  const modelName = process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash-preview-05-20';
  const model = getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  const langName = targetLang === 'en' ? 'English' : 'Vietnamese (Tiếng Việt)';
  const systemPrompt = `You are translating factory/plant location names from Traditional Chinese to ${langName}.
Rules:
1. Translate each factory name accurately, preserving meaning
2. Keep proper nouns (city names, brand names) in standard form
3. For location codes (e.g. "TCC", "KS1"), keep as-is in the output's "code" field
4. Return ONLY valid JSON array — no markdown fences
5. Output format: [{"code": "...", "name": "translated name"}, ...]`;

  const payload = items.map(x => ({ code: x.code, name: x.zh }));
  const prompt = `Translate these factory names to ${langName}:\n${JSON.stringify(payload)}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
  });
  let text = extractText(result).trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('LLM did not return an array');
  return parsed;
}

module.exports = router;
