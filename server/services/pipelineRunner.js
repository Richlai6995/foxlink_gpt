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

function buildVars(aiOutput, nodeOutputs, taskName) {
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

async function execAi(node, vars, db) {
  const { generateTextSync } = require('./gemini');
  const { resolveTaskModel } = require('./llmDefaults');

  const prompt = interpolate(node.prompt || '{{ai_output}}', vars);
  const apiModel = await resolveTaskModel(db, node.model, 'chat').catch(() => null);

  const { text } = await generateTextSync(apiModel, [], prompt);
  return text;
}

async function execGenerateFile(node, vars, db, context) {
  const { processGenerateBlocks } = require('./fileGenerator');
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
      text: `[語音已生成]`,
      file: {
        filename: interpolate(node.filename || fname, vars),
        publicUrl: ttsData.audio_url,
        filePath: path.join(UPLOAD_DIR, 'generated', fname),
      },
    };
  }

  // For pdf/docx/xlsx/pptx/txt — wrap in generate block and process
  const resolvedFilename = interpolate(node.filename || `output.${fileType}`, vars);
  const syntheticBlock = `\`\`\`generate_${fileType}:${resolvedFilename}\n${input}\n\`\`\``;
  const blocks = await processGenerateBlocks(syntheticBlock, context.sessionId);
  if (blocks.length > 0) {
    return { text: `[已生成 ${fileType.toUpperCase()} 檔案]`, file: blocks[0] };
  }
  throw new Error(`generate_${fileType} 無法生成檔案`);
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
  const result = await executeDbWrite(db, node, input, {
    user: context.user || null,
    userId: context.userId,
    runId: context.runId || null,
    taskName: context.taskName || '',
    nodeId: node.id,
    dryRun: false,
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
      case 'ai':            output = await execAi(node, vars, db); break;
      case 'generate_file': {
        const r = await execGenerateFile(node, vars, db, context);
        output = r.text; file = r.file;
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
  if (!nodes || nodes.length === 0) return { generatedFiles: [], nodeOutputs: {}, log: [] };

  const { taskName = '' } = context;
  const nodeOutputs = {};     // id → output text
  const generatedFiles = [];  // collected files from all nodes
  const log = [];             // execution log entries
  const skipped = new Set();  // node ids to skip (branching)

  // Build a node map for branch resolution
  const nodeMap = {};
  for (const n of nodes) nodeMap[n.id] = n;

  for (const node of nodes) {
    if (skipped.has(node.id)) {
      log.push({ id: node.id, type: node.type, status: 'skipped' });
      continue;
    }

    const vars = buildVars(aiOutput, nodeOutputs, taskName);

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
        if (r.status === 'fulfilled') {
          nodeOutputs[childIds[i]] = r.value.output;
          if (r.value.file) generatedFiles.push(r.value.file);
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
    const onFail = node.on_fail || 'continue';
    try {
      const { output, file } = await runNode(node, vars, db, context, log);
      nodeOutputs[node.id] = output;
      if (file) generatedFiles.push(file);
    } catch (e) {
      nodeOutputs[node.id] = `[錯誤: ${e.message}]`;
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

  return { generatedFiles, nodeOutputs, log };
}

module.exports = { runPipeline };
