'use strict';
/**
 * KB 同義詞字典管理（Oracle Text CTX_THES）
 *
 * 一個 thesaurus = 一組詞彙關係，CONTAINS 搭 SYN(term, thes_name) 會自動展開。
 * 典型用法：在字典裡定義 "Trudy" 是 "高茵" 的同義詞，查 Trudy 時可撈到高茵的 row。
 *
 * 本服務只包 SYN（synonym）關係；其他 BT/NT/RT 暫不做（用得上再加）。
 *
 * 權限：需要 EXECUTE ON CTXSYS.CTX_THES。若缺 → 相關操作會丟清楚錯誤訊息。
 */

const VALID_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;

function validateThesName(name) {
  if (!VALID_NAME_RE.test(String(name || ''))) {
    throw new Error(`字典名稱格式不符（英數字底線、開頭為字母、最多 30 字元）: ${name}`);
  }
}

async function listThesauri(db) {
  const rows = await db.prepare(`
    SELECT tha_thesaurus AS name, COUNT(*) AS phrase_count
    FROM ctx_user_thes_phrases
    GROUP BY tha_thesaurus
    ORDER BY tha_thesaurus
  `).all().catch(async (e) => {
    // CTX_USER_THES_PHRASES 不一定有資料（新字典還沒加 phrase 時會查不到）
    // 退而求其次用 ctx_thesauri（新字典會在）
    if (/ORA-00942/i.test(e.message) || /no rows/i.test(e.message)) {
      return await db.prepare(`
        SELECT thesaurus_name AS name, 0 AS phrase_count
        FROM ctx_thesauri ORDER BY thesaurus_name
      `).all().catch(() => []);
    }
    throw e;
  });
  return rows.map((r) => ({
    name:         r.NAME ?? r.name,
    phrase_count: Number(r.PHRASE_COUNT ?? r.phrase_count ?? 0),
  }));
}

async function createThesaurus(db, name) {
  validateThesName(name);
  // 直接 PL/SQL 呼叫 CTX_THES.CREATE_THESAURUS
  // ORA-20011: Thesaurus already exists → swallow
  await db.execDDL(`
    BEGIN
      CTX_THES.CREATE_THESAURUS('${name}');
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE = -20011 THEN NULL; -- already exists
        ELSE RAISE;
        END IF;
    END;
  `);
}

async function dropThesaurus(db, name) {
  validateThesName(name);
  await db.execDDL(`
    BEGIN
      CTX_THES.DROP_THESAURUS('${name}');
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE = -20006 THEN NULL; -- thesaurus does not exist
        ELSE RAISE;
        END IF;
    END;
  `);
}

/**
 * 新增 synonym 關係：term 的同義詞是 related
 * CTX_THES.CREATE_RELATION('mythes','term','SYN','related')
 */
async function addSynonym(db, thesaurus, term, related) {
  validateThesName(thesaurus);
  if (!term || !related) throw new Error('term + related 必填');

  // 先確保 term phrase 存在（CREATE_PHRASE 冪等化）
  const safeTerm    = String(term).replace(/'/g, "''");
  const safeRelated = String(related).replace(/'/g, "''");

  await db.execDDL(`
    BEGIN
      BEGIN CTX_THES.CREATE_PHRASE('${thesaurus}','${safeTerm}');
      EXCEPTION WHEN OTHERS THEN IF SQLCODE != -20003 THEN RAISE; END IF; END;
      BEGIN CTX_THES.CREATE_PHRASE('${thesaurus}','${safeRelated}');
      EXCEPTION WHEN OTHERS THEN IF SQLCODE != -20003 THEN RAISE; END IF; END;
      BEGIN CTX_THES.CREATE_RELATION('${thesaurus}','${safeTerm}','SYN','${safeRelated}');
      EXCEPTION WHEN OTHERS THEN IF SQLCODE != -20005 THEN RAISE; END IF; END;
    END;
  `);
}

async function removeSynonym(db, thesaurus, term, related) {
  validateThesName(thesaurus);
  const safeTerm    = String(term).replace(/'/g, "''");
  const safeRelated = String(related).replace(/'/g, "''");
  await db.execDDL(`
    BEGIN
      BEGIN CTX_THES.DROP_RELATION('${thesaurus}','${safeTerm}','SYN','${safeRelated}');
      EXCEPTION WHEN OTHERS THEN IF SQLCODE != -20007 THEN RAISE; END IF; END;
    END;
  `);
}

/**
 * 列出字典所有 SYN 關係
 * @returns [{ term, related }, ...]
 */
async function listSynonyms(db, thesaurus) {
  validateThesName(thesaurus);
  const rows = await db.prepare(`
    SELECT thr_phrase AS term, thr_rel_phrase AS related
    FROM ctx_user_thes_phrase_relations
    WHERE thr_thesaurus=? AND thr_relation='SYN'
    ORDER BY thr_phrase, thr_rel_phrase
  `).all(thesaurus).catch(() => []);
  return rows.map((r) => ({
    term:    r.TERM ?? r.term,
    related: r.RELATED ?? r.related,
  }));
}

module.exports = {
  listThesauri,
  createThesaurus,
  dropThesaurus,
  addSynonym,
  removeSynonym,
  listSynonyms,
};
