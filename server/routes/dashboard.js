/**
 * AI 戰情 Routes — /api/dashboard
 *
 * 權限：
 *   verifyToken              — 所有人
 *   can_use_ai_dashboard     — 查詢功能
 *   can_design_ai_select     — Schema / Topic / Design / ETL 設計功能
 *   admin                    — 全部
 */
const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

router.use(verifyToken);

// ─── Permission middleware ────────────────────────────────────────────────────
function requireDashboard(req, res, next) {
  const u = req.user;
  if (u.role === 'admin' || u.can_use_ai_dashboard == 1) return next();
  return res.status(403).json({ error: '無 AI 戰情查詢權限' });
}

function requireDesigner(req, res, next) {
  const u = req.user;
  if (u.role === 'admin' || u.can_design_ai_select == 1) return next();
  return res.status(403).json({ error: '無 AI 戰情設計權限' });
}

// ─── Topics ──────────────────────────────────────────────────────────────────

// GET /api/dashboard/topics — 主題清單（含子任務）
router.get('/topics', requireDashboard, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const topics = await db.prepare(
      `SELECT * FROM ai_select_topics WHERE is_active=1 ORDER BY sort_order ASC, id ASC`
    ).all();

    const designs = await db.prepare(
      `SELECT id, topic_id, name, description, vector_search_enabled, chart_config,
              is_public, created_by
       FROM ai_select_designs
       ORDER BY id ASC`
    ).all();

    const designMap = {};
    for (const d of designs) {
      if (!designMap[d.topic_id]) designMap[d.topic_id] = [];
      designMap[d.topic_id].push(d);
    }

    res.json(topics.map(t => ({ ...t, designs: designMap[t.id] || [] })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/topics
router.post('/designer/topics', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description, icon, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: '主題名稱為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_select_topics (name, description, icon, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(name, description || null, icon || null, sort_order || 0, req.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/topics/:id
router.put('/designer/topics/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description, icon, sort_order, is_active } = req.body;
    await db.prepare(
      `UPDATE ai_select_topics SET name=?, description=?, icon=?, sort_order=?, is_active=? WHERE id=?`
    ).run(name, description || null, icon || null, sort_order ?? 0, is_active ?? 1, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/designer/topics/:id
router.delete('/designer/topics/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_select_topics WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Designs ─────────────────────────────────────────────────────────────────

// GET /api/dashboard/designer/designs/:id
router.get('/designer/designs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const d = await db.prepare(`SELECT * FROM ai_select_designs WHERE id=?`).get(req.params.id);
    if (!d) return res.status(404).json({ error: '不存在' });
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/designs
router.post('/designer/designs', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const {
      topic_id, name, description, target_schema_ids, vector_search_enabled,
      system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public
    } = req.body;
    if (!topic_id || !name) return res.status(400).json({ error: '主題與名稱為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_select_designs
         (topic_id, name, description, target_schema_ids, vector_search_enabled,
          system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      topic_id, name, description || null,
      target_schema_ids ? JSON.stringify(target_schema_ids) : null,
      vector_search_enabled ? 1 : 0,
      system_prompt || null,
      few_shot_examples ? JSON.stringify(few_shot_examples) : null,
      chart_config ? JSON.stringify(chart_config) : null,
      cache_ttl_minutes || 30,
      is_public ? 1 : 0,
      req.user.id
    );
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/designs/:id
router.put('/designer/designs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const {
      topic_id, name, description, target_schema_ids, vector_search_enabled,
      system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public
    } = req.body;
    await db.prepare(
      `UPDATE ai_select_designs SET
         topic_id=?, name=?, description=?, target_schema_ids=?, vector_search_enabled=?,
         system_prompt=?, few_shot_examples=?, chart_config=?, cache_ttl_minutes=?, is_public=?,
         updated_at=SYSTIMESTAMP
       WHERE id=?`
    ).run(
      topic_id, name, description || null,
      target_schema_ids ? JSON.stringify(target_schema_ids) : null,
      vector_search_enabled ? 1 : 0,
      system_prompt || null,
      few_shot_examples ? JSON.stringify(few_shot_examples) : null,
      chart_config ? JSON.stringify(chart_config) : null,
      cache_ttl_minutes || 30,
      is_public ? 1 : 0,
      req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/designer/designs/:id
router.delete('/designer/designs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_select_designs WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Schema 知識庫 ────────────────────────────────────────────────────────────

// GET /api/dashboard/designer/schemas
router.get('/designer/schemas', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const schemas = await db.prepare(
      `SELECT * FROM ai_schema_definitions ORDER BY id ASC`
    ).all();
    const columns = await db.prepare(
      `SELECT * FROM ai_schema_columns ORDER BY schema_id ASC, id ASC`
    ).all();
    const colMap = {};
    for (const c of columns) {
      if (!colMap[c.schema_id]) colMap[c.schema_id] = [];
      colMap[c.schema_id].push(c);
    }
    res.json(schemas.map(s => ({ ...s, columns: colMap[s.id] || [] })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/schemas
router.post('/designer/schemas', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { table_name, display_name, db_connection, business_notes, join_hints, columns } = req.body;
    if (!table_name) return res.status(400).json({ error: 'table_name 為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_schema_definitions (table_name, display_name, db_connection, business_notes, join_hints, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      table_name, display_name || null, db_connection || 'erp',
      business_notes || null,
      join_hints ? JSON.stringify(join_hints) : null,
      req.user.id
    );
    const schemaId = r.lastInsertRowid;

    if (columns && Array.isArray(columns)) {
      for (const col of columns) {
        await db.prepare(
          `INSERT INTO ai_schema_columns
             (schema_id, column_name, data_type, description, is_vectorized, value_mapping, sample_values)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          schemaId, col.column_name, col.data_type || null, col.description || null,
          col.is_vectorized ? 1 : 0,
          col.value_mapping ? JSON.stringify(col.value_mapping) : null,
          col.sample_values ? JSON.stringify(col.sample_values) : null
        );
      }
    }
    res.json({ id: schemaId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/schemas/:id
router.put('/designer/schemas/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { table_name, display_name, db_connection, business_notes, join_hints, is_active } = req.body;
    await db.prepare(
      `UPDATE ai_schema_definitions SET
         table_name=?, display_name=?, db_connection=?, business_notes=?, join_hints=?, is_active=?,
         updated_at=SYSTIMESTAMP
       WHERE id=?`
    ).run(
      table_name, display_name || null, db_connection || 'erp',
      business_notes || null,
      join_hints ? JSON.stringify(join_hints) : null,
      is_active ?? 1,
      req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/schemas/:id/columns — 整批更新欄位 metadata
router.put('/designer/schemas/:id/columns', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { columns } = req.body;
    await db.prepare(`DELETE FROM ai_schema_columns WHERE schema_id=?`).run(req.params.id);
    if (columns && Array.isArray(columns)) {
      for (const col of columns) {
        await db.prepare(
          `INSERT INTO ai_schema_columns
             (schema_id, column_name, data_type, description, is_vectorized, value_mapping, sample_values)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          req.params.id, col.column_name, col.data_type || null, col.description || null,
          col.is_vectorized ? 1 : 0,
          col.value_mapping ? JSON.stringify(col.value_mapping) : null,
          col.sample_values ? JSON.stringify(col.sample_values) : null
        );
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/designer/schemas/:id
router.delete('/designer/schemas/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_schema_definitions WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/schemas/import-oracle
// 從 Oracle ERP ALL_TAB_COLUMNS 批次匯入多個 table 的欄位定義
router.post('/designer/schemas/import-oracle', requireDesigner, async (req, res) => {
  const { table_names, owner = 'APPS', db_connection = 'erp' } = req.body;
  if (!Array.isArray(table_names) || table_names.length === 0)
    return res.status(400).json({ error: 'table_names 為必填陣列' });

  // 驗證 table names：只允許大寫英數字母、底線、$（Oracle 規範）
  const NAME_RE = /^[A-Z0-9_$]+$/i;
  const safeTables = table_names
    .map(t => t.trim().toUpperCase())
    .filter(t => NAME_RE.test(t));
  if (safeTables.length === 0)
    return res.status(400).json({ error: 'table_names 格式不合法' });

  try {
    const { db } = require('../database-oracle');
    // 使用 dashboardService 的 ReadOnlyPoolProxy，確保只能 SELECT
    const erpPool = await require('../services/dashboardService').getErpPool();

    // 單一 SQL 查所有 table 的欄位（含 Oracle comment）
    const inList = safeTables.map(t => `'${t}'`).join(',');
    const sql = `
      SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE,
             c.DATA_LENGTH, c.DATA_PRECISION, c.DATA_SCALE,
             c.NULLABLE, cc.COMMENTS
      FROM   ALL_TAB_COLUMNS c
      LEFT JOIN ALL_COL_COMMENTS cc
             ON cc.OWNER = c.OWNER
            AND cc.TABLE_NAME = c.TABLE_NAME
            AND cc.COLUMN_NAME = c.COLUMN_NAME
      WHERE  c.OWNER = :owner
        AND  c.TABLE_NAME IN (${inList})
      ORDER BY c.TABLE_NAME, c.COLUMN_ID
    `;

    const conn = await erpPool.getConnection();
    let rows;
    try {
      const result = await conn.execute(sql, { owner: owner.toUpperCase() });
      rows = result.rows;
    } finally {
      await conn.close();
    }

    // 依 TABLE_NAME 分組
    const byTable = {};
    for (const r of rows) {
      const [tname, colName, dataType, dataLen, dataPre, dataSca, nullable, comments] = r;
      if (!byTable[tname]) byTable[tname] = [];
      // 組合完整型態字串 e.g. NUMBER(10,2) / VARCHAR2(200)
      let typeStr = dataType;
      if (dataType === 'NUMBER' && dataPre != null) typeStr = `NUMBER(${dataPre}${dataSca ? ',' + dataSca : ''})`;
      else if (dataType === 'VARCHAR2' || dataType === 'CHAR') typeStr = `${dataType}(${dataLen})`;
      byTable[tname].push({ column_name: colName, data_type: typeStr, description: comments || null });
    }

    const imported = [];
    const skipped = [];

    for (const tname of safeTables) {
      if (!byTable[tname]) { skipped.push(tname); continue; }

      // Upsert ai_schema_definitions（若已存在則取既有 id）
      let existing = await db.prepare(
        `SELECT id FROM ai_schema_definitions WHERE table_name=? AND db_connection=?`
      ).get(tname, db_connection);

      let schemaId;
      if (existing) {
        schemaId = existing.id;
        // 更新 updated_at
        await db.prepare(
          `UPDATE ai_schema_definitions SET updated_at=SYSTIMESTAMP WHERE id=?`
        ).run(schemaId);
      } else {
        const r = await db.prepare(
          `INSERT INTO ai_schema_definitions (table_name, display_name, db_connection, created_by)
           VALUES (?, ?, ?, ?)`
        ).run(tname, tname, db_connection, req.user.id);
        schemaId = r.lastInsertRowid;
      }

      // 清除舊欄位，整批重建
      await db.prepare(`DELETE FROM ai_schema_columns WHERE schema_id=?`).run(schemaId);

      for (const col of byTable[tname]) {
        await db.prepare(
          `INSERT INTO ai_schema_columns (schema_id, column_name, data_type, description)
           VALUES (?, ?, ?, ?)`
        ).run(schemaId, col.column_name, col.data_type, col.description);
      }

      imported.push({ table: tname, columns: byTable[tname].length, schema_id: schemaId });
    }

    res.json({ imported, skipped, total_tables: safeTables.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ETL Jobs ─────────────────────────────────────────────────────────────────

// GET /api/dashboard/etl/jobs
router.get('/etl/jobs', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const jobs = await db.prepare(
      `SELECT j.*,
              (SELECT COUNT(*) FROM ai_etl_run_logs l WHERE l.job_id=j.id) AS run_count
       FROM ai_etl_jobs j ORDER BY j.id ASC`
    ).all();
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/etl/jobs
router.post('/etl/jobs', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const {
      name, source_sql, source_connection, vectorize_fields, metadata_fields,
      embedding_dimension, cron_expression, is_incremental
    } = req.body;
    if (!name || !source_sql) return res.status(400).json({ error: '名稱與 source_sql 為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_etl_jobs
         (name, source_sql, source_connection, vectorize_fields, metadata_fields,
          embedding_dimension, cron_expression, is_incremental, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name, source_sql, source_connection || 'erp',
      vectorize_fields ? JSON.stringify(vectorize_fields) : null,
      metadata_fields ? JSON.stringify(metadata_fields) : null,
      embedding_dimension || 768,
      cron_expression || null,
      is_incremental ? 1 : 0,
      req.user.id
    );
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/etl/jobs/:id
router.put('/etl/jobs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const {
      name, source_sql, source_connection, vectorize_fields, metadata_fields,
      embedding_dimension, cron_expression, is_incremental, status
    } = req.body;
    await db.prepare(
      `UPDATE ai_etl_jobs SET
         name=?, source_sql=?, source_connection=?, vectorize_fields=?, metadata_fields=?,
         embedding_dimension=?, cron_expression=?, is_incremental=?, status=?
       WHERE id=?`
    ).run(
      name, source_sql, source_connection || 'erp',
      vectorize_fields ? JSON.stringify(vectorize_fields) : null,
      metadata_fields ? JSON.stringify(metadata_fields) : null,
      embedding_dimension || 768,
      cron_expression || null,
      is_incremental ? 1 : 0,
      status || 'active',
      req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/etl/jobs/:id
router.delete('/etl/jobs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_etl_jobs WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/etl/jobs/:id/run — 立即執行
router.post('/etl/jobs/:id/run', requireDesigner, async (req, res) => {
  try {
    const { runEtlJob } = require('../services/dashboardService');
    runEtlJob(Number(req.params.id)).catch(e => console.error('[ETL] manual run error:', e.message));
    res.json({ ok: true, message: 'ETL job 已排入執行佇列' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dashboard/etl/jobs/:id/logs
router.get('/etl/jobs/:id/logs', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const logs = await db.prepare(
      `SELECT * FROM ai_etl_run_logs WHERE job_id=? ORDER BY id DESC FETCH FIRST 50 ROWS ONLY`
    ).all(req.params.id);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI 查詢 (SSE Streaming) ──────────────────────────────────────────────────

// POST /api/dashboard/query
router.post('/query', requireDashboard, async (req, res) => {
  const { design_id, question } = req.body;
  if (!design_id || !question?.trim()) {
    return res.status(400).json({ error: 'design_id 與 question 為必填' });
  }

  const isDesigner = req.user.role === 'admin' || req.user.can_design_ai_select == 1;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { runDashboardQuery } = require('../services/dashboardService');
    await runDashboardQuery({
      designId: Number(design_id),
      question: question.trim(),
      userId: req.user.id,
      isDesigner,
      send,
    });
  } catch (e) {
    send('error', { message: e.message });
  } finally {
    send('done', {});
    res.end();
  }
});

// POST /api/dashboard/query/invalidate-cache — 清除指定 design 的快取
router.post('/query/invalidate-cache', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { design_id } = req.body;
    if (design_id) {
      await db.prepare(`DELETE FROM ai_query_cache WHERE design_id=?`).run(design_id);
    } else {
      await db.prepare(`DELETE FROM ai_query_cache WHERE expires_at < SYSTIMESTAMP`).run();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
