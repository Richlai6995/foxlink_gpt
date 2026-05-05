/**
 * Announcement Service
 *
 * 公告系統:全站使用者可見、依重要度分流(banner / 鈴鐺)、可 dismiss、有效期、
 * 三語翻譯(zh-TW source + en/vi LLM 翻)。受眾沿用 grantee_type/grantee_id 模式
 * (參考 help_book_shares),audience_mode='all' 不寫 audiences,'targeted' 寫多筆。
 */
require('dotenv').config();
const { getGenerativeModel, extractText } = require('./geminiClient');
const { decryptKey } = require('./llmKeyService');

const VALID_LEVELS = ['info', 'notice', 'warning', 'critical'];
// status:
//   draft    = 草稿,只 admin 看得到,user 端完全不顯示。允許在這狀態下編輯+翻譯
//   active   = 已發布,user 端可見
//   archived = 已下架,user 端不顯示但保留歷史
const VALID_STATUS = ['draft', 'active', 'archived'];
const VALID_GRANTEE_TYPES = ['user', 'role', 'factory', 'department', 'cost_center', 'division', 'org_group'];
const VALID_LANGS = ['zh-TW', 'en', 'vi'];

// ── Audience matching ────────────────────────────────────────────────────────

/**
 * 把 user session 攤成 (grantee_type, grantee_id) tuples,給 audience JOIN 用
 * (對齊 helpSections.userGranteeTuples)
 */
function userGranteeTuples(user) {
  const map = [
    ['user',        String(user?.id ?? '')],
    ['role',        String(user?.role_id ?? '')],
    ['factory',     String(user?.factory_code ?? '')],
    ['department',  String(user?.dept_code ?? '')],
    ['cost_center', String(user?.profit_center ?? '')],
    ['division',    String(user?.org_section ?? '')],
    ['org_group',   String(user?.org_group_name ?? '')],
  ];
  return map.filter(([_, v]) => v && v !== 'null' && v !== 'undefined');
}

// ── Read API for end users ───────────────────────────────────────────────────

/**
 * 給 end user 用 — 回傳當前可見、未過期、未 dismiss 的公告列表(已合併翻譯)
 *
 * 過濾條件:
 *   1. status='active'
 *   2. effective_from <= now AND (effective_to IS NULL OR effective_to > now)
 *   3. audience_mode='all' OR 該 user 的任一 grantee tuple 命中 audiences
 *   4. user_announcement_dismissals 沒有 (user_id, ann_id, current revision) 紀錄
 *
 * @param {object} db
 * @param {object} user - req.user(含 id / role_id / factory_code / ...)
 * @param {string} [lang='zh-TW']
 */
async function listActiveForUser(db, user, lang = 'zh-TW') {
  if (!user?.id) return [];
  const safeLang = VALID_LANGS.includes(lang) ? lang : 'zh-TW';

  const tuples = userGranteeTuples(user);
  // audience match SQL:audience_mode='all' OR EXISTS(任一 grantee 命中)
  let audienceClause = "a.audience_mode = 'all'";
  if (tuples.length > 0) {
    const orPairs = tuples.map(() => '(grantee_type=? AND grantee_id=?)').join(' OR ');
    audienceClause += ` OR EXISTS (
      SELECT 1 FROM announcement_audiences aa
      WHERE aa.announcement_id = a.id AND (${orPairs})
    )`;
  }

  // 注意:Oracle 把 LEVEL 當 reserved word(CONNECT BY pseudocolumn),
  //      連 `SELECT severity AS level` 這種 alias 也會炸 ORA-00923
  //      → DB 欄位實際叫 SEVERITY,SELECT 直接用 severity,JS 層再 rename → level 給前端
  // is_read:LEFT JOIN reads 表,COUNT > 0 即視為已讀(打開鈴鐺後)
  const sql = `
    SELECT
      a.id, a.severity, a.dismissible, a.effective_from, a.effective_to,
      a.revision, a.audience_mode, a.created_at, a.updated_at,
      COALESCE(t.title, tz.title) AS title,
      COALESCE(t.body,  tz.body)  AS body,
      CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS is_read
    FROM announcements a
    LEFT JOIN announcement_translations t  ON t.announcement_id = a.id  AND t.lang = '${safeLang}'
    LEFT JOIN announcement_translations tz ON tz.announcement_id = a.id AND tz.lang = 'zh-TW'
    LEFT JOIN user_announcement_reads r ON r.announcement_id = a.id AND r.revision = a.revision AND r.user_id = ?
    WHERE a.status = 'active'
      AND a.effective_from <= SYSTIMESTAMP
      AND (a.effective_to IS NULL OR a.effective_to > SYSTIMESTAMP)
      AND (${audienceClause})
      AND NOT EXISTS (
        SELECT 1 FROM user_announcement_dismissals d
        WHERE d.user_id = ?
          AND d.announcement_id = a.id
          AND d.revision = a.revision
      )
    ORDER BY
      CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'notice' THEN 3 ELSE 4 END,
      a.created_at DESC
  `;

  // SQL 參數順序:reads user_id (1) → audience tuples (2N) → dismissal user_id (1)
  const finalParams = [user.id, ...tuples.flatMap(([t, v]) => [t, v]), user.id];
  const rows = await db.prepare(sql).all(...finalParams);
  // severity → level rename(對前端 API 維持 level 命名);is_read 轉 boolean
  return rows.map(r => {
    const { severity, is_read, ...rest } = r;
    return { ...rest, level: severity, is_read: Number(is_read) === 1 };
  });
}

/**
 * 標記公告已讀(只清 badge,公告仍留在鈴鐺清單供 user 回看)
 * 通常由前端「打開鈴鐺」事件觸發,把當下可見的公告 id 一次送上來
 */
async function markReadForUser(db, userId, announcementIds) {
  if (!userId || !Array.isArray(announcementIds) || announcementIds.length === 0) return 0;
  // 撈這些公告的當前 revision,reads 紀錄要綁 revision(bumpRevision 後重新算未讀)
  const ids = announcementIds.map(Number).filter(Number.isFinite);
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const anns = await db.prepare(
    `SELECT id, revision FROM announcements WHERE id IN (${placeholders})`
  ).all(...ids);
  let inserted = 0;
  for (const a of anns) {
    try {
      await db.prepare(`
        INSERT INTO user_announcement_reads (user_id, announcement_id, revision)
        VALUES (?, ?, ?)
      `).run(userId, a.id, a.revision || 1);
      inserted++;
    } catch (e) {
      // UNIQUE = 已 mark 過,正常
      if (!/UNIQUE constraint failed/i.test(e.message || '')) throw e;
    }
  }
  return inserted;
}

async function dismissForUser(db, userId, announcementId) {
  if (!userId || !announcementId) return false;
  const ann = await db.prepare(
    `SELECT id, revision, dismissible FROM announcements WHERE id=?`
  ).get(announcementId);
  if (!ann) return false;
  if (Number(ann.dismissible) === 0) return false;

  // upsert(per user × ann × revision)
  try {
    await db.prepare(`
      INSERT INTO user_announcement_dismissals (user_id, announcement_id, revision)
      VALUES (?, ?, ?)
    `).run(userId, announcementId, ann.revision || 1);
  } catch (e) {
    // UNIQUE conflict = 已經 dismiss 過,當成功處理
    if (!/UNIQUE constraint failed/i.test(e.message || '')) throw e;
  }
  return true;
}

// ── Admin CRUD ───────────────────────────────────────────────────────────────

/**
 * Admin 列表查詢(支援多條件,留作歷史檢索)
 * @param {object} opts
 *   status:     'active' | 'archived' | undefined(全部)
 *   level:      'info' | 'notice' | 'warning' | 'critical' | undefined
 *   q:          關鍵字(zh-TW title / body 模糊搜尋)
 *   created_from / created_to: 建立日期區間(ISO string)
 *   audience_mode: 'all' | 'targeted' | undefined
 *   created_by: NUMBER(發布者 user.id)
 *   limit:      預設 200(避免一次拉爆)
 *   offset:     分頁
 */
async function listAdmin(db, opts = {}) {
  const safeLang = VALID_LANGS.includes(opts.lang) ? opts.lang : 'zh-TW';
  const where = [];
  const params = [];

  if (opts.status && VALID_STATUS.includes(opts.status)) {
    where.push('a.status = ?'); params.push(opts.status);
  }
  if (opts.level && VALID_LEVELS.includes(opts.level)) {
    where.push('a.severity = ?'); params.push(opts.level);
  }
  if (opts.audience_mode === 'all' || opts.audience_mode === 'targeted') {
    where.push('a.audience_mode = ?'); params.push(opts.audience_mode);
  }
  if (opts.created_by) {
    where.push('a.created_by = ?'); params.push(Number(opts.created_by));
  }
  if (opts.created_from) {
    where.push('a.created_at >= ?'); params.push(new Date(opts.created_from));
  }
  if (opts.created_to) {
    where.push('a.created_at <= ?'); params.push(new Date(opts.created_to));
  }
  // 關鍵字模糊搜:zh-TW title / body
  // 用 EXISTS 避免 LEFT JOIN 多筆放大;只搜 zh-TW(原文最完整),不搜 en/vi 翻譯免歧義
  if (opts.q && String(opts.q).trim()) {
    const q = `%${String(opts.q).trim().toLowerCase()}%`;
    where.push(`EXISTS (
      SELECT 1 FROM announcement_translations qt
      WHERE qt.announcement_id = a.id AND qt.lang = 'zh-TW'
        AND (LOWER(qt.title) LIKE ? OR LOWER(DBMS_LOB.SUBSTR(qt.body, 4000, 1)) LIKE ?)
    )`);
    params.push(q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit  = Math.max(1, Math.min(1000, Number(opts.limit)  || 200));
  const offset = Math.max(0, Number(opts.offset) || 0);

  // 不 alias 為 level(Oracle reserved word 連 alias 都炸 ORA-00923),JS 層 rename
  const rawRows = await db.prepare(`
    SELECT
      a.id, a.severity, a.status, a.dismissible, a.audience_mode, a.revision,
      a.effective_from, a.effective_to, a.created_by, a.created_at, a.updated_at,
      u.name     AS created_by_name,
      u.username AS created_by_username,
      tz.title AS title_zh,
      t.title  AS title_local,
      (SELECT COUNT(*) FROM announcement_audiences aa WHERE aa.announcement_id = a.id) AS audience_count,
      (SELECT COUNT(*) FROM user_announcement_dismissals d WHERE d.announcement_id = a.id AND d.revision = a.revision) AS dismiss_count
    FROM announcements a
    LEFT JOIN announcement_translations tz ON tz.announcement_id = a.id AND tz.lang = 'zh-TW'
    LEFT JOIN announcement_translations t  ON t.announcement_id = a.id  AND t.lang = '${safeLang}'
    LEFT JOIN users u ON u.id = a.created_by
    ${whereSql}
    ORDER BY a.created_at DESC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `).all(...params);
  const rows = rawRows.map(r => { const { severity, ...rest } = r; return { ...rest, level: severity }; });

  // 同時回 total(無分頁的命中數)讓前端做 "顯示 X 筆 / 共 Y 筆"
  const totalRow = await db.prepare(`
    SELECT COUNT(*) AS cnt FROM announcements a ${whereSql}
  `).get(...params);
  const total = Number(totalRow?.cnt ?? totalRow?.CNT ?? 0);

  return { rows, total, limit, offset };
}

async function getById(db, id) {
  // 不能 alias 為 level(Oracle reserved word),JS 層 rename
  const raw = await db.prepare(`
    SELECT id, severity, status, dismissible, audience_mode, revision,
           effective_from, effective_to, created_by, created_at, updated_at
    FROM announcements WHERE id=?
  `).get(id);
  if (!raw) return null;
  const { severity, ...rest } = raw;
  const ann = { ...rest, level: severity };
  const translations = await db.prepare(
    `SELECT lang, title, body, updated_at FROM announcement_translations WHERE announcement_id=?`
  ).all(id);
  const audiences = await db.prepare(
    `SELECT grantee_type, grantee_id FROM announcement_audiences WHERE announcement_id=?`
  ).all(id);
  return { ...ann, translations, audiences };
}

/**
 * @param {object} db
 * @param {number} createdBy - admin user.id
 * @param {object} payload - { level, status, effective_from, effective_to, dismissible,
 *                             audience_mode, audiences:[{grantee_type,grantee_id}],
 *                             title, body  // zh-TW source }
 */
async function create(db, createdBy, payload) {
  const level = VALID_LEVELS.includes(payload.level) ? payload.level : 'notice';
  // 預設 draft 草稿,須由 admin 明確按「發布」才會 active
  const status = VALID_STATUS.includes(payload.status) ? payload.status : 'draft';
  const dismissible = level === 'critical' && Number(payload.dismissible) === 0 ? 0 : 1;
  const audienceMode = payload.audience_mode === 'targeted' ? 'targeted' : 'all';
  const effectiveFrom = payload.effective_from ? new Date(payload.effective_from) : new Date();
  const effectiveTo = payload.effective_to ? new Date(payload.effective_to) : null;

  const result = await db.prepare(`
    INSERT INTO announcements (severity, status, effective_from, effective_to, dismissible, audience_mode, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(level, status, effectiveFrom, effectiveTo, dismissible, audienceMode, createdBy || null);

  const id = result.lastInsertRowid;

  // zh-TW source translation
  await db.prepare(`
    INSERT INTO announcement_translations (announcement_id, lang, title, body)
    VALUES (?, 'zh-TW', ?, ?)
  `).run(id, String(payload.title || '').slice(0, 500), String(payload.body || ''));

  // audiences
  if (audienceMode === 'targeted' && Array.isArray(payload.audiences)) {
    for (const a of payload.audiences) {
      if (!VALID_GRANTEE_TYPES.includes(a.grantee_type)) continue;
      if (!a.grantee_id) continue;
      try {
        await db.prepare(`
          INSERT INTO announcement_audiences (announcement_id, grantee_type, grantee_id)
          VALUES (?, ?, ?)
        `).run(id, a.grantee_type, String(a.grantee_id));
      } catch (e) {
        if (!/UNIQUE constraint failed/i.test(e.message || '')) throw e;
      }
    }
  }

  return id;
}

/**
 * @param {object} payload - 同 create + bumpRevision flag
 *   bumpRevision=true 時 revision +1,所有 user dismiss 紀錄會失效(該重大修訂後重新出現)
 */
async function update(db, id, payload) {
  const ann = await db.prepare(`SELECT id, revision FROM announcements WHERE id=?`).get(id);
  if (!ann) throw new Error('Announcement not found');

  const level = VALID_LEVELS.includes(payload.level) ? payload.level : null;
  const status = VALID_STATUS.includes(payload.status) ? payload.status : null;
  const audienceMode = payload.audience_mode === 'targeted' ? 'targeted'
                     : payload.audience_mode === 'all' ? 'all' : null;
  const dismissible = payload.dismissible !== undefined
    ? (Number(payload.dismissible) === 0 ? 0 : 1)
    : null;
  const effectiveFrom = payload.effective_from !== undefined
    ? (payload.effective_from ? new Date(payload.effective_from) : null)
    : undefined;
  const effectiveTo = payload.effective_to !== undefined
    ? (payload.effective_to ? new Date(payload.effective_to) : null)
    : undefined;
  const newRevision = payload.bumpRevision ? (Number(ann.revision || 1) + 1) : null;

  const sets = [];
  const params = [];
  if (level !== null) { sets.push('severity=?');      params.push(level); }
  if (status !== null) { sets.push('status=?');       params.push(status); }
  if (audienceMode !== null) { sets.push('audience_mode=?'); params.push(audienceMode); }
  if (dismissible !== null) { sets.push('dismissible=?'); params.push(dismissible); }
  if (effectiveFrom !== undefined) { sets.push('effective_from=?'); params.push(effectiveFrom); }
  if (effectiveTo   !== undefined) { sets.push('effective_to=?');   params.push(effectiveTo); }
  if (newRevision !== null) { sets.push('revision=?'); params.push(newRevision); }
  sets.push('updated_at=SYSTIMESTAMP');

  if (sets.length > 1) {
    params.push(id);
    await db.prepare(`UPDATE announcements SET ${sets.join(', ')} WHERE id=?`).run(...params);
  }

  // 更新 zh-TW 翻譯(如果 payload 帶了 title/body)
  if (payload.title !== undefined || payload.body !== undefined) {
    const existing = await db.prepare(
      `SELECT id FROM announcement_translations WHERE announcement_id=? AND lang='zh-TW'`
    ).get(id);
    if (existing) {
      await db.prepare(`
        UPDATE announcement_translations SET title=?, body=?, updated_at=SYSTIMESTAMP
        WHERE announcement_id=? AND lang='zh-TW'
      `).run(
        String(payload.title ?? '').slice(0, 500),
        String(payload.body ?? ''),
        id
      );
    } else {
      await db.prepare(`
        INSERT INTO announcement_translations (announcement_id, lang, title, body)
        VALUES (?, 'zh-TW', ?, ?)
      `).run(id, String(payload.title ?? '').slice(0, 500), String(payload.body ?? ''));
    }
  }

  // 更新 audiences(如果 payload 帶了)
  if (payload.audiences !== undefined) {
    await db.prepare(`DELETE FROM announcement_audiences WHERE announcement_id=?`).run(id);
    if (Array.isArray(payload.audiences) && audienceMode !== 'all') {
      for (const a of payload.audiences) {
        if (!VALID_GRANTEE_TYPES.includes(a.grantee_type)) continue;
        if (!a.grantee_id) continue;
        try {
          await db.prepare(`
            INSERT INTO announcement_audiences (announcement_id, grantee_type, grantee_id)
            VALUES (?, ?, ?)
          `).run(id, a.grantee_type, String(a.grantee_id));
        } catch (e) {
          if (!/UNIQUE constraint failed/i.test(e.message || '')) throw e;
        }
      }
    }
  }
}

/**
 * 手動更新某個語言的翻譯(編輯 modal 三語 tab 用)
 * 不影響主表,只動 announcement_translations
 */
async function upsertTranslation(db, announcementId, lang, title, body) {
  if (!VALID_LANGS.includes(lang)) throw new Error('Invalid lang');
  const ann = await db.prepare(`SELECT id FROM announcements WHERE id=?`).get(announcementId);
  if (!ann) throw new Error('Announcement not found');

  const existing = await db.prepare(
    `SELECT id FROM announcement_translations WHERE announcement_id=? AND lang=?`
  ).get(announcementId, lang);
  if (existing) {
    await db.prepare(`
      UPDATE announcement_translations SET title=?, body=?, updated_at=SYSTIMESTAMP
      WHERE announcement_id=? AND lang=?
    `).run(String(title || '').slice(0, 500), String(body || ''), announcementId, lang);
  } else {
    await db.prepare(`
      INSERT INTO announcement_translations (announcement_id, lang, title, body)
      VALUES (?, ?, ?, ?)
    `).run(announcementId, lang, String(title || '').slice(0, 500), String(body || ''));
  }
}

async function archive(db, id) {
  await db.prepare(`UPDATE announcements SET status='archived', updated_at=SYSTIMESTAMP WHERE id=?`).run(id);
}

/**
 * 發布:draft → active(供 admin 完成翻譯後正式上架)
 * 已 active / archived 的呼叫不會出錯,但沒實際變化
 */
async function publish(db, id) {
  await db.prepare(`
    UPDATE announcements SET status='active', updated_at=SYSTIMESTAMP
    WHERE id=? AND status='draft'
  `).run(id);
}

/**
 * 退回草稿:active → draft(發現翻譯沒翻好、想暫時下架修正)
 */
async function unpublish(db, id) {
  await db.prepare(`
    UPDATE announcements SET status='draft', updated_at=SYSTIMESTAMP
    WHERE id=? AND status='active'
  `).run(id);
}

async function remove(db, id) {
  // ON DELETE CASCADE 會清掉 translations / audiences;dismissals 沒有 FK,手動清
  await db.prepare(`DELETE FROM user_announcement_dismissals WHERE announcement_id=?`).run(id);
  await db.prepare(`DELETE FROM announcements WHERE id=?`).run(id);
}

// ── Translation(zh-TW → en / vi)─────────────────────────────────────────────

const LANG_NAMES = { en: 'English', vi: 'Vietnamese (Tiếng Việt)' };

const TRANSLATE_SYSTEM = `You are a professional technical translator. Translate the announcement (title + body) from Traditional Chinese to the target language.

## Rules:
1. Translate text values; preserve markdown (**bold**, *italic*, lists, links, code spans).
2. **DO NOT translate** these proper nouns — keep them as-is:
   - Product names: Cortex, Foxlink, DIFY, MCP, AOAI, Gemini, Oracle, Webex, GPT, Claude
   - Technical terms: SSO, LDAP, AD, API, Token, KB, LLM, ETL, PDF, Word, Excel, PPT, SMTP, JSON, URL
3. Keep emoji as-is.
4. Return ONLY valid JSON: { "title": "...", "body": "..." } — no markdown fences, no explanation.`;

async function resolveModelInfo(db, modelKey = 'flash') {
  try {
    const row = await db.prepare(
      `SELECT api_model, api_key_enc, provider_type FROM llm_models WHERE key=? AND is_active=1`
    ).get(modelKey);
    if (row) {
      const apiKey = row.api_key_enc
        ? (decryptKey(row.api_key_enc) || process.env.GEMINI_API_KEY)
        : process.env.GEMINI_API_KEY;
      return { apiModel: row.api_model, apiKey, provider: row.provider_type || 'gemini' };
    }
  } catch { /* ignore */ }
  const flashModel = process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash-preview-05-20';
  const proModel   = process.env.GEMINI_MODEL_PRO   || 'gemini-3-pro-preview';
  if (modelKey === 'pro') return { apiModel: proModel, apiKey: process.env.GEMINI_API_KEY, provider: 'gemini' };
  return { apiModel: flashModel, apiKey: process.env.GEMINI_API_KEY, provider: 'gemini' };
}

/**
 * 翻譯一則公告到 target lang,寫入 announcement_translations
 * @returns {{ ok, title, body, error? }}
 */
async function translateOne(db, announcementId, targetLang, modelKey = 'flash') {
  if (!VALID_LANGS.includes(targetLang) || targetLang === 'zh-TW') {
    return { ok: false, error: 'Invalid target language' };
  }
  const zh = await db.prepare(
    `SELECT title, body FROM announcement_translations WHERE announcement_id=? AND lang='zh-TW'`
  ).get(announcementId);
  if (!zh || !zh.title) return { ok: false, error: 'No zh-TW source' };

  const modelInfo = await resolveModelInfo(db, modelKey);
  const langName = LANG_NAMES[targetLang] || targetLang;

  const model = getGenerativeModel({
    model: modelInfo.apiModel,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
    apiKey: modelInfo.apiKey,
  });

  const prompt = `Translate the following announcement from Traditional Chinese to ${langName}.

${JSON.stringify({ title: zh.title, body: zh.body || '' })}`;

  let translated;
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: TRANSLATE_SYSTEM }] },
    });
    let text = extractText(result).trim();
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    translated = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (!translated?.title) return { ok: false, error: 'Empty translation' };

  // upsert
  const existing = await db.prepare(
    `SELECT id FROM announcement_translations WHERE announcement_id=? AND lang=?`
  ).get(announcementId, targetLang);
  if (existing) {
    await db.prepare(`
      UPDATE announcement_translations SET title=?, body=?, updated_at=SYSTIMESTAMP
      WHERE announcement_id=? AND lang=?
    `).run(String(translated.title).slice(0, 500), String(translated.body || ''), announcementId, targetLang);
  } else {
    await db.prepare(`
      INSERT INTO announcement_translations (announcement_id, lang, title, body)
      VALUES (?, ?, ?, ?)
    `).run(announcementId, targetLang, String(translated.title).slice(0, 500), String(translated.body || ''));
  }

  return { ok: true, title: translated.title, body: translated.body || '' };
}

module.exports = {
  VALID_LEVELS,
  VALID_STATUS,
  VALID_GRANTEE_TYPES,
  VALID_LANGS,
  listActiveForUser,
  markReadForUser,
  dismissForUser,
  listAdmin,
  getById,
  create,
  update,
  archive,
  publish,
  unpublish,
  remove,
  translateOne,
  upsertTranslation,
};
