'use strict';

/**
 * ERP Tool ⇄ Skills 代理 row 同步
 *
 * 每個 erp_tools row 對應一筆 skills row (type='erp_proc'),
 * 讓既有 chat.js tool-calling / TAG router / session 掛載機制直接復用。
 *
 * 同步欄位:name / description / tags / tool_schema_json
 * 代理 row 特徵:
 *   - type = 'erp_proc'
 *   - erp_tool_id = 對應 erp_tools.id
 *   - is_public = 1(預設給所有人看,用 skill_access 精細管制)
 *   - endpoint_mode = 'tool'(非 inject/answer/post_answer,確保登錄為 Gemini function)
 */

const ICON = '🛢️';

function extractRowValue(row, key) {
  if (row == null) return null;
  return row[key] ?? row[key.toUpperCase()] ?? null;
}

async function createProxySkill(db, erpTool, createdBy) {
  const toolSchema = erpTool.tool_schema_json
    ? (typeof erpTool.tool_schema_json === 'string' ? erpTool.tool_schema_json : JSON.stringify(erpTool.tool_schema_json))
    : JSON.stringify(erpTool.tool_schema || {});
  const tags = erpTool.tags_json
    ? (typeof erpTool.tags_json === 'string' ? erpTool.tags_json : JSON.stringify(erpTool.tags_json))
    : JSON.stringify(Array.isArray(erpTool.tags) ? erpTool.tags : []);

  const ins = await db.prepare(`
    INSERT INTO skills
      (name, description, icon, type, tool_schema, tags,
       is_public, is_admin_approved, owner_user_id, erp_tool_id, endpoint_mode)
    VALUES (?, ?, ?, 'erp_proc', ?, ?, 1, 1, ?, ?, 'tool')
  `).run(
    erpTool.name,
    erpTool.description || null,
    ICON,
    toolSchema,
    tags,
    createdBy || null,
    erpTool.id
  );
  const skillId = ins.lastInsertRowid;
  await db.prepare(`UPDATE erp_tools SET proxy_skill_id = ? WHERE id = ?`).run(skillId, erpTool.id);
  return skillId;
}

async function updateProxySkill(db, erpTool) {
  const toolSchema = erpTool.tool_schema_json
    ? (typeof erpTool.tool_schema_json === 'string' ? erpTool.tool_schema_json : JSON.stringify(erpTool.tool_schema_json))
    : JSON.stringify(erpTool.tool_schema || {});
  const tags = erpTool.tags_json
    ? (typeof erpTool.tags_json === 'string' ? erpTool.tags_json : JSON.stringify(erpTool.tags_json))
    : JSON.stringify(Array.isArray(erpTool.tags) ? erpTool.tags : []);

  let proxySkillId = erpTool.proxy_skill_id;
  if (!proxySkillId) {
    // 找看看有沒有現存的 proxy(舊資料)
    const row = await db.prepare(`SELECT id FROM skills WHERE erp_tool_id = ?`).get(erpTool.id);
    proxySkillId = row ? extractRowValue(row, 'id') : null;
  }

  if (!proxySkillId) {
    return await createProxySkill(db, erpTool, erpTool.created_by);
  }

  await db.prepare(`
    UPDATE skills
    SET name = ?, description = ?, tool_schema = ?, tags = ?, icon = ?,
        type = 'erp_proc', endpoint_mode = 'tool', is_public = 1, is_admin_approved = 1
    WHERE id = ?
  `).run(
    erpTool.name, erpTool.description || null, toolSchema, tags, ICON,
    proxySkillId
  );
  return proxySkillId;
}

async function deleteProxySkill(db, erpToolId) {
  const row = await db.prepare(`SELECT proxy_skill_id FROM erp_tools WHERE id = ?`).get(erpToolId);
  const proxyId = row ? (extractRowValue(row, 'proxy_skill_id')) : null;
  if (proxyId) {
    try {
      await db.prepare(`DELETE FROM skills WHERE id = ?`).run(proxyId);
    } catch (e) {
      console.warn('[ErpProxySkill] delete proxy skill failed:', e.message);
    }
  }
}

/**
 * Backfill:為所有還沒有 proxy_skill_id 的 erp_tools 建代理 row
 */
async function backfillAll(db) {
  try {
    const rows = await db.prepare(`
      SELECT * FROM erp_tools
      WHERE proxy_skill_id IS NULL
    `).all();
    if (!rows || rows.length === 0) return 0;
    let created = 0;
    for (const r of rows) {
      try {
        const erpTool = {
          id: extractRowValue(r, 'id'),
          name: extractRowValue(r, 'name'),
          description: extractRowValue(r, 'description'),
          tool_schema_json: extractRowValue(r, 'tool_schema_json'),
          tags_json: extractRowValue(r, 'tags'),
          created_by: extractRowValue(r, 'created_by'),
        };
        await createProxySkill(db, erpTool, erpTool.created_by);
        created++;
      } catch (e) {
        console.warn(`[ErpProxySkill] backfill id=${extractRowValue(r, 'id')} failed:`, e.message);
      }
    }
    if (created > 0) console.log(`[ErpProxySkill] Backfilled ${created} proxy skill rows`);
    return created;
  } catch (e) {
    console.warn('[ErpProxySkill] backfillAll failed:', e.message);
    return 0;
  }
}

module.exports = {
  createProxySkill,
  updateProxySkill,
  deleteProxySkill,
  backfillAll,
};
