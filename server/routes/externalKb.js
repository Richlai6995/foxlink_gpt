'use strict';
/**
 * External KB API  /api/v1
 * Public access via API key — no session required.
 *
 * GET  /api/v1/kb/list         — list accessible KBs
 * POST /api/v1/kb/search       — search one KB
 * POST /api/v1/kb/chat         — single-turn chat with KB context
 */
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { upsertTokenUsage } = require('../services/tokenService');

function getDb() {
  return require('../database-oracle').db;
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── API Key middleware ────────────────────────────────────────────────────────
async function requireApiKey(req, res, next) {
  const db = getDb();
  const authHeader = req.headers['authorization'] || '';
  const raw = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!raw) return res.status(401).json({ error: 'Missing API key' });

  try {
    const hash = hashKey(raw);
    const apiKey = await db.prepare(`
      SELECT id, name, accessible_kbs, is_active, expires_at
      FROM api_keys
      WHERE key_hash = ?
    `).get(hash);

    if (!apiKey)           return res.status(401).json({ error: 'Invalid API key' });
    if (!apiKey.is_active) return res.status(403).json({ error: 'API key is disabled' });
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      return res.status(403).json({ error: 'API key has expired' });
    }

    // Parse allowed KB IDs: ["*"] or null = all KBs; [id1, id2] = specific KBs
    req.apiKey = apiKey;
    let parsed = null;
    try { parsed = JSON.parse(apiKey.accessible_kbs || '["*"]'); } catch { parsed = ['*']; }
    req.allowedKbIds = (parsed.includes('*') || parsed.includes(0)) ? null : parsed;

    // Update last_used_at (non-blocking)
    db.prepare(`UPDATE api_keys SET last_used_at = SYSTIMESTAMP WHERE id = ?`).run(apiKey.id).catch?.(() => {});

    next();
  } catch (e) {
    console.error('[ExternalKB] API key check failed:', e.message);
    res.status(500).json({ error: e.message });
  }
}

router.use(requireApiKey);

// ── GET /api/v1/kb/list ───────────────────────────────────────────────────────
router.get('/kb/list', async (req, res) => {
  const db = getDb();
  try {
    let rows;
    if (req.allowedKbIds && req.allowedKbIds.length > 0) {
      const placeholders = req.allowedKbIds.map(() => '?').join(',');
      rows = await db.prepare(`
        SELECT id, name, description, retrieval_mode, embedding_dims, created_at
        FROM knowledge_bases
        WHERE is_active = 1 AND id IN (${placeholders})
        ORDER BY name
      `).all(...req.allowedKbIds);
    } else {
      rows = await db.prepare(`
        SELECT id, name, description, retrieval_mode, embedding_dims, created_at
        FROM knowledge_bases
        WHERE is_active = 1
        ORDER BY name
      `).all();
    }
    res.json({ kbs: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── KB access guard helper ────────────────────────────────────────────────────
async function getAccessibleKb(db, kbId, allowedKbIds) {
  if (allowedKbIds && !allowedKbIds.includes(Number(kbId)) && !allowedKbIds.includes(String(kbId))) {
    return null;
  }
  return await db.prepare(`
    SELECT * FROM knowledge_bases WHERE id = ? AND is_active = 1
  `).get(kbId);
}

// ── POST /api/v1/kb/search ────────────────────────────────────────────────────
router.post('/kb/search', async (req, res) => {
  const db = getDb();
  const { kb_id, query, top_k } = req.body;
  if (!kb_id || !query?.trim()) {
    return res.status(400).json({ error: 'kb_id and query are required' });
  }

  try {
    const kb = await getAccessibleKb(db, kb_id, req.allowedKbIds);
    if (!kb) return res.status(404).json({ error: 'KB not found or not accessible' });

    const { embedText, toVectorStr } = require('../services/kbEmbedding');
    const mode   = kb.retrieval_mode || 'hybrid';
    const topK   = Math.min(Number(top_k) || Number(kb.top_k_return) || 5, 20);
    const dims   = kb.embedding_dims || 768;
    const thresh = Number(kb.score_threshold) || 0;

    let results = [];

    if (mode === 'vector' || mode === 'hybrid') {
      const qEmb    = await embedText(query, { dims });
      const qVecStr = toVectorStr(qEmb);
      const fetchK  = Math.min(topK * 3, 60);
      const rows = await db.prepare(`
        SELECT c.id, c.content, c.parent_content, d.filename,
               VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vector_score
        FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
        WHERE c.kb_id = ? AND c.chunk_type != 'parent'
        ORDER BY vector_score ASC FETCH FIRST ? ROWS ONLY
      `).all(qVecStr, kb.id, fetchK);
      results = rows.map((r) => ({ ...r, score: 1 - (r.vector_score || 0), match_type: 'vector' }));
    }

    if (mode === 'fulltext' || mode === 'hybrid') {
      const likeQ = `%${query.replace(/[%_]/g, '\\$&')}%`;
      const ftRows = await db.prepare(`
        SELECT c.id, c.content, c.parent_content, d.filename, 1 AS vector_score
        FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
        WHERE c.kb_id = ? AND c.chunk_type != 'parent' AND UPPER(c.content) LIKE UPPER(?)
        FETCH FIRST ? ROWS ONLY
      `).all(kb.id, likeQ, topK * 2);

      if (mode === 'fulltext') {
        results = ftRows.map((r) => ({ ...r, score: 0.8, match_type: 'fulltext' }));
      } else {
        const vecIds = new Set(results.map((r) => r.id));
        for (const r of ftRows) {
          if (vecIds.has(r.id)) {
            const ex = results.find((x) => x.id === r.id);
            if (ex) { ex.score = 0.95; ex.match_type = 'hybrid'; }
          } else {
            results.push({ ...r, score: 0.85, match_type: 'fulltext' });
          }
        }
      }
    }

    results = results.filter((r) => r.score >= thresh).sort((a, b) => b.score - a.score).slice(0, topK);

    res.json({
      kb_id: kb.id,
      kb_name: kb.name,
      query,
      results: results.map((r) => ({
        id:           r.id,
        content:      r.content,
        context:      r.parent_content || null,
        filename:     r.filename,
        score:        parseFloat(r.score.toFixed(4)),
        match_type:   r.match_type,
      })),
    });
  } catch (e) {
    console.error('[ExternalKB] Search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/v1/kb/chat ──────────────────────────────────────────────────────
// Single-turn: retrieve context from KB, then ask Gemini
router.post('/kb/chat', async (req, res) => {
  const db = getDb();
  const { kb_id, question, model } = req.body;
  if (!kb_id || !question?.trim()) {
    return res.status(400).json({ error: 'kb_id and question are required' });
  }

  try {
    const kb = await getAccessibleKb(db, kb_id, req.allowedKbIds);
    if (!kb) return res.status(404).json({ error: 'KB not found or not accessible' });

    // Reuse search logic inline (avoids HTTP round-trip)
    const { embedText, toVectorStr } = require('../services/kbEmbedding');
    const mode   = kb.retrieval_mode || 'hybrid';
    const topK   = Math.min(Number(kb.top_k_return) || 5, 20);
    const dims   = kb.embedding_dims || 768;
    const thresh = Number(kb.score_threshold) || 0;

    let results = [];

    if (mode === 'vector' || mode === 'hybrid') {
      const qEmb    = await embedText(question, { dims });
      const qVecStr = toVectorStr(qEmb);
      const rows = await db.prepare(`
        SELECT c.id, c.content, c.parent_content, d.filename,
               VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vector_score
        FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
        WHERE c.kb_id = ? AND c.chunk_type != 'parent'
        ORDER BY vector_score ASC FETCH FIRST ? ROWS ONLY
      `).all(qVecStr, kb.id, topK * 3);
      results = rows.map((r) => ({ ...r, score: 1 - (r.vector_score || 0) }));
    }

    if (mode === 'fulltext' || mode === 'hybrid') {
      const likeQ = `%${question.replace(/[%_]/g, '\\$&')}%`;
      const ftRows = await db.prepare(`
        SELECT c.id, c.content, c.parent_content, d.filename, 1 AS vector_score
        FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
        WHERE c.kb_id = ? AND c.chunk_type != 'parent' AND UPPER(c.content) LIKE UPPER(?)
        FETCH FIRST ? ROWS ONLY
      `).all(kb.id, likeQ, topK * 2);

      if (mode === 'fulltext') {
        results = ftRows.map((r) => ({ ...r, score: 0.8 }));
      } else {
        const vecIds = new Set(results.map((r) => r.id));
        for (const r of ftRows) {
          if (vecIds.has(r.id)) {
            const ex = results.find((x) => x.id === r.id);
            if (ex) ex.score = 0.95;
          } else {
            results.push({ ...r, score: 0.85 });
          }
        }
      }
    }

    results = results.filter((r) => r.score >= thresh).sort((a, b) => b.score - a.score).slice(0, topK);

    let context = '';
    if (results.length === 0) {
      context = `[知識庫「${kb.name}」未找到相關內容]`;
    } else {
      const chunks = results.map((r, i) => {
        const ctx = r.parent_content ? `上下文：${r.parent_content.slice(0, 300)}\n\n片段：` : '';
        return `[${i + 1}] 來源: ${r.filename} (相關度 ${(r.score * 100).toFixed(0)}%)\n${ctx}${r.content}`;
      });
      context = `【來自知識庫「${kb.name}」的相關內容】\n\n${chunks.join('\n\n---\n\n')}`;
    }

    // Call Gemini
    const { getGenerativeModel, extractText, extractUsage } = require('../services/geminiClient');
    const modelName = model || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash';
    const geminiModel = getGenerativeModel({ model: modelName });

    const prompt = `你是一個知識庫助手，請根據以下知識庫內容回答使用者的問題。若知識庫內容不足以回答，請說明。

${context}

使用者問題：${question}`;

    const result = await geminiModel.generateContent(prompt);
    const answer = extractText(result);
    const usage  = extractUsage(result);
    const inTok  = usage.inputTokens;
    const outTok = usage.outputTokens;

    // Record token usage under KB owner
    if ((inTok || outTok) && kb.created_by) {
      const today = new Date().toISOString().split('T')[0];
      upsertTokenUsage(getDb(), kb.created_by, today, modelName, inTok, outTok).catch(() => {});
    }

    res.json({
      kb_id:         kb.id,
      kb_name:       kb.name,
      question,
      answer,
      sources:       results.map((r) => ({ filename: r.filename, score: parseFloat(r.score.toFixed(4)) })),
      usage: {
        input_tokens:  inTok,
        output_tokens: outTok,
      },
    });
  } catch (e) {
    console.error('[ExternalKB] Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
