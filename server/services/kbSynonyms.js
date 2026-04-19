'use strict';
/**
 * KB 同義詞字典管理（Oracle Text CTX_THES）
 *
 * Oracle Text CTX_THESAURI view 的 column 名在不同版本差異大，
 * 為了穩定直接自己維護兩張追蹤表：
 *   - kb_thesauri          字典列表
 *   - kb_thesaurus_synonyms  SYN 關係列表
 * 運作時同步呼叫 CTX_THES.CREATE_THESAURUS / CREATE_RELATION 等 PL/SQL，
 * 讓 CONTAINS SYN(term, thes_name) 能真的展開同義詞。
 *
 * 權限：需 EXECUTE ON CTXSYS.CTX_THES。缺權限會在 UI 看到清楚錯誤。
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
  // 先嘗試 Oracle CTX_THES（要能過才算成功）
  await db.execDDL(`
    BEGIN
      CTX_THES.CREATE_THESAURUS('${name}');
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE = -20011 THEN NULL; -- already exists in Oracle
        ELSE RAISE;
        END IF;
    END;
  `);
  // 再塞追蹤表（冪等）
  const ex = await db.prepare(`SELECT name FROM kb_thesauri WHERE name=?`).get(name);
  if (!ex) await db.prepare(`INSERT INTO kb_thesauri (name) VALUES (?)`).run(name);
}

async function dropThesaurus(db, name) {
  validateThesName(name);
  // Oracle 先（含所有 phrases/relations）
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
  await db.prepare(`DELETE FROM kb_thesaurus_synonyms WHERE thesaurus=?`).run(name);
  await db.prepare(`DELETE FROM kb_thesauri WHERE name=?`).run(name);
}

async function addSynonym(db, thesaurus, term, related) {
  validateThesName(thesaurus);
  if (!term || !related) throw new Error('term + related 必填');

  const t = String(term).trim();
  const r = String(related).trim();
  const safeT = t.replace(/'/g, "''");
  const safeR = r.replace(/'/g, "''");

  await db.execDDL(`
    BEGIN
      BEGIN CTX_THES.CREATE_PHRASE('${thesaurus}','${safeT}');
      EXCEPTION WHEN OTHERS THEN IF SQLCODE != -20003 THEN RAISE; END IF; END;
      BEGIN CTX_THES.CREATE_PHRASE('${thesaurus}','${safeR}');
      EXCEPTION WHEN OTHERS THEN IF SQLCODE != -20003 THEN RAISE; END IF; END;
      BEGIN CTX_THES.CREATE_RELATION('${thesaurus}','${safeT}','SYN','${safeR}');
      EXCEPTION WHEN OTHERS THEN IF SQLCODE != -20005 THEN RAISE; END IF; END;
    END;
  `);

  // 同步追蹤表（UPSERT via 先查再 insert）
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
  const safeT = String(term).trim().replace(/'/g, "''");
  const safeR = String(related).trim().replace(/'/g, "''");
  await db.execDDL(`
    BEGIN
      BEGIN CTX_THES.DROP_RELATION('${thesaurus}','${safeT}','SYN','${safeR}');
      EXCEPTION WHEN OTHERS THEN IF SQLCODE != -20007 THEN RAISE; END IF; END;
    END;
  `);
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

module.exports = {
  listThesauri,
  createThesaurus,
  dropThesaurus,
  addSynonym,
  removeSynonym,
  listSynonyms,
};
