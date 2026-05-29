'use strict';

/**
 * PDF 轉 Word Skill Auto-Seed
 *
 * 啟動時 idempotent 註冊 / 升級 code skill「PDF 轉 Word」並**自動啟動**。
 *
 * 流程(2026-05-29 改為自動啟動):
 *  1. 從 disk 讀 skill_sources/pdf_to_docx.js → code_snippet
 *  2. INSERT/UPDATE skills row (code_status='running' + code_snippet)
 *  3. 立即 spawnRunner(不等 admin / 不等下次重啟 autoRestoreRunners)
 *  4. 失敗了 healthMonitor 30s 內會補 spawn(因 code_status='running')
 *
 * 為什麼自動啟動:
 *  - 此 skill 沒 npm 套件依賴(純 child_process spawn python),啟動瞬間完成,
 *    沒理由像 excel_query 那樣等 admin 點(那個要 npm install duckdb,~30s)
 *  - 使用者勾 skill UI 跟 admin 點啟動是兩件事,使用者勾了 ≠ skill 有跑;
 *    讓 admin 必須先點是 UX 大坑(使用者:「我都勾了為什麼說技能未啟動?」)
 *  - admin 仍可手動停(stop 後 code_status='stopped',下次 server 重啟 autoSeed
 *    會把它改回 'running' 並 spawn — 此為設計取捨,不要的 admin 直接刪 skill)
 *
 * chat.js 對齊 force-inject:有 PDF 附件就自動把 pdf_to_docx 注入 tools 清單。
 */

const fs = require('fs');
const path = require('path');

const SOURCE_FILE = path.join(__dirname, '../skill_sources/pdf_to_docx.js');

const SKILL_NAME = 'PDF 轉 Word';
const SKILL_VERSION = '2.0.0-phase2';

const DESCRIPTION =
  '將使用者上傳的 PDF 轉換為 Word (.docx)。提供兩種模式:' +
  'editable(pdf2docx,快,簡單 PDF 適用)/ vision(Gemini Vision 智能重組,保留複雜表格底色與合併儲存格)。' +
  '系統會自動依 PDF 複雜度建議模式(complexity ≥ 30 → vision)。' +
  '支援加密 PDF。使用者說「轉成 Word / 轉 docx / PDF 轉檔」時呼叫。';

const TOOL_SCHEMA = {
  name: 'pdf_to_docx',
  description:
    '將 PDF 轉換為 Word (.docx)。\n' +
    '系統會先 inspect PDF 拿到 `complexity_score`(0-100)+ `recommended_mode`(editable/vision)。\n' +
    '**模式選擇**:\n' +
    '- `format=\'auto\'`(預設):依 recommended_mode 自動選\n' +
    '- `format=\'editable\'`:pdf2docx,快(<10s,50 頁內),layout 可能跑掉但 100% 可編輯;簡單文字型 PDF 適用\n' +
    '- `format=\'vision\'`:Gemini Vision 智能重組,慢(每頁 3-5s,flash 20 頁內 / pro 10 頁內)且耗 token;**複雜表格 / 多底色 / 合併儲存格** 用這個\n' +
    '\n' +
    '**何時主動建議 vision**:使用者抱怨 editable 轉出來「格式跑掉 / 表格底色不見 / 行高怪」→ 建議改 vision 重做。\n' +
    '\n' +
    '**加密 PDF**:先呼叫一次不帶 password,系統會回 PASSWORD_REQUIRED;再請使用者提供密碼後帶入重呼。',
  parameters: {
    type: 'object',
    properties: {
      file_name: {
        type: 'string',
        description: '從 attached_files 中選一個 PDF 檔名(完整檔名最佳,系統會 fuzzy match;若對話只有一份 PDF 可省略)',
      },
      password: {
        type: 'string',
        description: '加密 PDF 的密碼。未加密則省略;使用者尚未提供時請省略,系統會回提示讓你詢問。',
      },
      format: {
        type: 'string',
        enum: ['auto', 'editable', 'vision'],
        description: '轉換模式:auto(依 complexity 自動,預設)/ editable(pdf2docx 快但可能跑版)/ vision(Gemini 智能重組保 layout)',
      },
      vision_model: {
        type: 'string',
        enum: ['flash', 'pro'],
        description: 'vision mode 用的 Gemini 模型:flash(預設,快且便宜)/ pro(高品質但慢且貴,使用者明確要求最高品質才用)',
      },
    },
    required: [],
  },
};

const TAGS = ['pdf', 'word', 'docx', '轉檔', '文件', '掃描', '加密'];
const ICON = '📄';
const CODE_PACKAGES = []; // 純內建模組 + spawn python,無 npm 依賴

async function autoSeedPdfToDocxSkill(db) {
  if (!db) {
    console.warn('[PdfToDocxSkillSeed] db not ready, skip');
    return;
  }

  let ownerId = null;
  try {
    const row = await db.prepare(
      `SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`
    ).get();
    ownerId = row?.id || row?.ID || null;
  } catch (_) {}

  // 讀 disk 上的 skill source(autoSeed 之後不必再等 syncSkillSources)
  let diskCode = null;
  try {
    diskCode = fs.readFileSync(SOURCE_FILE, 'utf8');
  } catch (e) {
    console.warn(`[PdfToDocxSkillSeed] skill_sources file 讀取失敗 (${SOURCE_FILE}):${e.message}`);
  }

  let existing;
  try {
    existing = await db.prepare(
      `SELECT id, description, type, code_packages, mcp_tool_mode, kb_mode, tool_schema, code_status, code_snippet
       FROM skills
       WHERE UPPER(name) = UPPER(?) OR UPPER(name) = UPPER('pdf_to_docx')`
    ).get(SKILL_NAME);
  } catch (e) {
    console.warn('[PdfToDocxSkillSeed] SELECT failed:', e.message);
    return;
  }

  const tagsJson = JSON.stringify(TAGS);
  const toolSchemaJson = JSON.stringify(TOOL_SCHEMA);
  const packagesJson = JSON.stringify(CODE_PACKAGES);

  let skillId = null;

  if (!existing) {
    try {
      // ⚠️ 自動啟動:INSERT 直接給 code_status='running' + code_snippet(從 disk)
      // 不再等 admin Code Runners UI 點啟動 — 此 skill 無 npm 依賴,啟動瞬間
      await db.prepare(`
        INSERT INTO skills
          (name, description, icon, type, tags, owner_user_id,
           is_public, is_admin_approved, endpoint_mode, tool_schema,
           code_packages, code_status, code_snippet, mcp_tool_mode, kb_mode)
        VALUES (?, ?, ?, 'code', ?, ?, 1, 1, 'tool', ?, ?, 'running', ?, 'disable', 'disable')
      `).run(
        SKILL_NAME, DESCRIPTION, ICON, tagsJson, ownerId,
        toolSchemaJson, packagesJson, diskCode
      );
      console.log(`[PdfToDocxSkillSeed] Created skill "${SKILL_NAME}" v${SKILL_VERSION} (code_status=running, will auto-spawn)`);
    } catch (e) {
      console.error('[PdfToDocxSkillSeed] INSERT failed:', e.message);
      return;
    }
    // 拿 INSERT 後的 skill id(Oracle 沒 SQLite-style lastInsertRowid,SELECT by name)
    try {
      const row = await db.prepare(
        `SELECT id FROM skills WHERE UPPER(name) = UPPER(?)`
      ).get(SKILL_NAME);
      skillId = row?.id || row?.ID;
    } catch (e) {
      console.warn(`[PdfToDocxSkillSeed] SELECT id-after-INSERT failed: ${e.message}`);
    }
  } else {
    // 既有 row:比對是否要升級 metadata
    const existingDesc = existing.description || existing.DESCRIPTION || '';
    const existingType = existing.type || existing.TYPE || '';
    const existingMcpMode = existing.mcp_tool_mode || existing.MCP_TOOL_MODE || 'append';
    const existingKbMode = existing.kb_mode || existing.KB_MODE || 'append';
    const existingSchema = existing.tool_schema || existing.TOOL_SCHEMA || '';
    const existingStatus = existing.code_status || existing.CODE_STATUS || 'stopped';
    const existingSnippet = existing.code_snippet || existing.CODE_SNIPPET || '';
    skillId = existing.id || existing.ID;

    let needsUpdate = false;
    if (existingDesc !== DESCRIPTION) needsUpdate = true;
    if (existingType !== 'code') needsUpdate = true;
    if (existingMcpMode !== 'disable' || existingKbMode !== 'disable') needsUpdate = true;
    // schema 變更也升級(欄位定義改變時)
    try {
      const eSchema = existingSchema ? JSON.parse(existingSchema) : null;
      if (JSON.stringify(eSchema) !== JSON.stringify(TOOL_SCHEMA)) needsUpdate = true;
    } catch (_) { needsUpdate = true; }
    // 把 stopped 改回 running(admin 手動停過也會被覆蓋 — 設計取捨,見檔頭註解)
    if (existingStatus !== 'running') needsUpdate = true;
    // code_snippet 跟 disk 不同 → 更新
    if (diskCode && existingSnippet !== diskCode) needsUpdate = true;

    if (needsUpdate) {
      try {
        // 注意:code_snippet / code_status 一起更新讓 spawnRunner 拿到最新版
        await db.prepare(`
          UPDATE skills
          SET description=?, tags=?, tool_schema=?, icon=?, type='code',
              code_packages=?, is_admin_approved=1, endpoint_mode='tool',
              mcp_tool_mode='disable', kb_mode='disable',
              code_status='running'${diskCode ? ', code_snippet=?' : ''}
          WHERE id=?
        `).run(
          DESCRIPTION, tagsJson, toolSchemaJson, ICON, packagesJson,
          ...(diskCode ? [diskCode] : []),
          skillId
        );
        console.log(`[PdfToDocxSkillSeed] Upgraded "${SKILL_NAME}" v${SKILL_VERSION} (code_status→running)`);
      } catch (e) {
        console.error('[PdfToDocxSkillSeed] UPDATE failed:', e.message);
      }
    }
  }

  // ── 立即啟動 ─────────────────────────────────────────────────────────────────
  // 不依賴 autoRestoreRunners 順序(seed 通常跑在 autoRestoreRunners 之後)
  if (skillId && diskCode) {
    try {
      const skillRunner = require('./skillRunner');
      const status = skillRunner.getStatus(skillId);
      if (status.running) {
        // 已經在跑 — hot-reload code(內部會比 hash,沒變不重啟)
        console.log(`[PdfToDocxSkillSeed] skill #${skillId} already running (port=${status.port}), code 同步交給 healthMonitor hot-reload`);
      } else {
        skillRunner.saveCode(skillId, diskCode);
        await skillRunner.spawnRunner({ id: skillId, name: SKILL_NAME, code_snippet: diskCode }, db);
        console.log(`[PdfToDocxSkillSeed] auto-spawned skill #${skillId}`);
      }
    } catch (e) {
      console.error(`[PdfToDocxSkillSeed] auto-spawn failed: ${e.message}(healthMonitor 30s 內會補)`);
    }
  }
}

module.exports = {
  autoSeedPdfToDocxSkill,
  SKILL_NAME,
  SKILL_VERSION,
};
