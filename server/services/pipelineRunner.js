'use strict';

/**
 * Pipeline Runner
 * Executes a sequence of nodes after the main AI response is generated.
 *
 * Node types:
 *   skill        — call a skill with input text
 *   mcp          — call an MCP tool with arg interpolation
 *   kb           — search a knowledge base
 *   ai           — additional AI call (chain)
 *   generate_file — generate pdf/xlsx/docx/mp3/etc from text
 *   condition    — if/else branching (text contains or ai_judge)
 *   parallel     — run multiple nodes concurrently
 *   db_write     — write structured JSON to whitelisted DB table (admin / pipeline_admin only)
 *   kb_write     — chunk + embed JSON items into a KB (uses existing KB share permissions)
 *   alert        — evaluate a rule (threshold/historical_avg/rate_change/zscore) and dispatch
 *                   alerts (alert_history / Email / Webex / Webhook) with cooldown
 *
 * Variable interpolation: {{ai_output}}, {{node_<id>_output}}, {{date}}, {{task_name}}
 */

const path = require('path');
const fs   = require('fs');

// ── Variable interpolation ────────────────────────────────────────────────────
function interpolate(template, vars) {
  if (!template) return '';
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const k = key.trim();
    return vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : `{{${k}}}`;
  });
}

function buildVars(aiOutput, nodeOutputs, taskName, extraVars) {
  const today = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-');
  const vars = {
    ai_output: aiOutput,
    date: today,
    task_name: taskName || '',
  };
  for (const [id, out] of Object.entries(nodeOutputs)) {
    vars[`node_${id}_output`] = out ?? '';
  }
  // extraVars(scheduledTaskService 帶下來的 cross-stage 資料,目前用於 __url_whitelist__)—
  // node 不該蓋掉 ai_output / date / task_name,所以放在最後 merge,但 caller 也別亂設這 3 個 reserved key
  if (extraVars && typeof extraVars === 'object') {
    for (const [k, v] of Object.entries(extraVars)) {
      if (vars[k] === undefined) vars[k] = v;
    }
  }
  return vars;
}

// ── Node executors ─────────────────────────────────────────────────────────────

async function execSkill(node, vars, db, context) {
  const { userId, sessionId } = context;
  const input = interpolate(node.input || '{{ai_output}}', vars);

  // 先撈 user 組織欄位，skill_access 檢查含組織/廠區層
  const u = await db.prepare(
    `SELECT role, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?`
  ).get(userId ?? 0) || {};

  const skill = await db.prepare(
    `SELECT * FROM skills
     WHERE UPPER(name)=UPPER(?)
       AND (owner_user_id=? OR is_public=1
            OR EXISTS (SELECT 1 FROM skill_access sa WHERE sa.skill_id=skills.id
              AND ((sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
               OR  (sa.grantee_type='role' AND sa.grantee_id=?)
               OR  (sa.grantee_type='dept'          AND sa.grantee_id=? AND ? IS NOT NULL)
               OR  (sa.grantee_type='profit_center' AND sa.grantee_id=? AND ? IS NOT NULL)
               OR  (sa.grantee_type='org_section'   AND sa.grantee_id=? AND ? IS NOT NULL)
               OR  (sa.grantee_type='factory'       AND sa.grantee_id=? AND ? IS NOT NULL)
               OR  (sa.grantee_type='org_group'     AND sa.grantee_id=? AND ? IS NOT NULL))))
     FETCH FIRST 1 ROWS ONLY`
  ).get(
    node.name, userId ?? 0,
    userId ?? 0, u.role || null,
    u.dept_code || null, u.dept_code || null,
    u.profit_center || null, u.profit_center || null,
    u.org_section || null, u.org_section || null,
    u.factory_code || null, u.factory_code || null,
    u.org_group_name || null, u.org_group_name || null,
  );

  if (!skill) throw new Error(`技能「${node.name}」不存在或無存取權`);

  if (skill.type === 'builtin') {
    const { generateTextSync } = require('./gemini');
    const { resolveTaskModel } = require('./llmDefaults');
    const apiModel = await resolveTaskModel(db, skill.model_key, 'chat').catch(() => null);
    const sysPrompt = skill.system_prompt || '';
    const history = sysPrompt ? [{ role: 'user', parts: [{ text: sysPrompt }] }, { role: 'model', parts: [{ text: '好的。' }] }] : [];
    const { text } = await generateTextSync(apiModel, history, input || '請執行');
    return text;
  }

  if (skill.type === 'external' && skill.endpoint_url) {
    const res = await fetch(skill.endpoint_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(skill.endpoint_secret ? { 'x-secret': skill.endpoint_secret } : {}) },
      body: JSON.stringify({ user_message: input, user_id: userId, session_id: sessionId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`外部技能回應 ${res.status}`);
    const data = await res.json();
    return data.content || data.system_prompt || '';
  }

  if (skill.type === 'code') {
    if (!skill.code_port) throw new Error('Code skill 尚未啟動');
    const res = await fetch(`http://127.0.0.1:${skill.code_port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_message: input, user_id: userId, session_id: sessionId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Code skill 回應 ${res.status}`);
    const data = await res.json();

    // Capture audio_url if skill returns one
    if (data.audio_url) {
      return { text: data.content || data.system_prompt || '', audio_url: data.audio_url };
    }
    return data.content || data.system_prompt || '';
  }

  throw new Error(`技能類型 "${skill.type}" 不支援`);
}

async function execMcp(node, vars, db, context) {
  const mcpClient = require('./mcpClient');

  const server = await db.prepare(`SELECT * FROM mcp_servers WHERE name=? AND is_active=1`).get(node.server);
  if (!server) throw new Error(`MCP 伺服器「${node.server}」不存在或未啟用`);
  if (!server.tools_json) throw new Error(`MCP 伺服器「${node.server}」尚未同步工具，請先執行同步`);

  // Interpolate args
  const rawArgs = node.args || {};
  const args = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    args[k] = typeof v === 'string' ? interpolate(v, vars) : v;
  }

  const u = context.user || {};
  const mcpUserCtx = u.id ? {
    id: u.id, email: u.email || '', name: u.name || '', employee_id: u.employee_id || '', dept_code: u.dept_code || '',
  } : null;
  const result = await mcpClient.callTool(db, server, context.sessionId, context.userId, node.tool, args, mcpUserCtx);
  return result || '';
}

async function execKb(node, vars, db) {
  const { searchKbChunks } = require('./knowledgeBaseService');
  const query = interpolate(node.query || '{{ai_output}}', vars);

  const kb = await db.prepare(
    `SELECT * FROM knowledge_bases WHERE UPPER(name)=UPPER(?) AND is_public=1 FETCH FIRST 1 ROWS ONLY`
  ).get(node.name);
  if (!kb) throw new Error(`知識庫「${node.name}」不存在`);

  const chunks = await searchKbChunks(db, kb.id, query.slice(0, 500));
  return chunks.length > 0 ? chunks.join('\n---\n').slice(0, 6000) : '（知識庫無相關內容）';
}

// ── 共用落檔 helper：把一段文字寫成 pdf/docx/xlsx/pptx/txt(走 fileGenerator)或
//    mp3(走 TTS skill)。不處理 docTemplate(那是 execGenerateFile 專屬)。
//    供 execAi(AI 追加節點選了輸出為檔案)與 execGenerateFile 非範本路徑共用。
async function materializeFile(fileType, filenameTemplate, input, vars, context) {
  if (fileType === 'mp3') {
    const FOXLINK_API = `http://127.0.0.1:${process.env.PORT || 3001}`;
    const SERVICE_KEY = process.env.SKILL_SERVICE_KEY || '';
    const ttsText = input
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .trim()
      .slice(0, 4800);
    const ttsRes = await fetch(`${FOXLINK_API}/api/skills/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-key': SERVICE_KEY },
      body: JSON.stringify({ text: ttsText, user_id: context.userId }),
      signal: AbortSignal.timeout(60000),
    });
    if (!ttsRes.ok) {
      const err = await ttsRes.json().catch(() => ({}));
      throw new Error(`TTS 失敗: ${err.error || ttsRes.status}`);
    }
    const ttsData = await ttsRes.json();
    const UPLOAD_DIR = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, '../uploads');
    const fname = path.basename(ttsData.audio_url);
    return {
      filename: interpolate(filenameTemplate || fname, vars),
      publicUrl: ttsData.audio_url,
      filePath: path.join(UPLOAD_DIR, 'generated', fname),
    };
  }

  const { processGenerateBlocks } = require('./fileGenerator');
  const resolvedFilename = interpolate(filenameTemplate || `output.${fileType}`, vars);
  const syntheticBlock = `\`\`\`generate_${fileType}:${resolvedFilename}\n${input}\n\`\`\``;
  const blocks = await processGenerateBlocks(syntheticBlock, context.sessionId);
  if (blocks.length > 0) return blocks[0];
  throw new Error(`generate_${fileType} 無法生成檔案`);
}

async function execAi(node, vars, db, context) {
  const { generateTextSync } = require('./gemini');
  const { resolveTaskModel } = require('./llmDefaults');

  const prompt = interpolate(node.prompt || '{{ai_output}}', vars);
  const apiModel = await resolveTaskModel(db, node.model, 'chat').catch(() => null);

  const { text } = await generateTextSync(apiModel, [], prompt);

  if (!node.output_file) return { text };

  const file = await materializeFile(node.output_file, node.filename, text, vars, context);
  return { text, file };
}

async function execGenerateFile(node, vars, db, context) {
  const input = interpolate(node.input || '{{ai_output}}', vars);
  // UI (PipelineTab.tsx) 存的欄位是 output_file；file_type 是舊欄位名保留向下相容
  const fileType = node.output_file || node.file_type || 'pdf';

  // ── Template mode: fill a doc template with JSON data ──────────────────────
  if (node.template_id) {
    const {
      generateDocumentFromJson,
      parseJsonFromAiOutput,
      getTemplateSchemaInstruction,
    } = require('./docTemplateService');
    let jsonData = parseJsonFromAiOutput(input);
    // If direct parse fails, do an AI re-format step using the template schema instruction
    if (!jsonData) {
      const { generateTextSync } = require('./gemini');
      const { resolveDefaultModel } = require('./llmDefaults');
      const schemaInstr = await getTemplateSchemaInstruction(db, node.template_id).catch(() => '');
      if (!schemaInstr) throw new Error('Pipeline generate_file: 資料來源無法解析為 JSON，且無法取得範本 schema');
      const apiModel = await resolveDefaultModel(db, 'chat').catch(() => null);
      const reformatPrompt = `以下是資料內容，請依照格式指令輸出：\n${input}\n${schemaInstr}`;
      const { text: reformatText } = await generateTextSync(apiModel, [], reformatPrompt);
      jsonData = parseJsonFromAiOutput(reformatText);
      if (!jsonData) throw new Error('Pipeline generate_file: 資料來源無法解析為 JSON（re-format 後仍失敗）');
    }
    const user = context.user || { id: context.userId, role: 'admin' };
    const tplFile = await generateDocumentFromJson(db, node.template_id, jsonData, user);
    // Use AI-suggested filename + date if available
    let resolvedFilename;
    if (node.filename) {
      resolvedFilename = interpolate(node.filename, vars);
    } else {
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const aiName = jsonData._ai_filename
        ? jsonData._ai_filename.replace(/[\\/:*?"<>|]/g, '').trim()
        : '';
      const ext = tplFile.filename.split('.').pop();
      resolvedFilename = aiName ? `${aiName}_${todayStr}.${ext}` : tplFile.filename;
    }
    return {
      text: `[已生成範本檔案: ${resolvedFilename}]`,
      file: { filename: resolvedFilename, publicUrl: tplFile.publicUrl, filePath: tplFile.filePath },
    };
  }

  // 非範本模式：mp3 走 TTS，其餘走 fileGenerator(共用 materializeFile)
  const file = await materializeFile(fileType, node.filename, input, vars, context);
  const text = fileType === 'mp3' ? '[語音已生成]' : `[已生成 ${fileType.toUpperCase()} 檔案]`;
  return { text, file };
}

// ── Dashboard (AI 戰情) node ─────────────────────────────────────────────────
// 把 AI 戰情查詢當成 pipeline 節點呼叫:
//   • design_id    — 要呼叫的 ai_select_designs.id
//   • question     — NL 問題(支援 {{ai_output}} / {{date}} / {{node_X_output}} 等插值)
//   • model_key    — null = 用 design 預設;否則指定 llm_models.key
//   • output       — { format: 'xlsx' | 'json_text', filename?, sheet_name? }
//                    json_text 把 rows 字串化丟給下游 ai/db_write 節點接;
//                    xlsx 直接落檔到 generated/,進 email 附件。
//   • required     — true = 失敗就 throw 給 runPipeline.catch(預設 false,跟其他 node 一致)
// 權限走 task.user_id 在 runDashboardQueryBuffered 內做完整檢查
// (design access + 資料政策 full_block + 關鍵字)。Multi-Org SQL 注入在底層自動處理。
const MAX_DASHBOARD_ROWS = 50000;
function rowsToXlsxJsonString(rows, columns, columnLabels, sheetName) {
  // 把 dashboard SSE result(rows: object[]; columns: string[]; columnLabels: { code → label })
  // 轉成 fileGenerator.generateXlsx 吃的 JSON 字串格式:[{ sheetName, data: [[hdr...], [row...]] }]
  const cols = (columns && columns.length) ? columns : (rows[0] ? Object.keys(rows[0]) : []);
  const header = cols.map(c => columnLabels?.[c] || c);
  const limited = rows.slice(0, MAX_DASHBOARD_ROWS);
  const data = [header, ...limited.map(r => cols.map(c => {
    const v = r[c];
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }))];
  const truncated = rows.length > MAX_DASHBOARD_ROWS;
  return {
    jsonStr: JSON.stringify([{ sheetName: sheetName || 'Result', data }]),
    truncated,
    rowsExported: limited.length,
  };
}

async function execDashboard(node, vars, db, context) {
  const { runDashboardQueryBuffered } = require('./dashboardService');
  const { processGenerateBlocks } = require('./fileGenerator');

  if (!node.design_id) throw new Error('dashboard 節點缺少 design_id');
  const question = interpolate(node.question || '{{ai_output}}', vars);
  if (!question.trim()) throw new Error('dashboard 節點 question 為空');

  const result = await runDashboardQueryBuffered({
    designId: Number(node.design_id),
    question,
    userId: context.userId,
    user: context.user,
    // 優先序:node.model_key(節點覆寫)> context.taskModel(任務 AI 設定 model)> null(後端 fallback)
    modelKey: node.model_key || context.taskModel || null,
    lang: node.lang || 'zh-TW',
    isDesigner: false,  // pipeline 永遠以 viewer 身份跑(override_sql 不開放)
    forceFresh: node.force_fresh !== false,
    restrictMultiOrg: node.restrict_multi_org || null,
  });

  // 把結構化資料寫進 artifacts,給後續 merge_excel 等 node 消費(獨立於 nodeOutputs 字串)
  if (context._artifacts) {
    context._artifacts[node.id] = {
      kind: 'dashboard',
      rows: result.rows,
      columns: result.columns,
      columnLabels: result.columnLabels,
      designName: result.designName,
      topicName: result.topicName,
      sql: result.sql,
      rowCount: result.rowCount,
    };
  }

  const output = node.output || {};
  const format = output.format || 'xlsx';

  if (format === 'none') {
    // 只寫 artifacts,不落檔不返回 rows 字串 — 給 merge_excel 拉資料用
    return { text: `[AI 戰情「${result.designName}」拉 ${result.rowCount} 筆(供合併用,未落檔)]`, dashboardSummary: {
      design_id: node.design_id, design_name: result.designName, topic: result.topicName,
      sql: result.sql, row_count: result.rowCount, only_artifacts: true,
    } };
  }

  if (format === 'json_text') {
    // 把 rows 序列化,給下游 ai / db_write 節點消費
    const text = result.rows.length === 0
      ? '(查詢無結果)'
      : `共 ${result.rowCount} 筆\n\n${JSON.stringify(result.rows.slice(0, 200), null, 2)}`;
    return { text, dashboardSummary: {
      design_id: node.design_id, design_name: result.designName, topic: result.topicName,
      sql: result.sql, row_count: result.rowCount, sample_only: result.rows.length > 200,
    } };
  }

  if (format === 'xlsx') {
    if (result.rows.length === 0) {
      // 空結果不產檔,純文字回報(避免 email 附一個只有 header 的空檔)
      return { text: `[AI 戰情「${result.designName}」查詢無結果]`, dashboardSummary: {
        design_id: node.design_id, design_name: result.designName, sql: result.sql, row_count: 0,
      } };
    }
    const { jsonStr, truncated, rowsExported } = rowsToXlsxJsonString(
      result.rows, result.columns, result.columnLabels, output.sheet_name
    );
    const filename = interpolate(output.filename || `${result.designName || 'dashboard'}_{{date}}.xlsx`, vars);
    const syntheticBlock = `\`\`\`generate_xlsx:${filename}\n${jsonStr}\n\`\`\``;
    const blocks = await processGenerateBlocks(syntheticBlock, context.sessionId);
    if (!blocks.length) throw new Error('generate_xlsx 落檔失敗');
    const truncNote = truncated ? `(已截斷至 ${MAX_DASHBOARD_ROWS} 筆,原 ${result.rowCount} 筆)` : '';
    return {
      text: `[AI 戰情「${result.designName}」已生成 ${rowsExported} 筆${truncNote} → ${blocks[0].filename}]`,
      file: blocks[0],
      dashboardSummary: {
        design_id: node.design_id, design_name: result.designName, topic: result.topicName,
        sql: result.sql, row_count: result.rowCount, exported: rowsExported, truncated,
      },
    };
  }

  throw new Error(`dashboard 節點 output.format "${format}" 不支援(支援:xlsx, json_text, none)`);
}

// ── Merge Excel node ─────────────────────────────────────────────────────────
// 把多個 dashboard node 的 rows 合併成單一 Excel(多 sheet 或 single sheet)
//   • source_node_ids — 引用的 dashboard node IDs(必須先跑過,context._artifacts 有資料)
//   • mode:'multi_sheet'(預設,每個 source 一個 sheet)或 'single_sheet'(全部接在同一個 sheet,加 _source 標記欄)
//   • filename / sheet_name(single_sheet 模式)
//   • required — 跟其他 node 一致
async function execMergeExcel(node, vars, db, context) {
  const { processGenerateBlocks } = require('./fileGenerator');
  const sourceIds = Array.isArray(node.source_node_ids) ? node.source_node_ids : [];
  if (sourceIds.length === 0) throw new Error('merge_excel 節點未指定 source_node_ids');
  const artifacts = context._artifacts || {};

  // 收集每個 source 的 rows(只接受 dashboard kind);缺資料或非 dashboard → 視為 0 筆 sheet,標 [missing]
  const sources = sourceIds.map((sid) => {
    const a = artifacts[sid];
    if (!a || a.kind !== 'dashboard') {
      return { sid, missing: true, designName: `[missing: ${sid}]`, rows: [], columns: [], columnLabels: {} };
    }
    return { sid, missing: false, ...a };
  });

  const validCount = sources.filter(s => !s.missing).length;
  if (validCount === 0) throw new Error('merge_excel:所有 source dashboard node 都沒有 artifacts(可能執行失敗或順序錯誤)');

  const mode = node.mode || 'multi_sheet';
  const filename = interpolate(node.filename || `merged_dashboards_{{date}}.xlsx`, vars);
  let sheets = [];

  if (mode === 'single_sheet') {
    // 全部 source rows 接在同一個 sheet,第一欄補 _source(designName)
    const sheetName = node.sheet_name || 'Merged';
    // 取所有 source columns 的聯集當欄位
    const allCols = new Set();
    for (const s of sources) {
      for (const c of (s.columns || [])) allCols.add(c);
    }
    const cols = ['_source', ...Array.from(allCols)];
    const labels = ['Source', ...Array.from(allCols).map(c => sources.find(s => s.columnLabels?.[c])?.columnLabels?.[c] || c)];
    const rows = [labels];
    for (const s of sources) {
      const limited = (s.rows || []).slice(0, MAX_DASHBOARD_ROWS);
      for (const r of limited) {
        rows.push(cols.map(c => {
          if (c === '_source') return s.designName || s.sid;
          const v = r[c];
          if (v == null) return '';
          if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
          if (typeof v === 'object') return JSON.stringify(v);
          return v;
        }));
      }
    }
    sheets = [{ sheetName, data: rows }];
  } else {
    // multi_sheet(預設):每個 source 一個 sheet,sheet 名 = designName 或 sid
    for (const s of sources) {
      const sheetName = (s.designName || String(s.sid)).slice(0, 28).replace(/[\\/?*[\]:]/g, '_'); // Excel sheet name <=31 chars
      if (s.missing || !s.rows || s.rows.length === 0) {
        sheets.push({ sheetName: sheetName + (s.missing ? '_MISSING' : '_EMPTY'), data: [['(無資料)']] });
        continue;
      }
      const cols = (s.columns && s.columns.length) ? s.columns : Object.keys(s.rows[0]);
      const header = cols.map(c => s.columnLabels?.[c] || c);
      const limited = s.rows.slice(0, MAX_DASHBOARD_ROWS);
      const data = [header, ...limited.map(r => cols.map(c => {
        const v = r[c];
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
        if (typeof v === 'object') return JSON.stringify(v);
        return v;
      }))];
      sheets.push({ sheetName, data });
    }
  }

  const jsonStr = JSON.stringify(sheets);
  const syntheticBlock = `\`\`\`generate_xlsx:${filename}\n${jsonStr}\n\`\`\``;
  const blocks = await processGenerateBlocks(syntheticBlock, context.sessionId);
  if (!blocks.length) throw new Error('merge_excel 落檔失敗');
  const missingNames = sources.filter(s => s.missing).map(s => s.sid);
  const summary = sources.map(s => `${s.designName || s.sid}(${s.missing ? 'missing' : (s.rows?.length || 0) + '筆'})`).join(', ');
  return {
    text: `[已合併 ${validCount}/${sources.length} 個 dashboard → ${blocks[0].filename}${missingNames.length ? ` ⚠️ missing: ${missingNames.join(',')}` : ''}]\n${summary}`,
    file: blocks[0],
    mergeSummary: { mode, source_count: sources.length, valid_count: validCount, missing: missingNames, filename: blocks[0].filename },
  };
}

async function execAlert(node, vars, db, context) {
  const { executeAlert } = require('./pipelineAlerter');
  const input = interpolate(node.input || '{{ai_output}}', vars);
  const result = await executeAlert(db, node, input, {
    user: context.user || null,
    userId: context.userId,
    runId: context.runId || null,
    taskId: context.taskId || null,
    taskName: context.taskName || '',
    nodeId: node.id,
    dryRun: false,
  });
  let label;
  if (result.triggered) {
    label = `[警示觸發 ${result.rule_name || ''} (${result.severity || 'warning'}): ${result.reason || ''} → ${(result.channels_sent || []).join(',') || 'no channel'}]`;
  } else if (result.skipped) {
    label = `[警示跳過 ${result.rule_name || node.label || ''}: ${result.reason || ''}]`;
  } else if (result.error) {
    label = `[警示錯誤 ${result.rule_name || node.label || ''}: ${result.error}]`;
  } else {
    label = `[警示未觸發 ${result.rule_name || ''}: ${result.reason || ''}]`;
  }
  return { text: label, alertSummary: result };
}

async function execKbWrite(node, vars, db, context) {
  const { executeKbWrite } = require('./pipelineKbWriter');
  const input = interpolate(node.input || '{{ai_output}}', vars);
  const result = await executeKbWrite(db, node, input, {
    user: context.user || null,
    userId: context.userId,
    runId: context.runId || null,
    taskName: context.taskName || '',
    nodeId: node.id,
    dryRun: false,
  });
  const errCount = result.errors?.length || 0;
  const text = `[KB 寫入 ${node.kb_name || node.kb_id}: ${result.documents_created} docs / ${result.chunks_created} chunks / ${result.skipped_duplicates} skipped${errCount ? ' / ' + errCount + ' errors' : ''}]`;
  return { text, kbWriteSummary: { kb_id: node.kb_id, kb_name: node.kb_name, ...result } };
}

async function execDbWrite(node, vars, db, context) {
  const { executeDbWrite } = require('./pipelineDbWriter');
  const input = interpolate(node.input || '{{ai_output}}', vars);
  // 把 vars 整包傳下去,讓 db_write 內部需要查 url_whitelist_var 之類的 cross-stage 資料時能拿
  const result = await executeDbWrite(db, node, input, {
    user: context.user || null,
    userId: context.userId,
    runId: context.runId || null,
    taskName: context.taskName || '',
    nodeId: node.id,
    dryRun: false,
    vars,
  });
  const errCount = result.errors?.length || 0;
  const text = `[DB 寫入 ${node.table}: ${result.inserted} inserted / ${result.updated} updated / ${result.skipped} skipped${errCount ? ' / ' + errCount + ' errors' : ''}]`;
  return { text, dbWriteSummary: { table: node.table, operation: node.operation, ...result } };
}

async function execCondition(node, vars, db) {
  const input = interpolate(node.input || '{{ai_output}}', vars);

  if (node.judge === 'ai' || node.judge_type === 'ai') {
    // AI judge: ask a yes/no question
    const { generateTextSync } = require('./gemini');
    const { resolveDefaultModel } = require('./llmDefaults');
    const question = interpolate(node.prompt || '請回答 yes 或 no。', vars);
    const apiModel = await resolveDefaultModel(db, 'chat').catch(() => null);
    const { text } = await generateTextSync(apiModel, [], `${question}\n\n內容：\n${input.slice(0, 2000)}\n\n只回答 yes 或 no，不要其他說明。`);
    const answer = text.trim().toLowerCase();
    return answer.startsWith('yes') || answer.startsWith('是') || answer.startsWith('y') ? 'yes' : 'no';
  }

  // Text condition
  const value = interpolate(node.value || '', vars);
  const op = node.operator || 'contains';
  switch (op) {
    case 'contains':     return input.includes(value) ? 'yes' : 'no';
    case 'not_contains': return !input.includes(value) ? 'yes' : 'no';
    case 'equals':       return input.trim() === value.trim() ? 'yes' : 'no';
    case 'starts_with':  return input.startsWith(value) ? 'yes' : 'no';
    case 'ends_with':    return input.endsWith(value) ? 'yes' : 'no';
    case 'regex':        return new RegExp(value).test(input) ? 'yes' : 'no';
    case 'empty':        return input.trim() === '' ? 'yes' : 'no';
    case 'length_gt':    return input.length > Number(value) ? 'yes' : 'no';
    case 'length_lt':    return input.length < Number(value) ? 'yes' : 'no';
    case 'number_gt':    return Number(input.match(/-?\d+\.?\d*/)?.[0]) > Number(value) ? 'yes' : 'no';
    case 'number_lt':    return Number(input.match(/-?\d+\.?\d*/)?.[0]) < Number(value) ? 'yes' : 'no';
    default:             return 'no';
  }
}

// ── Node dispatcher ───────────────────────────────────────────────────────────

async function runNode(node, vars, db, context, log) {
  const start = Date.now();
  const entry = { id: node.id, type: node.type, status: 'running', start_ms: start };
  log.push(entry);

  try {
    let output = '';
    let file = null;

    switch (node.type) {
      case 'skill': {
        const result = await execSkill(node, vars, db, context);
        if (result && typeof result === 'object') {
          output = result.text || result.system_prompt || '';
          if (result.audio_url) {
            const UPLOAD_DIR = process.env.UPLOAD_DIR
              ? path.resolve(process.env.UPLOAD_DIR)
              : path.join(__dirname, '../uploads');
            const fname = path.basename(result.audio_url);
            const finalFilename = node.filename
              ? interpolate(node.filename, vars)
              : fname;
            const resolvedFilePath = path.join(UPLOAD_DIR, 'generated', fname);
            const fileExists = fs.existsSync(resolvedFilePath);
            console.log(`[Pipeline skill] audio_url=${result.audio_url}`);
            console.log(`[Pipeline skill] filePath=${resolvedFilePath} exists=${fileExists}`);
            file = {
              filename: finalFilename,
              publicUrl: result.audio_url,
              filePath: resolvedFilePath,
            };
          }
        } else output = result || '';
        break;
      }
      case 'mcp':           output = await execMcp(node, vars, db, context); break;
      case 'kb':            output = await execKb(node, vars, db); break;
      case 'ai': {
        const r = await execAi(node, vars, db, context);
        output = r.text; file = r.file;
        break;
      }
      case 'generate_file': {
        const r = await execGenerateFile(node, vars, db, context);
        output = r.text; file = r.file;
        break;
      }
      case 'dashboard': {
        const r = await execDashboard(node, vars, db, context);
        output = r.text; file = r.file;
        if (r.dashboardSummary) entry.dashboard_summary = r.dashboardSummary;
        break;
      }
      case 'merge_excel': {
        const r = await execMergeExcel(node, vars, db, context);
        output = r.text; file = r.file;
        if (r.mergeSummary) entry.merge_summary = r.mergeSummary;
        break;
      }
      case 'db_write': {
        console.log(`[Pipeline db_write] Start — table=${node.table}, op=${node.operation}, input.len=${(interpolate(node.input || '{{ai_output}}', vars) || '').length}`);
        const r = await execDbWrite(node, vars, db, context);
        output = r.text;
        entry.db_write_summary = r.dbWriteSummary;
        console.log(`[Pipeline db_write] OK — ${output}`);
        if (r.dbWriteSummary?.errors?.length) {
          // 對 K8s log 友善:每個 error 一行,含 row_index + 訊息 + LLM 原始 row payload
          // 印前 10 筆(原 3 太少 admin debug 不出資訊),全部 errors 都進 pipeline_log_json
          console.log(`[Pipeline db_write] ${r.dbWriteSummary.errors.length} row errors:`);
          for (const e of r.dbWriteSummary.errors.slice(0, 10)) {
            console.log(`  row#${e.row_index} errs=${JSON.stringify(e.errors)} payload=${e.row_payload || '(none)'}`);
          }
          if (r.dbWriteSummary.errors.length > 10) {
            console.log(`  ... and ${r.dbWriteSummary.errors.length - 10} more (見 pipeline_log_json)`);
          }
        }
        break;
      }
      case 'kb_write': {
        console.log(`[Pipeline kb_write] Start — kb=${node.kb_name || node.kb_id}, chunk_strategy=${node.chunk_strategy || 'mixed'}, dedupe=${node.dedupe_mode || 'url'}, max_chunks=${node.max_chunks_per_run || 100}`);
        const r = await execKbWrite(node, vars, db, context);
        output = r.text;
        entry.kb_write_summary = r.kbWriteSummary;
        console.log(`[Pipeline kb_write] OK — ${output}`);
        if (r.kbWriteSummary?.errors?.length) {
          console.log(`[Pipeline kb_write] ${r.kbWriteSummary.errors.length} row errors:`);
          for (const e of r.kbWriteSummary.errors.slice(0, 10)) {
            console.log(`  row#${e.row_index} errs=${JSON.stringify(e.errors)} payload=${e.row_payload || '(none)'}`);
          }
          if (r.kbWriteSummary.errors.length > 10) {
            console.log(`  ... and ${r.kbWriteSummary.errors.length - 10} more (見 pipeline_log_json)`);
          }
        }
        break;
      }
      case 'alert': {
        console.log(`[Pipeline alert] Start — node=${node.id}, comparison=${node.comparison || '(from db rule)'}`);
        const r = await execAlert(node, vars, db, context);
        output = r.text;
        entry.alert_summary = r.alertSummary;
        console.log(`[Pipeline alert] ${output}`);
        if (r.alertSummary?.channel_errors?.length) {
          console.log(`[Pipeline alert] channel errors:`, JSON.stringify(r.alertSummary.channel_errors));
        }
        break;
      }
      case 'condition': {
        const branch = await execCondition(node, vars, db);
        entry.branch = branch;
        entry.status = 'ok';
        entry.duration_ms = Date.now() - start;
        return { output: branch, file: null, branch };
      }
      default:
        throw new Error(`未知節點類型: ${node.type}`);
    }

    entry.status = 'ok';
    entry.duration_ms = Date.now() - start;
    entry.output_preview = String(output).slice(0, 200);
    return { output, file };
  } catch (e) {
    entry.status = 'error';
    entry.error = e.message;
    entry.duration_ms = Date.now() - start;
    // throw 的 e._partialResult 是 db_write / kb_write 跑到一半 throw 前累積的統計
    // 抽出來放進對應 summary,讓 admin run history 看得到 row errors + payload
    // (不抽的話 RunDetailModal filter 找不到 db_write_summary,等於 silent 失敗)
    if (e._partialResult) {
      if (node.type === 'db_write') {
        entry.db_write_summary = { table: node.table, operation: node.operation, ...e._partialResult, _threw: true };
      } else if (node.type === 'kb_write') {
        entry.kb_write_summary = { kb_id: node.kb_id, kb_name: node.kb_name, ...e._partialResult, _threw: true };
      }
    }
    console.error(`[Pipeline] Node "${node.id}" error:`, e.message);
    throw e;
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * Run all pipeline nodes after AI main output.
 * @param {Array}  nodes       - pipeline node definitions
 * @param {string} aiOutput    - main AI response text
 * @param {object} db          - DB wrapper
 * @param {object} context     - { userId, sessionId, taskName }
 * @returns {{ generatedFiles, nodeOutputs, log }}
 */
async function runPipeline(nodes, aiOutput, db, context) {
  if (!nodes || nodes.length === 0) return { generatedFiles: [], nodeOutputs: {}, log: [], failedNodes: [], nodeArtifacts: {} };

  const { taskName = '', extraVars = null } = context;
  const nodeOutputs = {};     // id → output text(給 prompt 插值用,string-only)
  const generatedFiles = [];  // collected files from all nodes
  const log = [];             // execution log entries
  const failedNodes = [];     // {id, type, label, error, required} — 給 scheduledTaskService 組信件用
  const skipped = new Set();  // node ids to skip (branching)
  // nodeArtifacts:結構化資料(rows / columns),給後續節點消費(如 merge_excel)
  // 跟 nodeOutputs 並存:nodeOutputs[X] 是文字摘要(prompt 用),nodeArtifacts[X] 是 raw data。
  const nodeArtifacts = {};
  // 把 artifacts 塞進 context,讓 executor 能讀寫(merge_excel 讀、dashboard 寫)
  context._artifacts = nodeArtifacts;

  // Build a node map for branch resolution
  const nodeMap = {};
  for (const n of nodes) nodeMap[n.id] = n;

  for (const node of nodes) {
    if (skipped.has(node.id)) {
      log.push({ id: node.id, type: node.type, status: 'skipped' });
      continue;
    }

    const vars = buildVars(aiOutput, nodeOutputs, taskName, extraVars);

    // parallel node — run children concurrently
    if (node.type === 'parallel') {
      const childIds = node.steps || [];
      const results = await Promise.allSettled(
        childIds.map((cid) => {
          const child = nodeMap[cid];
          if (!child) return Promise.resolve({ output: '', file: null });
          return runNode(child, vars, db, context, log);
        })
      );
      for (let i = 0; i < childIds.length; i++) {
        const r = results[i];
        const child = nodeMap[childIds[i]] || {};
        if (r.status === 'fulfilled') {
          nodeOutputs[childIds[i]] = r.value.output;
          if (r.value.file) generatedFiles.push(r.value.file);
        } else {
          nodeOutputs[childIds[i]] = `[錯誤: ${r.reason?.message || r.reason}]`;
          failedNodes.push({
            id: childIds[i],
            type: child.type || 'unknown',
            label: child.label || child.name || childIds[i],
            error: r.reason?.message || String(r.reason),
            required: !!child.required,
          });
        }
      }
      // Mark children as handled so they won't run again in the main loop
      childIds.forEach((cid) => skipped.add(cid));
      log.push({ id: node.id, type: 'parallel', status: 'ok', children: childIds });
      continue;
    }

    // condition node — determine branch and skip the other branch's subtree
    if (node.type === 'condition') {
      const { branch } = await runNode(node, vars, db, context, log);
      const taken  = branch === 'yes' ? (node.then_id || node.then) : (node.else_id || node.else);
      const skippedBranch = branch === 'yes' ? (node.else_id || node.else) : (node.then_id || node.then);
      nodeOutputs[node.id] = branch;
      // Skip the not-taken sub-tree (single node id only — for sub-tree, extend later)
      if (skippedBranch && typeof skippedBranch === 'string') skipped.add(skippedBranch);
      // If taken is explicit next override, mark non-taken
      if (taken && typeof taken === 'string') {
        // Reroute: skip all nodes until taken node
        let found = false;
        for (const n of nodes) {
          if (!found && n.id !== taken) { if (n.id !== node.id) skipped.add(n.id); }
          else found = true;
        }
      }
      continue;
    }

    // normal node
    // required=true 等同 on_fail='stop' + 視覺上更明確(信件主旨會標紅);舊 on_fail 'stop'/'goto'
    // 行為保留向下相容
    const onFail = node.on_fail || (node.required ? 'stop' : 'continue');
    try {
      const { output, file } = await runNode(node, vars, db, context, log);
      nodeOutputs[node.id] = output;
      if (file) generatedFiles.push(file);
    } catch (e) {
      nodeOutputs[node.id] = `[錯誤: ${e.message}]`;
      failedNodes.push({
        id: node.id,
        type: node.type,
        label: node.label || node.name || node.id,
        error: e.message,
        required: !!node.required,
      });
      if (onFail === 'stop') break;
      if (onFail === 'goto' && node.on_fail_goto) {
        // Skip to on_fail_goto node
        let skip = true;
        for (const n of nodes) {
          if (n.id === node.on_fail_goto) { skip = false; }
          if (skip && n.id !== node.id) skipped.add(n.id);
        }
      }
    }
  }

  return { generatedFiles, nodeOutputs, log, failedNodes, nodeArtifacts };
}

module.exports = { runPipeline };
