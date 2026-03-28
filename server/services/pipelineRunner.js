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

  const skill = await db.prepare(
    `SELECT * FROM skills
     WHERE UPPER(name)=UPPER(?)
       AND (owner_user_id=? OR is_public=1
            OR EXISTS (SELECT 1 FROM skill_access sa WHERE sa.skill_id=skills.id
              AND ((sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
               OR  (sa.grantee_type='role' AND sa.grantee_id=(SELECT role FROM users WHERE id=?)))))
     FETCH FIRST 1 ROWS ONLY`
  ).get(node.name, userId ?? 0, userId ?? 0, userId ?? 0);

  if (!skill) throw new Error(`技能「${node.name}」不存在或無存取權`);

  if (skill.type === 'builtin') {
    const { generateTextSync } = require('./gemini');
    let apiModel = skill.model_key || null;
    if (apiModel) {
      const row = await db.prepare('SELECT api_model FROM llm_models WHERE key=? AND is_active=1').get(apiModel).catch(() => null);
      if (row?.api_model) apiModel = row.api_model;
    }
    if (!apiModel) {
      const { resolveDefaultModel } = require('./llmDefaults');
      apiModel = await resolveDefaultModel(db, 'chat').catch(() => null);
    }
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

  const result = await mcpClient.callTool(db, server, context.sessionId, context.userId, node.tool, args);
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
  const { resolveDefaultModel } = require('./llmDefaults');

  const prompt = interpolate(node.prompt || '{{ai_output}}', vars);
  let apiModel = node.model || null;
  if (apiModel) {
    const row = await db.prepare('SELECT api_model FROM llm_models WHERE key=? AND is_active=1').get(apiModel).catch(() => null);
    if (row?.api_model) apiModel = row.api_model;
  }
  if (!apiModel) apiModel = await resolveDefaultModel(db, 'chat').catch(() => null);

  const { text } = await generateTextSync(apiModel, [], prompt);
  return text;
}

async function execGenerateFile(node, vars, db, context) {
  const { processGenerateBlocks } = require('./fileGenerator');
  const input = interpolate(node.input || '{{ai_output}}', vars);
  const fileType = node.file_type || 'pdf';

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
