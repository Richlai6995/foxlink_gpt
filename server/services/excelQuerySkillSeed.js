'use strict';

/**
 * Excel Query Skill Auto-Seed
 *
 * 啟動時 idempotent 註冊 / 升級 code 技能 `Excel 精確查詢`,
 * 用 DuckDB 對使用者上傳的 xlsx 跑精確 SQL,避免 LLM 估算數字。
 *
 * 流程:
 *  1. 此 seed 第一次跑 → INSERT skills row(code_status='stopped',code_snippet=null)
 *  2. server 啟動的 syncSkillSources 把 skill_sources/excel_query.js → 寫入 code_snippet
 *  3. admin 在 Code Runners UI 點「啟動」→ installPackages(duckdb, xlsx) + spawnRunner
 *  4. 之後每個 pod 啟動時 autoRestoreRunners 自動 spawn
 *  5. chat.js 偵測到 session 有 xlsx → 強制 inject 此 skill 給 LLM 看
 *
 * 第一次部署需要 admin 手動點「啟動」(觸發 npm install duckdb)。
 * 之後 deploy 走 hot-reload 就自動同步,不用再點。
 */

const SKILL_NAME = 'Excel 精確查詢';
const SKILL_VERSION = '1.0.0';

const DESCRIPTION =
  '對使用者上傳的 Excel(.xlsx/.xls)執行 DuckDB SQL 取得精確結果。' +
  '任何彙總、排序、Top N、篩選、groupby、加總、平均、計數,都必須呼叫此工具,' +
  '不可從預覽資料估算或推測數字。';

const TOOL_SCHEMA = {
  name: 'excel_query',
  description:
    '對使用者上傳的 Excel 執行 DuckDB SQL 取得精確結果。' +
    '凡是涉及數值彙總、排序、Top N、篩選、groupby 的問題都必須呼叫此工具,絕不自行估算。' +
    '主工作表別名永遠是 t,可直接 FROM t。欄位名含中文/空格時用雙引號。',
  parameters: {
    type: 'object',
    properties: {
      file_name: {
        type: 'string',
        description: '從 attached_files 中選一個檔名(完整檔名最佳,系統會 fuzzy match)',
      },
      sheet_name: {
        type: 'string',
        description: '工作表名稱,留空 = 第一個有資料的工作表(會被別名為 t)',
      },
      sql: {
        type: 'string',
        description:
          'DuckDB SQL。主工作表別名為 t,其他工作表用 sanitized 名。' +
          '範例: SELECT "客戶專案代碼", SUM("營收總計") AS rev FROM t GROUP BY 1 ORDER BY rev DESC LIMIT 10',
      },
    },
    required: ['file_name', 'sql'],
  },
};

const TAGS = ['excel', 'xlsx', '報表', '損益表', '排序', 'top', 'groupby', '彙總', 'SQL'];
const ICON = '📊';
const CODE_PACKAGES = ['duckdb', 'xlsx'];

async function autoSeedExcelQuerySkill(db) {
  if (!db) {
    console.warn('[ExcelQuerySkillSeed] db not ready, skip');
    return;
  }

  // 找一個 admin 當 owner
  let ownerId = null;
  try {
    const row = await db.prepare(
      `SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`
    ).get();
    ownerId = row?.id || row?.ID || null;
  } catch (_) {}

  // 偵測既有 row(idempotent)
  let existing;
  try {
    existing = await db.prepare(
      `SELECT id, description, type, code_packages, mcp_tool_mode, kb_mode
       FROM skills
       WHERE UPPER(name) = UPPER(?) OR UPPER(name) = UPPER('excel_query')`
    ).get(SKILL_NAME);
  } catch (e) {
    console.warn('[ExcelQuerySkillSeed] SELECT failed:', e.message);
    return;
  }

  const tagsJson = JSON.stringify(TAGS);
  const toolSchemaJson = JSON.stringify(TOOL_SCHEMA);
  const packagesJson = JSON.stringify(CODE_PACKAGES);

  if (!existing) {
    try {
      // mcp_tool_mode=disable + kb_mode=disable:此 skill 純做 SQL,不需要任何
      // MCP 工具 / 知識庫,使用者只勾此 skill 時不應該被塞 12 個 MCP + 29 個 KB。
      await db.prepare(`
        INSERT INTO skills
          (name, description, icon, type, tags, owner_user_id,
           is_public, is_admin_approved, endpoint_mode, tool_schema,
           code_packages, code_status, mcp_tool_mode, kb_mode)
        VALUES (?, ?, ?, 'code', ?, ?, 1, 1, 'tool', ?, ?, 'stopped', 'disable', 'disable')
      `).run(
        SKILL_NAME, DESCRIPTION, ICON, tagsJson, ownerId,
        toolSchemaJson, packagesJson
      );
      console.log(
        `[ExcelQuerySkillSeed] Created code skill "${SKILL_NAME}" v${SKILL_VERSION} ` +
        `(code_status=stopped, admin 須在 Code Runners UI 點「啟動」觸發 npm install duckdb,xlsx)`
      );
    } catch (e) {
      console.error('[ExcelQuerySkillSeed] INSERT failed:', e.message);
    }
    return;
  }

  // 既有 row — 比對是否需要升級
  const existingDesc = existing.description || existing.DESCRIPTION || '';
  const existingPkgs = existing.code_packages || existing.CODE_PACKAGES || '';
  const existingType = existing.type || existing.TYPE || '';

  let needsUpdate = false;
  if (existingDesc !== DESCRIPTION) needsUpdate = true;
  if (existingType !== 'code') needsUpdate = true;
  // 比 packages(可能 CLOB,先 normalize)
  try {
    const ePkgs = existingPkgs ? JSON.parse(existingPkgs) : [];
    if (JSON.stringify((ePkgs || []).sort()) !== JSON.stringify([...CODE_PACKAGES].sort())) {
      needsUpdate = true;
    }
  } catch (_) { needsUpdate = true; }

  // 一次性 migration:既有 row 若 mcp_tool_mode/kb_mode 還是預設 append,
  // 就改成 disable(此 skill 純做 SQL,沒這個會被塞一堆 MCP/KB,浪費 token + 嚇使用者)
  const existingMcpMode = existing.mcp_tool_mode || existing.MCP_TOOL_MODE || 'append';
  const existingKbMode = existing.kb_mode || existing.KB_MODE || 'append';
  const needsModeFix = existingMcpMode !== 'disable' || existingKbMode !== 'disable';
  if (needsModeFix) needsUpdate = true;

  if (!needsUpdate) return;

  try {
    // 升級不動 code_status / code_snippet — 尊重 admin 已啟動的 runner;
    // 只更新 metadata。code_snippet 會由 syncSkillSources 從 git 帶進。
    await db.prepare(`
      UPDATE skills
      SET description=?, tags=?, tool_schema=?, icon=?, type='code',
          code_packages=?, is_admin_approved=1, endpoint_mode='tool',
          mcp_tool_mode='disable', kb_mode='disable'
      WHERE id=?
    `).run(
      DESCRIPTION, tagsJson, toolSchemaJson, ICON, packagesJson,
      existing.id || existing.ID
    );
    console.log(
      `[ExcelQuerySkillSeed] Upgraded "${SKILL_NAME}" metadata to v${SKILL_VERSION}` +
      (needsModeFix ? ` (also forced mcp_tool_mode=kb_mode=disable, was mcp=${existingMcpMode} kb=${existingKbMode})` : '')
    );
  } catch (e) {
    console.error('[ExcelQuerySkillSeed] UPDATE failed:', e.message);
  }
}

module.exports = {
  autoSeedExcelQuerySkill,
  SKILL_NAME,
  SKILL_VERSION,
};
