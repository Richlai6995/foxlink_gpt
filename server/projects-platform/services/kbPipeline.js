/**
 * KB Pipeline minimal — Live KB chunk 寫入 + 結案 fork → 沉澱
 *
 * 對應 spec §7 / §8
 *
 * Phase 1 範圍:
 *   - writeLiveChunk(): message post / task DONE / form save 觸發
 *   - forkToSediment(): project lifecycle CLOSED 觸發,scrub 機密欄位後寫沉澱
 *   - search(): 簡易 LIKE 搜尋(Phase 2 換 Oracle Text + Vector)
 */

const { makeLogger } = require('./logger');
const log = makeLogger('kbPipeline');

/** 寫一個 Live KB chunk */
async function writeLiveChunk(db, {
  projectId, kind, sourceId, content, tags, isConfidential,
}) {
  if (!projectId || !kind || !content) return null;
  try {
    const r = await db.prepare(
      `INSERT INTO project_kb_chunks
         (project_id, kind, source_id, content, tags, is_confidential, is_sediment)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      projectId,
      kind,
      sourceId || null,
      String(content).slice(0, 8000),
      tags ? JSON.stringify(tags) : null,
      isConfidential ? 1 : 0,
    );
    return Number(r.lastInsertRowid);
  } catch (e) {
    log.warn(`writeLiveChunk failed: ${e.message}`);
    return null;
  }
}

/**
 * Scrub 機密欄位(規則式)
 * 進 sediment KB 前必走
 */
function scrubContent(content, _opts = {}) {
  if (!content) return { content, scrubbed: false };
  let s = String(content);
  let scrubbed = false;
  // 客戶名 alias(粗略偵測常見)
  const customerNames = ['Apple', 'Sony', 'Samsung', 'Tesla', 'BYD', 'Garmin', '蘋果', '索尼', '三星'];
  for (const n of customerNames) {
    if (s.includes(n)) {
      s = s.replaceAll(n, 'A001');
      scrubbed = true;
    }
  }
  // 金額 → Tier(粗略 regex)
  s = s.replace(/\$[\d,]+/g, () => { scrubbed = true; return 'Tier-?'; });
  s = s.replace(/[\d,]+(?:\.\d+)?\s*(?:USD|TWD|元)/g, () => { scrubbed = true; return 'Tier-?'; });
  // 毛利 % → MASKED
  s = s.replace(/(\d+(?:\.\d+)?)%/g, (m) => {
    const n = parseFloat(m);
    if (n >= 5 && n <= 50) {  // 看起來像毛利
      scrubbed = true;
      return 'MASKED%';
    }
    return m;
  });
  return { content: s, scrubbed };
}

/**
 * 結案 fork — 把 project 所有 Live chunk + 整體 metadata fork 進沉澱 KB
 * 不可逆 · 一次性
 */
async function forkToSediment(db, projectId) {
  log.log(`fork to sediment: project ${projectId}`);

  // 先檢查是否已 fork(避免重複)
  const existing = await db.prepare(
    `SELECT COUNT(*) AS C FROM project_kb_chunks WHERE project_id = ? AND is_sediment = 1`,
  ).get(projectId);
  if (Number(existing?.c ?? existing?.C ?? 0) > 0) {
    log.warn(`project ${projectId} already forked to sediment, skip`);
    return { skipped: true };
  }

  // 拿 project 整體
  const project = await db.prepare(
    `SELECT id, project_code, data_payload FROM projects WHERE id = ?`,
  ).get(projectId);
  if (!project) return { error: 'project not found' };

  // 1. 整體 case chunk
  const payload = (() => { try { return JSON.parse(project.data_payload || '{}'); } catch { return {}; } })();
  const summary = `Project ${project.project_code} · ${payload.title || ''} · 客戶:${payload.customer || ''} · 料號:${payload.partNo || ''}`;
  const { content: scrubbedSummary } = scrubContent(summary);
  await db.prepare(
    `INSERT INTO project_kb_chunks
       (project_id, kind, content, is_sediment, scrubbed, scrub_note)
     VALUES (?, 'case', ?, 1, 1, '客戶 → A001 · 金額 → Tier-?')`,
  ).run(projectId, scrubbedSummary);

  // 2. 把 Live chat / form / task chunk 各取最近 100 個進沉澱(scrub 後)
  const liveChunks = await db.prepare(
    `SELECT id, kind, content FROM project_kb_chunks
      WHERE project_id = ? AND is_sediment = 0
      ORDER BY id DESC FETCH FIRST 100 ROWS ONLY`,
  ).all(projectId);

  let copied = 0;
  for (const c of liveChunks) {
    const { content: sc, scrubbed } = scrubContent(c.content);
    try {
      await db.prepare(
        `INSERT INTO project_kb_chunks
           (project_id, kind, content, is_sediment, scrubbed, sediment_from_chunk_id, scrub_note)
         VALUES (?, ?, ?, 1, ?, ?, ?)`,
      ).run(projectId, c.kind, sc, scrubbed ? 1 : 0, Number(c.id), scrubbed ? '已 scrub 機密欄位' : '');
      copied++;
    } catch (e) {
      log.warn(`copy chunk ${c.id}:`, e.message);
    }
  }

  log.log(`sediment fork done: project ${projectId} · ${copied} chunks copied`);
  return { copied };
}

/**
 * 簡易搜(LIKE,Phase 2 換 Oracle Text + Vector)
 */
async function search(db, query, { isSediment, projectId, limit = 20 } = {}) {
  const params = [`%${query}%`];
  const wh = ['UPPER(content) LIKE UPPER(?)'];
  if (isSediment !== undefined) {
    wh.push('is_sediment = ?');
    params.push(isSediment ? 1 : 0);
  }
  if (projectId) {
    wh.push('project_id = ?');
    params.push(projectId);
  }
  params.push(limit);
  return db.prepare(
    `SELECT id, project_id, kind, content, is_sediment, scrubbed, scrub_note, created_at
       FROM project_kb_chunks
      WHERE ${wh.join(' AND ')}
      ORDER BY created_at DESC
      FETCH FIRST ? ROWS ONLY`,
  ).all(...params);
}

module.exports = {
  writeLiveChunk,
  scrubContent,
  forkToSediment,
  search,
};
