'use strict';

/**
 * PDF 轉 Word Skill Auto-Seed
 *
 * 啟動時 idempotent 註冊 / 升級 code skill「PDF 轉 Word」。
 *
 * 流程:
 *  1. 此 seed 跑 → INSERT skills row (code_status='stopped', code_snippet=null)
 *  2. server 啟動的 syncSkillSources 把 skill_sources/pdf_to_docx.js → 寫入 code_snippet
 *  3. admin 在 Code Runners UI 點「啟動」(此 skill 沒 npm 套件,啟動超快)
 *  4. 後續每個 pod 啟動時 autoRestoreRunners 自動 spawn
 *
 * 不像 excel_query 需要 force-inject(LLM 看到 xlsx attach 自動帶 skill),
 * 這個 skill 純靠 description / tool schema 讓 LLM 自然 tool-call。
 * 若希望 PDF attach 自動 inject 此 skill,類似 excel 那段邏輯也可加在 chat.js;
 * 但因 PDF 用途多(轉 Word 只是其中之一),預設不強制注入,讓使用者明確說想轉檔。
 */

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

  let existing;
  try {
    existing = await db.prepare(
      `SELECT id, description, type, code_packages, mcp_tool_mode, kb_mode, tool_schema
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

  if (!existing) {
    try {
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
        `[PdfToDocxSkillSeed] Created code skill "${SKILL_NAME}" v${SKILL_VERSION} ` +
        `(code_status=stopped, admin 須在 Code Runners UI 點「啟動」)`
      );
    } catch (e) {
      console.error('[PdfToDocxSkillSeed] INSERT failed:', e.message);
    }
    return;
  }

  // 既有 row:比對是否要升級 metadata
  const existingDesc = existing.description || existing.DESCRIPTION || '';
  const existingType = existing.type || existing.TYPE || '';
  const existingMcpMode = existing.mcp_tool_mode || existing.MCP_TOOL_MODE || 'append';
  const existingKbMode = existing.kb_mode || existing.KB_MODE || 'append';
  const existingSchema = existing.tool_schema || existing.TOOL_SCHEMA || '';

  let needsUpdate = false;
  if (existingDesc !== DESCRIPTION) needsUpdate = true;
  if (existingType !== 'code') needsUpdate = true;
  if (existingMcpMode !== 'disable' || existingKbMode !== 'disable') needsUpdate = true;
  // schema 變更也升級(欄位定義改變時)
  try {
    const eSchema = existingSchema ? JSON.parse(existingSchema) : null;
    if (JSON.stringify(eSchema) !== JSON.stringify(TOOL_SCHEMA)) needsUpdate = true;
  } catch (_) { needsUpdate = true; }

  if (!needsUpdate) return;

  try {
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
    console.log(`[PdfToDocxSkillSeed] Upgraded "${SKILL_NAME}" metadata to v${SKILL_VERSION}`);
  } catch (e) {
    console.error('[PdfToDocxSkillSeed] UPDATE failed:', e.message);
  }
}

module.exports = {
  autoSeedPdfToDocxSkill,
  SKILL_NAME,
  SKILL_VERSION,
};
