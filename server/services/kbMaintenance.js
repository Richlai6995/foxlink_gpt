'use strict';
/**
 * KB 維護服務
 * - Orphan chunks 清理（hourly cron + admin 手動觸發）
 * - Dim migration 統計（Phase 2 重建 HNSW 時用）
 * - Vector index 重建（Phase 2 提供）
 *
 * 與 cleanupService.js 平行的獨立模組，只處理 KB 相關。
 */

const cron = require('node-cron');

let scheduledTask = null;

// ─── Orphan chunk cleanup ─────────────────────────────────────────────────────

/**
 * 清除 kb_chunks 中 doc_id 指向不存在 kb_documents 的垃圾。
 * 有 FK / trigger 時正常狀態應回 0；當作最後一道 safety net。
 * @returns {{ removed: number, elapsed_ms: number }}
 */
async function cleanupOrphanChunks(db) {
  const t0 = Date.now();
  try {
    const r = await db.prepare(
      `DELETE FROM kb_chunks WHERE NOT EXISTS
       (SELECT 1 FROM kb_documents WHERE id = kb_chunks.doc_id)`
    ).run();
    const removed = r?.changes ?? 0;
    return { removed, elapsed_ms: Date.now() - t0 };
  } catch (e) {
    console.warn('[KbMaintenance] cleanupOrphanChunks error:', e.message);
    return { removed: 0, elapsed_ms: Date.now() - t0, error: e.message };
  }
}

/**
 * 重建 knowledge_bases.chunk_count（因直接 DB 操作可能讓 count 不準）
 */
async function refreshChunkCounts(db) {
  try {
    await db.prepare(`
      UPDATE knowledge_bases kb
      SET chunk_count = (SELECT COUNT(*) FROM kb_chunks WHERE kb_id = kb.id)
      WHERE kb.id IN (SELECT id FROM knowledge_bases)
    `).run();
  } catch (e) {
    console.warn('[KbMaintenance] refreshChunkCounts error:', e.message);
  }
}

// ─── Dim migration stats（Phase 2 用）─────────────────────────────────────────

async function dimMigrationStats(db) {
  const rows = await db.prepare(`
    SELECT embedding_dims, COUNT(*) AS kb_count,
           SUM(chunk_count) AS chunk_count_total,
           LISTAGG(name, ', ') WITHIN GROUP (ORDER BY name) AS kb_names
    FROM knowledge_bases
    GROUP BY embedding_dims
    ORDER BY embedding_dims
  `).all();
  return rows.map((r) => ({
    dims:          r.EMBEDDING_DIMS ?? r.embedding_dims,
    kb_count:      Number(r.KB_COUNT ?? r.kb_count ?? 0),
    chunk_count:   Number(r.CHUNK_COUNT_TOTAL ?? r.chunk_count_total ?? 0),
    kb_names:      r.KB_NAMES ?? r.kb_names ?? '',
  }));
}

// ─── Vector index rebuild（Phase 2 skeleton）──────────────────────────────────

/**
 * 重建 kb_chunks_vidx（HNSW）。Phase 2 正式使用；目前回 stub。
 */
async function rebuildVectorIndex(db, opts = {}) {
  console.warn('[KbMaintenance] rebuildVectorIndex 尚未實作（Phase 2）');
  return { success: false, reason: 'not-implemented' };
}

// ─── Cron scheduler ───────────────────────────────────────────────────────────

async function runOnce(db) {
  const t0 = Date.now();
  const orphan = await cleanupOrphanChunks(db);
  if (orphan.removed > 0) {
    await refreshChunkCounts(db);
    console.log(`[KbMaintenance] cleanup: 清除 ${orphan.removed} 個 orphan chunks (${orphan.elapsed_ms}ms)`);
  }
  return {
    removed: orphan.removed,
    total_elapsed_ms: Date.now() - t0,
  };
}

/**
 * 依 system_settings.kb_cleanup_cron 啟動定期清理任務。
 * 預設 `0 * * * *`（整點跑一次）。改 setting + 重啟才會套用新 cron。
 */
async function startScheduler(db) {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  let cronExpr = '0 * * * *';
  try {
    const row = await db.prepare(
      `SELECT value FROM system_settings WHERE key='kb_cleanup_cron'`
    ).get();
    if (row?.value) cronExpr = row.value;
  } catch (_) {}

  if (!cron.validate(cronExpr)) {
    console.warn(`[KbMaintenance] cron 表達式無效 "${cronExpr}"，用預設 0 * * * *`);
    cronExpr = '0 * * * *';
  }

  scheduledTask = cron.schedule(cronExpr, async () => {
    try {
      const stats = await runOnce(db);
      if (stats.removed > 0) {
        console.log('[KbMaintenance] scheduled run:', stats);
      }
    } catch (e) {
      console.error('[KbMaintenance] scheduled run error:', e.message);
    }
  });
  console.log(`[KbMaintenance] cron 啟動: ${cronExpr}`);
}

function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[KbMaintenance] cron 停止');
  }
}

module.exports = {
  cleanupOrphanChunks,
  refreshChunkCounts,
  dimMigrationStats,
  rebuildVectorIndex,
  runOnce,
  startScheduler,
  stopScheduler,
};
