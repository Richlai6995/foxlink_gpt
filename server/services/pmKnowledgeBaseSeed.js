'use strict';

/**
 * PM(貴金屬)平台預設 KB 自動 seed
 *
 * Server 啟動時 idempotent 建立 3 個 KB,給 PM 排程任務的 kb_write 節點當寫入目標:
 *   1. PM-新聞庫       — 每日金屬新聞抓取 / 全網全文 chunked + embedded
 *   2. PM-分析庫       — 日報 / 週報 / 月報 LLM 分析全文
 *   3. PM-原始資料庫   — 多個官方網站抓取的原始市場資料快照
 *
 * 設計原則:
 *   - 完全 idempotent(by name)
 *   - 預設 is_public=1(全 user 都看得到,給 PM 平台共用)
 *   - creator = 預設 admin user,所以 admin 自己編輯 / 刪除 / 改設定都可以
 *   - 新建後自動為 KB 加 KB_CHUNKS partition(避免後續 kb_write 堆爛)
 *
 * 回傳 Map<name, kbId> 給 pmScheduledTaskSeed 用,讓 task 的 kb_write 節點直接綁好 ID。
 */

const { v4: uuid } = require('uuid');

const KB_DEFINITIONS = [
  {
    name: 'PM-新聞庫',
    description: '貴金屬 / 基本金屬全網新聞抓取 + LLM 摘要 + 全文 chunked / embedded。由 [PM] 每日金屬新聞抓取 排程自動寫入。',
    chunk_strategy: 'regular',
    chunk_config: { chunk_size: 600, chunk_overlap: 80 },
    tags: ['PM', 'news', '金屬', 'auto-seed'],
    is_public: 1,
  },
  {
    name: 'PM-分析庫',
    description: '日報 / 週報 / 月報的 LLM 分析全文歷史庫。由 [PM] 系列分析報告排程自動寫入,可被後續報告引用做時序對比。',
    chunk_strategy: 'regular',
    chunk_config: { chunk_size: 800, chunk_overlap: 100 },
    tags: ['PM', 'analysis', 'report', 'auto-seed'],
    is_public: 1,
  },
  {
    name: 'PM-原始資料庫',
    description: '從 Kitco / Westmetall / TradingEconomics / Mining.com / Bloomberg / OilPrice 等多個官方網站抓取的原始市場資料 / 圖表頁面 / 即時報價快照。由 [PM] 全網金屬資料收集 排程自動寫入。',
    chunk_strategy: 'regular',
    chunk_config: { chunk_size: 1000, chunk_overlap: 120 },
    tags: ['PM', 'raw', 'scrape', 'auto-seed'],
    is_public: 1,
  },
];

async function ensureKb(db, def, ownerId) {
  // 檢查既有(by name)
  const existing = await db.prepare(
    `SELECT id FROM knowledge_bases WHERE name=? FETCH FIRST 1 ROWS ONLY`
  ).get(def.name);
  if (existing) return { id: existing.id || existing.ID, created: false };

  const id = uuid();
  // 取預設 embedding model
  let embedModel = 'gemini-embedding-001';
  try {
    const { resolveDefaultModel } = require('./llmDefaults');
    embedModel = await resolveDefaultModel(db, 'embedding') || embedModel;
  } catch (_) {}

  try {
    await db.prepare(`
      INSERT INTO knowledge_bases
        (id, creator_id, name, description,
         embedding_model, embedding_dims,
         chunk_strategy, chunk_config,
         retrieval_mode, rerank_model,
         top_k_fetch, top_k_return, score_threshold,
         ocr_model, parse_mode, pdf_ocr_mode, tags, is_public)
      VALUES (?, ?, ?, ?,
              ?, 768,
              ?, ?,
              'hybrid', NULL,
              10, 5, 0,
              NULL, 'text_only', 'off', ?, ?)
    `).run(
      id, ownerId, def.name, def.description,
      embedModel,
      def.chunk_strategy,
      JSON.stringify(def.chunk_config || {}),
      JSON.stringify(def.tags || []),
      def.is_public ? 1 : 0,
    );
  } catch (e) {
    if (/ORA-00001/.test(e.message)) {
      // race / 其他 transaction 已建,當 already exists 處理
      const r2 = await db.prepare(`SELECT id FROM knowledge_bases WHERE name=?`).get(def.name);
      return { id: r2?.id || r2?.ID, created: false };
    }
    throw e;
  }

  // 為新 KB 加 partition(若 KB_CHUNKS 是 LIST partitioned)— 沒這函式或失敗都 silent skip
  try {
    const { addKbChunksPartition } = require('../database-oracle');
    if (typeof addKbChunksPartition === 'function') {
      await addKbChunksPartition(id);
    }
  } catch (e) {
    console.warn(`[PMKnowledgeBaseSeed] addKbChunksPartition for ${def.name} failed: ${e.message}`);
  }

  return { id, created: true };
}

/**
 * 主入口。回傳 Map<name, id>,給 pmScheduledTaskSeed 拿來綁 kb_write 的 kb_id。
 */
async function autoSeedPmKnowledgeBases(db) {
  if (!db) return new Map();

  let ownerId = null;
  try {
    const r = await db.prepare(
      `SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`
    ).get();
    ownerId = r?.id || null;
  } catch (_) {}
  if (!ownerId) {
    console.warn('[PMKnowledgeBaseSeed] no admin user, skip seeding');
    return new Map();
  }

  const idMap = new Map();
  let createdCount = 0;
  let existedCount = 0;

  for (const def of KB_DEFINITIONS) {
    try {
      const { id, created } = await ensureKb(db, def, ownerId);
      if (id) idMap.set(def.name, id);
      if (created) {
        createdCount++;
        console.log(`[PMKnowledgeBaseSeed] Created KB "${def.name}" → ${id}`);
      } else {
        existedCount++;
      }
    } catch (e) {
      console.error(`[PMKnowledgeBaseSeed] ${def.name} failed:`, e.message);
    }
  }

  if (createdCount > 0) {
    console.log(`[PMKnowledgeBaseSeed] ${createdCount} created, ${existedCount} already existed (out of ${KB_DEFINITIONS.length})`);
  }
  return idMap;
}

module.exports = {
  autoSeedPmKnowledgeBases,
  KB_DEFINITIONS,
};
