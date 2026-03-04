'use strict';

/**
 * MCP (Model Context Protocol) Client
 * Supports HTTP/SSE transport with JSON-RPC 2.0
 */

let _reqId = 1;

async function jsonRpc(url, apiKey, method, params = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: _reqId++,
    method,
    params,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (data.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
  return data.result;
}

/**
 * Fetch tool list from MCP server and cache in DB
 */
async function listTools(db, server) {
  // Some MCP servers require an initialize handshake first
  try {
    await jsonRpc(server.url, server.api_key, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'FOXLINK-GPT', version: '1.0' },
    });
  } catch (_) {
    // ignore — some servers skip initialize
  }

  const result = await jsonRpc(server.url, server.api_key, 'tools/list', {});
  const tools = result.tools || [];

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    `UPDATE mcp_servers SET tools_json=?, last_synced_at=?, updated_at=? WHERE id=?`
  ).run(JSON.stringify(tools), now, now, server.id);

  return tools;
}

/**
 * Call a specific MCP tool and log the result
 */
async function callTool(db, server, sessionId, userId, toolName, args) {
  const startMs = Date.now();
  let status = 'ok';
  let errorMsg = null;
  let responsePreview = null;
  let resultContent = null;

  try {
    const result = await jsonRpc(server.url, server.api_key, 'tools/call', {
      name: toolName,
      arguments: args,
    });

    // MCP tool result format: { content: [{type:'text', text:'...'}], isError?: bool }
    const content = result.content || [];
    const textParts = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    resultContent = textParts || JSON.stringify(result);
    responsePreview = resultContent.slice(0, 500);

    if (result.isError) {
      status = 'error';
      errorMsg = responsePreview;
    }
  } catch (e) {
    status = 'error';
    errorMsg = e.message;
    resultContent = `[MCP tool error: ${e.message}]`;
  }

  const durationMs = Date.now() - startMs;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(
    `INSERT INTO mcp_call_logs
      (server_id, session_id, user_id, tool_name, arguments_json, response_preview, status, error_msg, duration_ms, called_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    server.id,
    sessionId || null,
    userId || null,
    toolName,
    JSON.stringify(args),
    responsePreview,
    status,
    errorMsg,
    durationMs,
    now,
  );

  return resultContent;
}

/**
 * Load active servers and convert their tools to Gemini functionDeclarations format.
 * If roleId is provided, only servers assigned to that role are included.
 * Returns { functionDeclarations, serverMap }
 * serverMap: { toolName → server row }
 */
function getActiveToolDeclarations(db, roleId = null) {
  let servers;
  try {
    if (roleId) {
      servers = db.prepare(
        `SELECT m.* FROM mcp_servers m
         JOIN role_mcp_servers rm ON rm.mcp_server_id = m.id
         WHERE rm.role_id=? AND m.is_active=1`
      ).all(roleId);
    } else {
      servers = db.prepare(`SELECT * FROM mcp_servers WHERE is_active=1`).all();
    }
  } catch (_) {
    return { functionDeclarations: [], serverMap: {} };
  }

  const functionDeclarations = [];
  const serverMap = {};

  for (const server of servers) {
    if (!server.tools_json) continue;
    let tools;
    try {
      tools = JSON.parse(server.tools_json);
    } catch (_) {
      continue;
    }

    for (const tool of tools) {
      if (!tool.name) continue;
      // Sanitize name: Gemini only allows [a-zA-Z0-9_]
      const safeName = tool.name.replace(/[^a-zA-Z0-9_]/g, '_');
      functionDeclarations.push({
        name: safeName,
        description: tool.description || tool.name,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      });
      serverMap[safeName] = { server, originalName: tool.name };
    }
  }

  return { functionDeclarations, serverMap };
}

module.exports = { listTools, callTool, getActiveToolDeclarations };
