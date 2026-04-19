'use strict';
/**
 * KB 同義詞字典管理（純追蹤表版）
 *
 * 原本打算呼叫 Oracle CTX_THES.CREATE_THESAURUS + SYN() 自動展開，
 * 但 FOXLINK 環境缺 EXECUTE ON CTXSYS.CTX_THES 權限（PLS-00201）。
 *
 * 改為：
 *   - 追蹤表 kb_thesauri / kb_thesaurus_synonyms 自己維護
 *   - 檢索時 kbRetrieval._buildOracleTextQuery 查本表，將 token OR 展開
 *     例：query "鍾漢成" + foxlink_syn 字典有 (鍾漢成, Carson Chung)
 *     → CONTAINS 查詢 `{鍾漢成} OR {Carson Chung}`
 *   - 優點：零權限要求、跨 Oracle 版本穩定、可觀測（SQL 看得懂）
 */

const VALID_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;

function validateThesName(name) {
  if (!VALID_NAME_RE.test(String(name || ''))) {
    throw new Error(`字典名稱格式不符（英數字底線、開頭為字母、最多 30 字元）: ${name}`);
  }
}

async function listThesauri(db) {
  const rows = await db.prepare(`
    SELECT t.name, NVL(cnt.c, 0) AS phrase_count
    FROM kb_thesauri t
    LEFT JOIN (
      SELECT thesaurus, COUNT(*) AS c
      FROM kb_thesaurus_synonyms GROUP BY thesaurus
    ) cnt ON cnt.thesaurus = t.name
    ORDER BY t.name
  `).all();
  return rows.map((r) => ({
    name:         r.NAME ?? r.name,
    phrase_count: Number(r.PHRASE_COUNT ?? r.phrase_count ?? 0),
  }));
}

async function createThesaurus(db, name) {
  validateThesName(name);
  const ex = await db.prepare(`SELECT name FROM kb_thesauri WHERE name=?`).get(name);
  if (!ex) await db.prepare(`INSERT INTO kb_thesauri (name) VALUES (?)`).run(name);
}

async function dropThesaurus(db, name) {
  validateThesName(name);
  await db.prepare(`DELETE FROM kb_thesaurus_synonyms WHERE thesaurus=?`).run(name);
  await db.prepare(`DELETE FROM kb_thesauri WHERE name=?`).run(name);
}

async function addSynonym(db, thesaurus, term, related) {
  validateThesName(thesaurus);
  if (!term || !related) throw new Error('term + related 必填');
  const t = String(term).trim();
  const r = String(related).trim();
  const ex = await db.prepare(
    `SELECT id FROM kb_thesaurus_synonyms WHERE thesaurus=? AND term=? AND related=?`
  ).get(thesaurus, t, r);
  if (!ex) {
    await db.prepare(
      `INSERT INTO kb_thesaurus_synonyms (thesaurus, term, related) VALUES (?,?,?)`
    ).run(thesaurus, t, r);
  }
}

async function removeSynonym(db, thesaurus, term, related) {
  validateThesName(thesaurus);
  await db.prepare(
    `DELETE FROM kb_thesaurus_synonyms WHERE thesaurus=? AND term=? AND related=?`
  ).run(thesaurus, String(term).trim(), String(related).trim());
}

async function listSynonyms(db, thesaurus) {
  validateThesName(thesaurus);
  const rows = await db.prepare(`
    SELECT term, related FROM kb_thesaurus_synonyms
    WHERE thesaurus=? ORDER BY term, related
  `).all(thesaurus);
  return rows.map((r) => ({
    term:    r.TERM ?? r.term,
    related: r.RELATED ?? r.related,
  }));
}

/**
 * 查某字典對 token 的所有同義詞（雙向：term→related 和 related→term）。
 * 供 kbRetrieval._buildOracleTextQuery 使用。
 * @returns string[]  不包含 token 本身
 */
async function lookupExpansion(db, thesaurus, token) {
  if (!thesaurus || !token) return [];
  try {
    const rows = await db.prepare(`
      SELECT related AS syn FROM kb_thesaurus_synonyms
      WHERE thesaurus=? AND term=?
      UNION
      SELECT term AS syn FROM kb_thesaurus_synonyms
      WHERE thesaurus=? AND related=?
    `).all(thesaurus, token, thesaurus, token);
    const tokenLc = token.toLowerCase();
    return rows
      .map((r) => (r.SYN ?? r.syn || '').trim())
      .filter((s) => s && s.toLowerCase() !== tokenLc);
  } catch (e) {
    console.warn('[kbSynonyms] lookupExpansion error:', e.message);
    return [];
  }
}

module.exports = {
  listThesauri,
  createThesaurus,
  dropThesaurus,
  addSynonym,
  removeSynonym,
  listSynonyms,
  lookupExpansion,
};
