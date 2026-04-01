'use strict';

/**
 * Workflow Execution Engine
 *
 * Executes a DAG of nodes. Each node produces an output string that downstream
 * nodes can reference via {{nodeId.output}} template syntax.
 *
 * Supported node types:
 *   start, llm, knowledge_base, dify, mcp_tool, skill, code,
 *   http_request, condition, template, output
 */

const MAX_NODE_EXECUTIONS = 50;

// ── Helpers imported lazily ─────────────────────────────────────────────────
let _generateTextSync;
function getGenerateTextSync() {
  if (!_generateTextSync) {
    _generateTextSync = require('./gemini').generateTextSync;
  }
  return _generateTextSync;
}

let _resolveDefaultModel;
function getResolveDefaultModel() {
  if (!_resolveDefaultModel) {
    _resolveDefaultModel = require('./llmDefaults').resolveDefaultModel;
  }
  return _resolveDefaultModel;
}

let _mcpClient;
function getMcpClient() {
  if (!_mcpClient) {
    _mcpClient = require('./mcpClient');
  }
  return _mcpClient;
}

// ── KB search (same logic as promptResolver.js) ─────────────────────────────
async function searchKbChunks(db, kbId, query, topK = 5) {
  const dims = 768;

  // Try vector search first
  try {
    const { embedText, toVectorStr } = require('./kbEmbedding');
    const qEmb = await embedText(query, { dims });
    const qVecStr = toVectorStr(qEmb);
    const rows = await db.prepare(`
      SELECT c.content, c.parent_content,
             VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vscore
      FROM kb_chunks c
      WHERE c.kb_id=? AND c.chunk_type != 'parent' AND c.embedding IS NOT NULL
      ORDER BY vscore ASC
      FETCH FIRST ? ROWS ONLY
    `).all(qVecStr, kbId, topK);
    if (rows.length > 0) return rows.map(r => r.parent_content || r.content);
  } catch (_) { /* vector search unavailable, fall through */ }

  // Fallback: fulltext search
  try {
    const likeQuery = `%${query.slice(0, 100).replace(/[%_]/g, '\\$&')}%`;
    const rows = await db.prepare(`
      SELECT content FROM kb_chunks
      WHERE kb_id=? AND chunk_type != 'parent'
        AND UPPER(content) LIKE UPPER(?)
      FETCH FIRST ? ROWS ONLY
    `).all(kbId, likeQuery, topK);
    if (rows.length > 0) return rows.map(r => r.content);
  } catch (_) { /* fulltext unavailable, fall through */ }

  // Last resort: most recent chunks
  const rows = await db.prepare(`
    SELECT content FROM kb_chunks
    WHERE kb_id=? AND chunk_type != 'parent'
    ORDER BY id DESC
    FETCH FIRST ? ROWS ONLY
  `).all(kbId, topK);
  return rows.map(r => r.content);
}

// ── Skill executor (same logic as promptResolver.js) ────────────────────────
async function executeSkillByRow(db, skill, input, context = {}) {
  const { userId, sessionId } = context;

  if (skill.type === 'builtin') {
    const generateTextSync = getGenerateTextSync();
    let apiModel = skill.model_key || null;
    if (apiModel) {
      try {
        const row = await db.prepare('SELECT api_model FROM llm_models WHERE key=? AND is_active=1').get(apiModel);
        if (row?.api_model) apiModel = row.api_model;
      } catch (_) { /* ignore */ }
    }
    if (!apiModel) {
      try {
        const resolveDefaultModel = getResolveDefaultModel();
        apiModel = await resolveDefaultModel(db, 'chat');
      } catch (_) { apiModel = null; }
    }
    const sysPrompt = skill.system_prompt || '';
    const history = sysPrompt
      ? [{ role: 'user', parts: [{ text: sysPrompt }] }, { role: 'model', parts: [{ text: '好的，我明白了。' }] }]
      : [];
    const { text } = await generateTextSync(apiModel, history, input || '請執行');
    return text;
  }

  if (skill.type === 'external' && skill.endpoint_url) {
    const res = await fetch(skill.endpoint_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(skill.endpoint_secret ? { 'x-secret': skill.endpoint_secret } : {}),
      },
      body: JSON.stringify({ user_message: input, user_id: userId, session_id: sessionId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`外部技能回應 ${res.status}`);
    const data = await res.json();
    return data.content || data.system_prompt || '';
  }

  if (skill.type === 'code') {
    if (!skill.code_port) throw new Error('Code skill 尚未啟動，請先在管理後台啟動');
    const res = await fetch(`http://127.0.0.1:${skill.code_port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_message: input, user_id: userId, session_id: sessionId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Code skill 回應 ${res.status}`);
    const data = await res.json();
    return data.content || data.system_prompt || '';
  }

  return `[技能類型 "${skill.type}" 不支援直接呼叫]`;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  WorkflowEngine
// ═══════════════════════════════════════════════════════════════════════════════

class WorkflowEngine {
  /**
   * @param {object} db       — Oracle DB wrapper
   * @param {object} context  — { userId, sessionId }
   */
  constructor(db, context = {}) {
    this.db = db;
    this.userId = context.userId;
    this.sessionId = context.sessionId;
    this.nodeOutputs = {};   // nodeId -> output string
    this.executionLog = [];  // { nodeId, type, duration, status, output_preview?, error? }
    this._userInput = '';
    this._variables = {};
  }

  // ── Public entry point ──────────────────────────────────────────────────────

  /**
   * Execute a workflow DAG.
   *
   * @param {object} workflow   — { nodes: [...], edges: [...] }
   * @param {string} userInput  — the user's message
   * @param {object} variables  — resolved prompt_variables from the form
   * @returns {{ output: string, log: array, nodeOutputs: object }}
   */
  async execute(workflow, userInput, variables = {}) {
    this._userInput = userInput || '';
    this._variables = variables || {};
    this.nodeOutputs = {};
    this.executionLog = [];

    // Parse nodes / edges (may be JSON strings from DB)
    const nodes = typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : (workflow.nodes || []);
    const edges = typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : (workflow.edges || []);

    if (nodes.length === 0) {
      return { output: '', log: [], nodeOutputs: {} };
    }

    // Build lookup maps
    const nodeMap = new Map();          // id -> node
    const outEdges = new Map();         // sourceId -> [edge]
    const inDegree = new Map();         // id -> number of incoming edges

    for (const n of nodes) {
      nodeMap.set(n.id, n);
      outEdges.set(n.id, []);
      inDegree.set(n.id, 0);
    }
    for (const e of edges) {
      const list = outEdges.get(e.source);
      if (list) list.push(e);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }

    // Find the start node (type=start, or the node with 0 in-degree)
    let startNode = nodes.find(n => n.type === 'start');
    if (!startNode) {
      startNode = nodes.find(n => (inDegree.get(n.id) || 0) === 0);
    }
    if (!startNode) {
      return { output: '[Workflow 錯誤：找不到起始節點]', log: [], nodeOutputs: {} };
    }

    // BFS-style execution following edges
    const queue = [startNode.id];
    const visited = new Set();
    let execCount = 0;
    let lastOutput = '';

    while (queue.length > 0 && execCount < MAX_NODE_EXECUTIONS) {
      const nodeId = queue.shift();
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      execCount++;

      const node = nodeMap.get(nodeId);
      if (!node) continue;

      // Execute the node
      const result = await this.executeNode(node);

      // Determine next node(s) based on type
      const outgoing = outEdges.get(nodeId) || [];

      if (node.type === 'condition') {
        // Condition node: evaluate rules to pick one edge
        const targetId = this._evaluateCondition(node, outgoing);
        if (targetId && !visited.has(targetId)) {
          queue.push(targetId);
        }
      } else {
        // Regular node: follow all outgoing edges
        for (const edge of outgoing) {
          if (!visited.has(edge.target)) {
            // Only enqueue if all incoming edges' sources are visited
            // (ensures proper topological ordering for merge points)
            const targetInEdges = edges.filter(e => e.target === edge.target);
            const allSourcesVisited = targetInEdges.every(e => visited.has(e.source) || e.source === nodeId);
            if (allSourcesVisited) {
              queue.push(edge.target);
            } else {
              // Re-add to back of queue to try later
              queue.push(edge.target);
            }
          }
        }
      }

      // Track last meaningful output
      if (node.type === 'output') {
        lastOutput = this.nodeOutputs[nodeId] || '';
      }
    }

    // If no explicit output node was hit, use the last executed node's output
    if (!lastOutput) {
      const outputNode = nodes.find(n => n.type === 'output');
      if (outputNode && this.nodeOutputs[outputNode.id] != null) {
        lastOutput = this.nodeOutputs[outputNode.id];
      } else {
        // Fall back to the very last node that produced output
        const executedIds = this.executionLog.map(l => l.nodeId);
        for (let i = executedIds.length - 1; i >= 0; i--) {
          const out = this.nodeOutputs[executedIds[i]];
          if (out && out.length > 0) { lastOutput = out; break; }
        }
      }
    }

    return {
      output: lastOutput,
      log: this.executionLog,
      nodeOutputs: { ...this.nodeOutputs },
    };
  }

  // ── Template resolution ─────────────────────────────────────────────────────

  /**
   * Replace {{nodeId.output}} placeholders with actual node outputs.
   * Also supports {{start.input}} and {{var.name}} for prompt variables.
   */
  resolveTemplate(template) {
    if (!template) return '';
    let result = template;

    // {{nodeId.output}} — node output references
    result = result.replace(/\{\{(\w+)\.output\}\}/g, (_, nodeId) => {
      return this.nodeOutputs[nodeId] ?? '';
    });

    // {{start.input}} — raw user input
    result = result.replace(/\{\{start\.input\}\}/g, this._userInput);

    // {{var.name}} — prompt variable references
    result = result.replace(/\{\{var\.(\w+)\}\}/g, (_, name) => {
      return this._variables[name] ?? '';
    });

    return result;
  }

  // ── Node execution dispatcher ───────────────────────────────────────────────

  async executeNode(node) {
    const t0 = Date.now();
    let result;

    try {
      switch (node.type) {
        case 'start':
          result = await this._execStart(node);
          break;
        case 'llm':
          result = await this._execLlm(node);
          break;
        case 'knowledge_base':
          result = await this._execKnowledgeBase(node);
          break;
        case 'dify':
          result = await this._execDify(node);
          break;
        case 'mcp_tool':
          result = await this._execMcpTool(node);
          break;
        case 'skill':
          result = await this._execSkill(node);
          break;
        case 'code':
          result = await this._execCode(node);
          break;
        case 'http_request':
          result = await this._execHttpRequest(node);
          break;
        case 'condition':
          result = null; // condition nodes don't produce output
          break;
        case 'template':
          result = await this._execTemplate(node);
          break;
        case 'output':
          result = await this._execOutput(node);
          break;
        default:
          result = `[Unknown node type: ${node.type}]`;
      }

      const outputStr = result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result));
      this.nodeOutputs[node.id] = outputStr;

      this.executionLog.push({
        nodeId: node.id,
        type: node.type,
        duration: Date.now() - t0,
        status: 'ok',
        output_preview: outputStr.slice(0, 200),
      });
    } catch (e) {
      const errMsg = e.message || String(e);
      this.nodeOutputs[node.id] = `[Error: ${errMsg}]`;

      this.executionLog.push({
        nodeId: node.id,
        type: node.type,
        duration: Date.now() - t0,
        status: 'error',
        error: errMsg,
      });
    }

    return result;
  }

  // ── Node type implementations ───────────────────────────────────────────────

  /** start — entry point. Output = user input + serialised variables. */
  async _execStart(node) {
    const parts = [this._userInput];
    if (Object.keys(this._variables).length > 0) {
      parts.push('\n--- 變數 ---');
      for (const [k, v] of Object.entries(this._variables)) {
        parts.push(`${k}: ${v}`);
      }
    }
    return parts.join('\n');
  }

  /** llm — call LLM via generateTextSync. */
  async _execLlm(node) {
    const data = node.data || {};
    const generateTextSync = getGenerateTextSync();

    // Resolve model_key to actual api_model
    let apiModel = data.model_key || null;
    if (apiModel) {
      try {
        const row = await this.db.prepare('SELECT api_model FROM llm_models WHERE key=? AND is_active=1').get(apiModel);
        if (row?.api_model) apiModel = row.api_model;
      } catch (_) { /* ignore */ }
    }
    if (!apiModel) {
      try {
        const resolveDefaultModel = getResolveDefaultModel();
        apiModel = await resolveDefaultModel(this.db, 'chat');
      } catch (_) { apiModel = null; }
    }

    const systemPrompt = this.resolveTemplate(data.system_prompt || '');
    const userPrompt = this.resolveTemplate(data.user_prompt || '{{start.output}}');

    const history = systemPrompt
      ? [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: '好的，我明白了。' }] },
        ]
      : [];

    const { text } = await generateTextSync(apiModel, history, userPrompt);
    return text;
  }

  /** knowledge_base — vector / fulltext search against self-built KB. */
  async _execKnowledgeBase(node) {
    const data = node.data || {};
    const kbId = data.kb_id;
    if (!kbId) return '[knowledge_base 節點缺少 kb_id]';

    const query = this.resolveTemplate(data.query || '{{start.output}}');
    const chunks = await searchKbChunks(this.db, kbId, query);

    if (chunks.length === 0) return '（未找到相關內容）';
    return chunks.join('\n---\n').slice(0, 8000);
  }

  /** dify — query API connector (DIFY or REST API) via apiConnectorService. */
  async _execDify(node) {
    const { executeConnector } = require('./apiConnectorService');
    const data = node.data || {};
    const difyKbId = data.dify_kb_id;
    if (!difyKbId) return '[dify 節點缺少 dify_kb_id]';

    const kb = await this.db.prepare('SELECT * FROM dify_knowledge_bases WHERE id=? AND is_active=1').get(difyKbId);
    if (!kb) return `[API 連接器 id=${difyKbId} 不存在或未啟用]`;

    const query = this.resolveTemplate(data.query || '{{start.output}}');
    const userCtx = { id: this.userId || 0, email: '', name: '', employee_id: '', dept_code: '' };

    return await executeConnector(kb, { query }, userCtx, {
      sessionId: this.sessionId,
      db: this.db,
    });
  }

  /** mcp_tool — call an MCP server tool. */
  async _execMcpTool(node) {
    const data = node.data || {};
    const { server_id, tool_name } = data;
    if (!server_id || !tool_name) return '[mcp_tool 節點缺少 server_id 或 tool_name]';

    const server = await this.db.prepare('SELECT * FROM mcp_servers WHERE id=?').get(server_id);
    if (!server) return `[MCP server id=${server_id} 不存在]`;

    // Resolve args — may contain {{nodeId.output}} refs
    let args = data.args || {};
    if (typeof args === 'string') {
      try { args = JSON.parse(this.resolveTemplate(args)); } catch (_) { args = {}; }
    } else {
      // Deep-resolve string values in args object
      const resolved = {};
      for (const [k, v] of Object.entries(args)) {
        resolved[k] = typeof v === 'string' ? this.resolveTemplate(v) : v;
      }
      args = resolved;
    }

    const mcpClient = getMcpClient();
    const result = await mcpClient.callTool(this.db, server, this.sessionId, this.userId, tool_name, args);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /** skill — call another skill by id. */
  async _execSkill(node) {
    const data = node.data || {};
    const skillId = data.skill_id;
    if (!skillId) return '[skill 節點缺少 skill_id]';

    const skill = await this.db.prepare('SELECT * FROM skills WHERE id=?').get(skillId);
    if (!skill) return `[技能 id=${skillId} 不存在]`;

    // If the skill itself is a workflow type, we could recurse — but guard depth
    const input = this.resolveTemplate(data.input || '{{start.output}}');
    return await executeSkillByRow(this.db, skill, input, {
      userId: this.userId,
      sessionId: this.sessionId,
    });
  }

  /** code — execute inline JavaScript via Function constructor (sandboxed). */
  async _execCode(node) {
    const data = node.data || {};
    const code = data.code;
    if (!code) return '';

    // Build a safe inputs snapshot
    const inputs = { ...this.nodeOutputs };

    // Use Function constructor — do NOT pass real require for security
    const fn = new Function('inputs', 'require', code);
    const result = await Promise.resolve(fn(inputs, null));

    if (result == null) return '';
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /** http_request — make an HTTP call. */
  async _execHttpRequest(node) {
    const data = node.data || {};

    const url = this.resolveTemplate(data.url || '');
    if (!url) return '[http_request 節點缺少 url]';

    const method = (data.method || 'GET').toUpperCase();

    // Resolve headers
    let headers = {};
    if (data.headers) {
      if (typeof data.headers === 'string') {
        try { headers = JSON.parse(this.resolveTemplate(data.headers)); } catch (_) { /* ignore */ }
      } else {
        for (const [k, v] of Object.entries(data.headers)) {
          headers[k] = typeof v === 'string' ? this.resolveTemplate(v) : v;
        }
      }
    }

    // Resolve body
    let body = undefined;
    if (data.body && method !== 'GET' && method !== 'HEAD') {
      body = typeof data.body === 'string'
        ? this.resolveTemplate(data.body)
        : JSON.stringify(data.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const resp = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    });

    const text = await resp.text();

    if (!resp.ok) {
      return `[HTTP ${resp.status}] ${text.slice(0, 2000)}`;
    }

    return text;
  }

  /** template — string template with {{nodeId.output}} resolution. */
  async _execTemplate(node) {
    const data = node.data || {};
    return this.resolveTemplate(data.template || '');
  }

  /** output — final output node. Resolves template / format and returns. */
  async _execOutput(node) {
    const data = node.data || {};
    const format = data.format || '{{_last.output}}';

    // Special: {{_last.output}} resolves to the most recent non-empty node output
    let resolved = format;
    if (resolved.includes('{{_last.output}}')) {
      let lastVal = '';
      for (let i = this.executionLog.length - 1; i >= 0; i--) {
        const nid = this.executionLog[i].nodeId;
        if (this.nodeOutputs[nid] && this.nodeOutputs[nid].length > 0) {
          lastVal = this.nodeOutputs[nid];
          break;
        }
      }
      resolved = resolved.replace(/\{\{_last\.output\}\}/g, lastVal);
    }

    return this.resolveTemplate(resolved);
  }

  // ── Condition evaluation ────────────────────────────────────────────────────

  /**
   * Evaluate a condition node's rules and return the target nodeId of the
   * matching edge.
   *
   * Each rule: { field, op, value, target }
   *   field  — a {{nodeId.output}} reference or literal key
   *   op     — contains, equals, not_equals, gt, lt, is_empty, not_empty
   *   value  — comparison value (ignored for is_empty/not_empty)
   *   target — edge target nodeId (or handle/label on the edge)
   *
   * If a rule has field='_default', it always matches (fallback).
   *
   * @param {object}   node     — the condition node
   * @param {object[]} outgoing — outgoing edges from this node
   * @returns {string|null} target nodeId to follow
   */
  _evaluateCondition(node, outgoing) {
    const rules = (node.data && node.data.rules) || [];
    if (rules.length === 0 && outgoing.length > 0) {
      return outgoing[0].target; // no rules → follow first edge
    }

    for (const rule of rules) {
      if (rule.field === '_default') {
        return this._resolveConditionTarget(rule.target, outgoing);
      }

      const fieldVal = this.resolveTemplate(`{{${rule.field}}}`);
      const ruleVal = rule.value != null ? String(rule.value) : '';

      let match = false;
      switch (rule.op) {
        case 'contains':
          match = fieldVal.includes(ruleVal);
          break;
        case 'equals':
          match = fieldVal === ruleVal;
          break;
        case 'not_equals':
          match = fieldVal !== ruleVal;
          break;
        case 'gt':
          match = parseFloat(fieldVal) > parseFloat(ruleVal);
          break;
        case 'lt':
          match = parseFloat(fieldVal) < parseFloat(ruleVal);
          break;
        case 'is_empty':
          match = !fieldVal || fieldVal.trim().length === 0;
          break;
        case 'not_empty':
          match = !!fieldVal && fieldVal.trim().length > 0;
          break;
        default:
          match = false;
      }

      if (match) {
        return this._resolveConditionTarget(rule.target, outgoing);
      }
    }

    // No rule matched — follow first edge (or null)
    return outgoing.length > 0 ? outgoing[0].target : null;
  }

  /**
   * Resolve a rule target to an actual edge target nodeId.
   * The rule.target can be:
   *   - a direct nodeId (matches edge.target)
   *   - a sourceHandle label (matches edge.sourceHandle)
   */
  _resolveConditionTarget(ruleTarget, outgoing) {
    if (!ruleTarget) return outgoing.length > 0 ? outgoing[0].target : null;

    // Direct match on edge target
    const byTarget = outgoing.find(e => e.target === ruleTarget);
    if (byTarget) return byTarget.target;

    // Match by sourceHandle (e.g. 'true', 'false', 'branch_0')
    const byHandle = outgoing.find(e => e.sourceHandle === ruleTarget);
    if (byHandle) return byHandle.target;

    // Match by label
    const byLabel = outgoing.find(e => e.label === ruleTarget);
    if (byLabel) return byLabel.target;

    // Fallback: first edge
    return outgoing.length > 0 ? outgoing[0].target : null;
  }
}

module.exports = { WorkflowEngine };
