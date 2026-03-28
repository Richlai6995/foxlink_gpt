'use strict';

/**
 * Webex Bot Webhook Handler
 *
 * POST /api/webex/webhook  — Webex 事件接收端點
 *
 * 流程:
 *  1. HMAC-SHA1 驗簽
 *  2. 取得完整訊息 (webhook 只傳 ID)
 *  3. 過濾 Bot 自己的訊息
 *  4. email 正規化 → 查 DB user
 *  5. 指令分派: ? / /new / /重置 / /help / 一般對話
 *  6. AI pipeline (generateWithTools, 非 SSE)
 *  7. 生成檔案回傳 Webex
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { getWebexService } = require('../services/webexService');
const { generateWithTools, extractTextFromFile, fileToGeminiPart, transcribeAudio, MODEL_PRO } = require('../services/gemini');
const { processGenerateBlocks } = require('../services/fileGenerator');
const { upsertTokenUsage } = require('../services/tokenService');
const { notifyAdminSensitiveKeyword } = require('../services/mailService');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const WEBEX_TMP_DIR = path.join(UPLOAD_DIR, 'webex_tmp');
if (!fs.existsSync(WEBEX_TMP_DIR)) fs.mkdirSync(WEBEX_TMP_DIR, { recursive: true });

const MAX_HISTORY_MESSAGES = 20;
const MAX_WEBEX_CHARS = 4000; // Webex 實際限制 ~7439 bytes，留餘裕
const WEBEX_SYSTEM_SUFFIX = `

---
【Webex 回覆格式規範】
你正在透過 Webex 訊息視窗回覆，請遵守：
1. 回覆精簡，重點優先，避免冗長鋪陳
2. 用 bullet list 取代大段落，每條不超過 40 字
3. 避免寬表格（改用清單呈現）
4. Markdown 僅使用粗體、清單、代碼塊（Webex 支援有限）
5. 如回答需要詳細版，結尾加：「💡 需詳細版本請至 Web 介面查看」
`;

// ── 驗簽 ──────────────────────────────────────────────────────────────────────
function verifySignature(rawBody, signature, secret) {
  if (!secret) return true; // 未設定 secret 時跳過驗簽（不建議用於 prod）
  if (!signature) return false;
  try {
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(rawBody);
    const expected = hmac.digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature.toLowerCase(), 'hex'),
      Buffer.from(expected.toLowerCase(), 'hex')
    );
  } catch (e) {
    return false;
  }
}

// ── Email 正規化 ───────────────────────────────────────────────────────────────
// @foxlink.com.tw → @foxlink.com，不分大小寫
function normalizeEmail(email) {
  return (email || '').toLowerCase().replace(/@foxlink\.com\.tw$/i, '@foxlink.com');
}

// ── 取台北時區日期字串 YYYY-MM-DD ─────────────────────────────────────────────
function getTaipeiDateStr() {
  return new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-');
}

// ── 去除 @Bot mention 前綴 ────────────────────────────────────────────────────
function stripMention(text, botName) {
  if (!text) return '';
  // 去除 HTML mention 標籤 (透過 message.text 取得的通常已是純文字)
  let clean = text.replace(/<spark-mention[^>]*>.*?<\/spark-mention>/gi, '').trim();
  // 去除 "@BotName " 前綴（群組 room 常見）
  if (botName) {
    clean = clean.replace(new RegExp(`^@?${botName}\\s*`, 'i'), '').trim();
  }
  return clean;
}

// ── DB 查用戶（email 正規化比對）────────────────────────────────────────────────
async function findUserByEmail(db, rawEmail) {
  const normalized = normalizeEmail(rawEmail);
  const row = await db.prepare(
    `SELECT id, username, name, email, role, status,
            allow_text_upload, text_max_mb,
            allow_audio_upload, audio_max_mb,
            allow_image_upload, image_max_mb,
            budget_daily, budget_weekly, budget_monthly,
            role_id, dept_code, profit_center, org_section, org_group_name
     FROM users
     WHERE LOWER(REPLACE(email, '.com.tw', '.com')) = ?
     FETCH FIRST 1 ROWS ONLY`
  ).get(normalized);
  return row;
}

// ── 取得或建立 Webex Session ──────────────────────────────────────────────────
async function getOrCreateSession(db, userId, roomId, isDm) {
  const today = getTaipeiDateStr();

  if (isDm) {
    // DM: 每日新 session
    const existing = await db.prepare(
      `SELECT id FROM chat_sessions
       WHERE user_id=? AND source='webex_dm'
         AND TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') = ?
       ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY`
    ).get(userId, today);
    if (existing) return existing.id;
  } else {
    // Room: 永久 session
    const existing = await db.prepare(
      `SELECT id FROM chat_sessions
       WHERE webex_room_id=? AND source='webex_room'
       ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY`
    ).get(roomId);
    if (existing) return existing.id;
  }

  // 建立新 session
  const sessionId = uuidv4();
  const source = isDm ? 'webex_dm' : 'webex_room';
  const title = isDm ? `Webex DM ${today}` : `Webex Room ${roomId.slice(-8)}`;
  await db.prepare(
    `INSERT INTO chat_sessions (id, user_id, title, model, source, webex_room_id)
     VALUES (?, ?, ?, 'pro', ?, ?)`
  ).run(sessionId, userId, title, source, isDm ? null : roomId);
  return sessionId;
}

// ── 強制新開 Session ──────────────────────────────────────────────────────────
async function createNewSession(db, userId, roomId, isDm) {
  const today = getTaipeiDateStr();
  const sessionId = uuidv4();
  const source = isDm ? 'webex_dm' : 'webex_room';
  const title = isDm ? `Webex DM ${today}` : `Webex Room ${roomId.slice(-8)}`;
  await db.prepare(
    `INSERT INTO chat_sessions (id, user_id, title, model, source, webex_room_id)
     VALUES (?, ?, ?, 'pro', ?, ?)`
  ).run(sessionId, userId, title, source, isDm ? null : roomId);
  return sessionId;
}

// ── 工具清單（? 指令）────────────────────────────────────────────────────────
async function buildToolList(db, user) {
  const lines = ['📋 **您可使用的工具**（依帳號授權）\n'];

  // Skills
  try {
    const skills = await db.prepare(
      `SELECT name, description FROM skills
       WHERE is_public=1
          OR owner_user_id=?
          OR EXISTS (
            SELECT 1 FROM skill_access sa WHERE sa.skill_id=skills.id
            AND ((sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
              OR (sa.grantee_type='role' AND sa.grantee_id=TO_CHAR(?)))
          )
       ORDER BY name ASC`
    ).all(user.id, user.id, user.role_id || 0);
    if (skills.length > 0) {
      lines.push('🔧 **技能 (Skills)**：');
      skills.forEach(s => {
        const desc = s.description ? ` — ${s.description.slice(0, 30)}` : '';
        lines.push(`• ${s.name}${desc}`);
      });
      lines.push('');
    }
  } catch (e) {
    console.warn('[Webex] buildToolList skills error:', e.message);
  }

  // 自建 KB
  try {
    let kbs;
    if (user.role === 'admin') {
      kbs = await db.prepare(
        `SELECT name, description FROM knowledge_bases WHERE chunk_count>0 ORDER BY name ASC`
      ).all();
    } else {
      kbs = await db.prepare(
        `SELECT kb.name, kb.description FROM knowledge_bases kb
         WHERE kb.chunk_count>0 AND (
           kb.creator_id=? OR kb.is_public=1
           OR EXISTS (
             SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id
             AND ((ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
               OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
               OR (ka.grantee_type='dept' AND ka.grantee_id=? AND ? IS NOT NULL))
           )
         )
         ORDER BY kb.name ASC`
      ).all(user.id, user.id, user.role_id || 0, user.dept_code, user.dept_code);
    }
    if (kbs.length > 0) {
      lines.push('🧠 **自建知識庫 (KB)**：');
      kbs.forEach(k => {
        const desc = k.description ? ` — ${k.description.slice(0, 30)}` : '';
        lines.push(`• ${k.name}${desc}`);
      });
      lines.push('');
    }
  } catch (e) {
    console.warn('[Webex] buildToolList selfKB error:', e.message);
  }

  // DIFY KB
  try {
    const difyKbs = await db.prepare(
      `SELECT DISTINCT d.name, d.description FROM dify_knowledge_bases d
       WHERE d.is_active=1 AND (
         (d.is_public=1 AND d.public_approved=1)
         OR EXISTS (
           SELECT 1 FROM dify_access a WHERE a.dify_kb_id=d.id
           AND ((a.grantee_type='user' AND a.grantee_id=TO_CHAR(?))
             OR (a.grantee_type='role' AND a.grantee_id=TO_CHAR(?)))
         )
       )
       ORDER BY d.sort_order ASC`
    ).all(user.id, user.role_id || 0);
    if (difyKbs.length > 0) {
      lines.push('🔌 **DIFY 知識庫**：');
      difyKbs.forEach(k => {
        const desc = k.description ? ` — ${k.description.slice(0, 30)}` : '';
        lines.push(`• ${k.name}${desc}`);
      });
      lines.push('');
    }
  } catch (e) {
    console.warn('[Webex] buildToolList dify error:', e.message);
  }

  // MCP
  try {
    const mcpServers = await db.prepare(
      `SELECT name, description FROM mcp_servers WHERE is_active=1 ORDER BY name ASC`
    ).all();
    if (mcpServers.length > 0) {
      lines.push('⚙️ **MCP 工具**：');
      mcpServers.forEach(m => {
        const desc = m.description ? ` — ${m.description.slice(0, 30)}` : '';
        lines.push(`• ${m.name}${desc}`);
      });
      lines.push('');
    }
  } catch (e) {
    console.warn('[Webex] buildToolList mcp error:', e.message);
  }

  if (lines.length <= 1) {
    lines.push('（目前無可用工具）');
  } else {
    lines.push('💡 直接輸入問題，AI 將自動判斷並使用合適工具。');
  }

  return lines.join('\n');
}

// ── 稽核 ──────────────────────────────────────────────────────────────────────
async function checkSensitiveKeywords(db, user, sessionId, content) {
  try {
    const keywords = await db.prepare(`SELECT keyword FROM sensitive_keywords`).all();
    const lowerContent = content.toLowerCase();
    const matched = keywords.map(k => k.keyword).filter(kw => lowerContent.includes(kw.toLowerCase()));
    const hasSensitive = matched.length > 0 ? 1 : 0;

    await db.prepare(
      `INSERT INTO audit_logs (user_id, session_id, content, has_sensitive, sensitive_keywords)
       VALUES (?, ?, ?, ?, ?)`
    ).run(user.id, sessionId, content.slice(0, 4000), hasSensitive, matched.length ? JSON.stringify(matched) : null);

    if (hasSensitive) {
      notifyAdminSensitiveKeyword({ user, content, keywords: matched, sessionId }).catch(e => {
        console.error('[Webex][Audit] notify error:', e.message);
      });
    }
  } catch (e) {
    console.error('[Webex][Audit] error:', e.message);
  }
}

// ── 載入 function declarations（selfKB + DIFY + MCP）────────────────────────
async function loadFunctionDeclarations(db, user) {
  const declarations = [];
  const handlers = {};

  // ── 自建 KB ─────────────────────────────────────────────────────────────────
  try {
    let kbs;
    if (user.role === 'admin') {
      kbs = await db.prepare(
        `SELECT id, name, description, retrieval_mode, embedding_dims, top_k_return, score_threshold
         FROM knowledge_bases WHERE chunk_count>0 ORDER BY name ASC`
      ).all();
    } else {
      kbs = await db.prepare(
        `SELECT kb.id, kb.name, kb.description, kb.retrieval_mode, kb.embedding_dims, kb.top_k_return, kb.score_threshold
         FROM knowledge_bases kb
         WHERE kb.chunk_count>0 AND (
           kb.creator_id=? OR kb.is_public=1
           OR EXISTS (SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
             (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
             OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
           ))
         )
         ORDER BY kb.name ASC`
      ).all(user.id, user.id, user.role_id || 0);
    }

    for (const kb of kbs) {
      const fnName = `selfkb_${kb.id.replace(/-/g, '_')}`;
      declarations.push({
        name: fnName,
        description: `查詢自建知識庫「${kb.name}」。${kb.description ? `適用範疇：${kb.description}` : ''}。每次對話此工具只呼叫一次。`,
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '查詢問題' } },
          required: ['query'],
        },
      });
      handlers[fnName] = async (args) => {
        try {
          const { embedText, toVectorStr } = require('../services/kbEmbedding');
          const query = args.query || '';
          const topK = Math.min(Number(kb.top_k_return) || 5, 10);
          const dims = kb.embedding_dims || 768;
          const thresh = Number(kb.score_threshold) || 0;
          const mode = kb.retrieval_mode || 'hybrid';

          let results = [];
          if (mode === 'vector' || mode === 'hybrid') {
            const qEmb = await embedText(query, { dims });
            const qVecStr = toVectorStr(qEmb);
            const rows = await db.prepare(
              `SELECT c.content, d.filename,
                      VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vs
               FROM kb_chunks c JOIN kb_documents d ON d.id=c.doc_id
               WHERE c.kb_id=? AND c.chunk_type != 'parent'
               ORDER BY vs ASC FETCH FIRST ? ROWS ONLY`
            ).all(qVecStr, kb.id, topK * 2);
            results = rows.map(r => ({ ...r, score: 1 - (r.vs || 0) }));
          }
          if (mode === 'fulltext' || mode === 'hybrid') {
            const likeQ = `%${query.replace(/[%_]/g, '\\$&')}%`;
            const ftRows = await db.prepare(
              `SELECT c.content, d.filename, 0.5 AS score
               FROM kb_chunks c JOIN kb_documents d ON d.id=c.doc_id
               WHERE c.kb_id=? AND c.chunk_type!='parent' AND UPPER(c.content) LIKE UPPER(?)
               FETCH FIRST ? ROWS ONLY`
            ).all(kb.id, likeQ, topK);
            if (mode === 'fulltext') {
              results = ftRows.map(r => ({ ...r, score: 0.5 }));
            } else {
              const vIds = new Set(results.map(r => r.content?.slice(0, 50)));
              for (const r of ftRows) {
                if (!vIds.has(r.content?.slice(0, 50))) results.push(r);
              }
            }
          }

          results = results.filter(r => r.score >= thresh).sort((a, b) => b.score - a.score).slice(0, topK);
          if (results.length === 0) return `[知識庫「${kb.name}」未找到相關內容]`;
          return `【知識庫「${kb.name}」結果】\n\n` + results.map((r, i) =>
            `[${i + 1}] 來源: ${r.filename} (${(r.score * 100).toFixed(0)}%)\n${r.content}`
          ).join('\n\n---\n\n');
        } catch (e) {
          return `[知識庫「${kb.name}」查詢失敗: ${e.message}]`;
        }
      };
    }
  } catch (e) {
    console.warn('[Webex] loadFunctionDeclarations selfKB error:', e.message);
  }

  // ── DIFY KB ──────────────────────────────────────────────────────────────────
  try {
    const difyKbs = await db.prepare(
      `SELECT DISTINCT d.id, d.name, d.api_server, d.api_key, d.description
       FROM dify_knowledge_bases d
       WHERE d.is_active=1 AND (
         (d.is_public=1 AND d.public_approved=1)
         OR EXISTS (SELECT 1 FROM dify_access a WHERE a.dify_kb_id=d.id AND (
           (a.grantee_type='user' AND a.grantee_id=TO_CHAR(?))
           OR (a.grantee_type='role' AND a.grantee_id=TO_CHAR(?))
         ))
       )
       ORDER BY d.sort_order ASC`
    ).all(user.id, user.role_id || 0);

    for (const kb of difyKbs) {
      const fnName = `dify_kb_${kb.id}`;
      const scopeText = kb.description ? `適用範疇：${kb.description}` : `企業知識庫「${kb.name}」`;
      declarations.push({
        name: fnName,
        description: `知識庫查詢「${kb.name}」。${scopeText}。同一輪只呼叫一次。`,
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '查詢問題' } },
          required: ['query'],
        },
      });
      handlers[fnName] = async (args) => {
        try {
          const query = args.query || '';
          const apiKey = kb.api_key || '';
          const apiServer = (kb.api_server || 'https://api.dify.ai').replace(/\/$/, '');
          const res = await require('axios').post(
            `${apiServer}/v1/chat-messages`,
            { inputs: {}, query, response_mode: 'blocking', conversation_id: '', user: String(user.id) },
            { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
          );
          const answer = res.data?.answer || res.data?.message || '無結果';
          return `【DIFY「${kb.name}」結果】\n${answer}`;
        } catch (e) {
          return `[DIFY「${kb.name}」查詢失敗: ${e.message}]`;
        }
      };
    }
  } catch (e) {
    console.warn('[Webex] loadFunctionDeclarations dify error:', e.message);
  }

  // ── MCP ──────────────────────────────────────────────────────────────────────
  try {
    const mcpClient = require('../services/mcpClient');
    const mcpServers = await db.prepare(
      `SELECT id, name, endpoint_url, is_active FROM mcp_servers WHERE is_active=1 ORDER BY name ASC`
    ).all();

    for (const srv of mcpServers) {
      try {
        const tools = await mcpClient.listTools(srv.id);
        for (const tool of (tools || [])) {
          const fnName = `mcp_${srv.id}_${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
          declarations.push({
            name: fnName,
            description: `[MCP:${srv.name}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema || { type: 'object', properties: {} },
          });
          handlers[fnName] = async (args) => {
            try {
              const result = await mcpClient.callTool(srv.id, tool.name, args);
              return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            } catch (e) {
              return `[MCP "${tool.name}" 錯誤: ${e.message}]`;
            }
          };
        }
      } catch (e) {
        console.warn(`[Webex] MCP server "${srv.name}" tools load failed:`, e.message);
      }
    }
  } catch (e) {
    console.warn('[Webex] loadFunctionDeclarations mcp error:', e.message);
  }

  return { declarations, handlers };
}

// ── 主訊息處理 ─────────────────────────────────────────────────────────────────
async function processMessage(db, webex, user, sessionId, roomId, messageText, fileUrls, isDm) {
  const today = getTaipeiDateStr();

  // 1. 下載並處理附件
  const userParts = [];
  let combinedText = messageText;
  const fileMetas = [];

  for (const fileUrl of fileUrls) {
    const tmpName = `webex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tmpPath = path.join(WEBEX_TMP_DIR, tmpName);
    let downloaded = null;

    try {
      downloaded = await webex.downloadFile(fileUrl, tmpPath);
      const { filename, mimeType } = downloaded;
      const sizeMb = fs.statSync(tmpPath).size / 1024 / 1024;

      // 影片檔拒絕
      if (mimeType.startsWith('video/')) {
        await webex.sendMessage(roomId, `❌ 不支援影片檔（${filename}），請傳送音訊或文件。`);
        fs.unlink(tmpPath, () => {});
        continue;
      }

      // 音訊轉錄
      if (mimeType.startsWith('audio/')) {
        const maxMb = user.audio_max_mb || 10;
        if (!user.allow_audio_upload) {
          await webex.sendMessage(roomId, `❌ 您的帳號無音訊上傳權限（${filename}），請聯絡管理員。`);
          fs.unlink(tmpPath, () => {});
          continue;
        }
        if (sizeMb > maxMb) {
          await webex.sendMessage(roomId, `❌ 音訊檔超過上限 ${maxMb}MB（${filename}）。`);
          fs.unlink(tmpPath, () => {});
          continue;
        }
        try {
          const res = await transcribeAudio(tmpPath, mimeType);
          combinedText += `\n\n[音訊轉錄: ${filename}]\n${res.text}`;
          fileMetas.push({ name: filename, type: 'audio' });
          if (res.inputTokens || res.outputTokens) {
            await upsertTokenUsage(db, user.id, today, 'flash', res.inputTokens, res.outputTokens, 0);
          }
        } catch (e) {
          console.error('[Webex] Audio transcribe error:', e.message);
          combinedText += `\n\n[音訊轉錄失敗: ${filename}]`;
        }
        fs.unlink(tmpPath, () => {});
        continue;
      }

      // 圖片
      if (mimeType.startsWith('image/')) {
        if (user.allow_image_upload === 0) {
          await webex.sendMessage(roomId, `❌ 您的帳號無圖片上傳權限（${filename}）。`);
          fs.unlink(tmpPath, () => {});
          continue;
        }
        const maxMb = user.image_max_mb || 10;
        if (sizeMb > maxMb) {
          await webex.sendMessage(roomId, `❌ 圖片超過上限 ${maxMb}MB（${filename}）。`);
          fs.unlink(tmpPath, () => {});
          continue;
        }
        userParts.push(await fileToGeminiPart(tmpPath, mimeType));
        fileMetas.push({ name: filename, type: 'image' });
        fs.unlink(tmpPath, () => {});
        continue;
      }

      // PDF inline
      const MAX_PDF_INLINE_MB = 15;
      if (mimeType === 'application/pdf' && sizeMb <= MAX_PDF_INLINE_MB) {
        userParts.push(await fileToGeminiPart(tmpPath, mimeType));
        fileMetas.push({ name: filename, type: 'document' });
        fs.unlink(tmpPath, () => {});
        continue;
      }

      // 其他文件 → 文字提取
      const extracted = await extractTextFromFile(tmpPath, mimeType, filename);
      if (extracted) {
        combinedText += `\n\n${extracted}`;
        fileMetas.push({ name: filename, type: 'document' });
      } else {
        fileMetas.push({ name: filename, type: 'unknown' });
      }
      fs.unlink(tmpPath, () => {});

    } catch (e) {
      console.error('[Webex] File download/process error:', e.message);
      if (fs.existsSync(tmpPath)) fs.unlink(tmpPath, () => {});
    }
  }

  if (combinedText.trim()) {
    userParts.push({ text: combinedText });
  }

  if (userParts.length === 0) return;

  // 2. 儲存用戶訊息
  await db.prepare(
    `INSERT INTO chat_messages (session_id, role, content, files_json) VALUES (?, 'user', ?, ?)`
  ).run(sessionId, combinedText, fileMetas.length ? JSON.stringify(fileMetas) : null);

  // 3. 稽核
  await checkSensitiveKeywords(db, user, sessionId, combinedText);

  // 4. 載入歷史
  const historyMsgs = await db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE session_id=? ORDER BY created_at DESC FETCH FIRST ? ROWS ONLY`
  ).all(sessionId, MAX_HISTORY_MESSAGES);
  // 倒序回正序，移除最後一筆（剛插入的用戶訊息）
  const history = historyMsgs.reverse().slice(0, -1).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || ' ' }],
  }));

  // 5. 載入工具
  const { declarations, handlers } = await loadFunctionDeclarations(db, user);

  // 6. 呼叫 AI
  const { apiModel } = await resolveApiModel(db, 'pro');
  console.log(`[Webex] Calling AI model=${apiModel} user=${user.username} session=${sessionId} tools=${declarations.length}`);

  let aiText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const result = await generateWithTools(
      apiModel,
      history,
      userParts,
      declarations,
      async (name, args) => {
        const handler = handlers[name];
        if (!handler) return `[未知工具: ${name}]`;
        return handler(args);
      },
      WEBEX_SYSTEM_SUFFIX
    );
    aiText = result.text || '';
    inputTokens = result.inputTokens || 0;
    outputTokens = result.outputTokens || 0;
  } catch (e) {
    console.error('[Webex] AI call error:', e.message);
    await webex.sendMessage(roomId, `❌ AI 服務暫時發生錯誤，請稍後重試。\n（${e.message?.slice(0, 80)}）`);
    return;
  }

  // 7. 處理 generate_xxx 代碼塊
  let generatedFiles = [];
  try {
    const genResult = await processGenerateBlocks(aiText, { userId: user.id, sessionId });
    if (genResult?.files?.length) {
      generatedFiles = genResult.files;
      // 清除 code block，只保留說明文字
      aiText = aiText.replace(/```generate_[a-z_]+:[^\n]+\n[\s\S]*?```/g, '').trim();
    }
  } catch (e) {
    console.warn('[Webex] processGenerateBlocks error:', e.message);
  }

  // 8. 截斷過長回應
  if (aiText.length > MAX_WEBEX_CHARS) {
    const publicUrl = process.env.WEBEX_PUBLIC_URL || '';
    aiText = aiText.slice(0, MAX_WEBEX_CHARS) +
      `\n\n…（回應過長已截斷${publicUrl ? `，完整版請至 ${publicUrl}` : ''}）`;
  }

  // 9. 儲存 AI 訊息
  await db.prepare(
    `INSERT INTO chat_messages (session_id, role, content, input_tokens, output_tokens) VALUES (?, 'assistant', ?, ?, ?)`
  ).run(sessionId, aiText, inputTokens, outputTokens);

  // 10. 更新 session
  await db.prepare(`UPDATE chat_sessions SET updated_at=SYSTIMESTAMP WHERE id=?`).run(sessionId);

  // 11. 記錄 token
  await upsertTokenUsage(db, user.id, today, 'pro', inputTokens, outputTokens, 0);

  // 12. 送回 Webex 文字回應
  if (aiText.trim()) {
    await webex.sendMessage(roomId, aiText, { markdown: aiText });
  }

  // 13. 送回生成的檔案
  for (const file of generatedFiles) {
    try {
      const filePath = path.join(UPLOAD_DIR, 'generated', file.filename);
      if (fs.existsSync(filePath)) {
        await webex.sendFile(roomId, `📄 已生成：${file.filename}`, filePath);
      }
    } catch (e) {
      console.error('[Webex] File send error:', e.message);
    }
  }
}

// ── 解析 API model ─────────────────────────────────────────────────────────────
async function resolveApiModel(db, modelKey) {
  try {
    const row = await db.prepare(
      `SELECT api_model FROM llm_models WHERE key=? AND is_active=1 FETCH FIRST 1 ROWS ONLY`
    ).get(modelKey);
    if (row?.api_model) return { apiModel: row.api_model };
  } catch (e) {}
  if (modelKey === 'flash') return { apiModel: process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash' };
  return { apiModel: process.env.GEMINI_MODEL_PRO || 'gemini-2.0-pro' };
}

// ── Webhook 端點 ───────────────────────────────────────────────────────────────
// 注意：需要 raw body 做驗簽，使用 express.raw() middleware
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // 立即回 200（Webex 要求 15 秒內回應）
  res.sendStatus(200);

  const secret = process.env.WEBEX_WEBHOOK_SECRET;
  const signature = req.headers['x-spark-signature'];
  const rawBody = req.body;

  // 驗簽
  if (!verifySignature(rawBody, signature, secret)) {
    console.warn('[Webex] Signature mismatch from', req.ip);
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch (e) {
    console.error('[Webex] JSON parse error:', e.message);
    return;
  }

  // 只處理 messages:created
  if (event.resource !== 'messages' || event.event !== 'created') return;

  // 背景處理（不 block response）
  setImmediate(() => handleWebexEvent(event).catch(e => {
    console.error('[Webex] handleWebexEvent uncaught:', e.message, e.stack);
  }));
});

async function handleWebexEvent(event) {
  const db = require('../database-oracle').db;
  let webex;
  try {
    webex = getWebexService();
  } catch (e) {
    console.error('[Webex] getWebexService error:', e.message);
    return;
  }

  // 過濾 Bot 自己發的訊息
  const botPersonId = await webex.getBotPersonId().catch(() => null);
  if (botPersonId && event.actorId === botPersonId) return;
  if (botPersonId && event.data?.personId === botPersonId) return;

  // 取得完整訊息
  let message;
  try {
    message = await webex.getMessage(event.data.id);
  } catch (e) {
    console.error('[Webex] getMessage error:', e.message);
    return;
  }

  const senderEmail = message.personEmail || '';
  const roomId = message.roomId;
  const isDm = message.roomType === 'direct';

  console.log(`[Webex] ${isDm ? 'DM' : 'Room'} from ${senderEmail} room=${roomId}`);

  // 查 user
  const user = await findUserByEmail(db, senderEmail);
  if (!user) {
    await webex.sendMessage(roomId,
      `⚠️ 您的帳號（${senderEmail}）尚未在 FOXLINK GPT 系統中註冊。\n請聯絡系統管理員申請帳號。`
    );
    return;
  }
  if (user.status !== 'active') {
    await webex.sendMessage(roomId,
      `⚠️ 您的帳號目前已停用，請聯絡系統管理員。`
    );
    return;
  }

  // 取得 Bot 名稱（用來剝 mention）
  let botName = 'FOXLINK GPT';
  try {
    const meRes = await webex.client.get('/people/me');
    botName = meRes.data.displayName || botName;
  } catch (_) {}

  // 解析訊息文字（去 mention）
  const rawText = message.text || '';
  const msgText = stripMention(rawText, botName).trim();

  // 非 DM 時若訊息為空（只有 mention）直接略過
  if (!isDm && !msgText && (!message.files || message.files.length === 0)) return;

  // 取得/建立 session
  let sessionId = await getOrCreateSession(db, user.id, roomId, isDm);

  // ── 指令分派 ──────────────────────────────────────────────────────────────
  const cmdText = msgText.toLowerCase();

  // ? → 工具清單
  if (msgText === '?') {
    const toolList = await buildToolList(db, user);
    await webex.sendMessage(roomId, toolList, { markdown: toolList });
    return;
  }

  // /new 或 /重置 → 新 session
  if (cmdText === '/new' || cmdText === '/重置') {
    sessionId = await createNewSession(db, user.id, roomId, isDm);
    await webex.sendMessage(roomId, '✅ 已開啟新對話，之前的對話記憶已清除。\n請輸入您的問題。');
    return;
  }

  // /help → 使用說明
  if (cmdText === '/help') {
    const helpText = [
      '🤖 **FOXLINK GPT Bot 使用說明**\n',
      '📌 **指令**：',
      '• `?` — 查看您的可用工具清單',
      '• `/new` — 開啟新對話（清除記憶）',
      '• `/help` — 顯示此說明\n',
      '📎 **附件支援**：',
      '• PDF、Word、Excel、PPT、圖片、音訊',
      '• AI 可讀取附件內容並回答',
      '• AI 生成的 Excel/PDF 等會以附件回傳\n',
      '⚠️ **注意**：',
      '• 群組 Room 請 @Bot 後輸入問題',
      '• 回覆約需 10-30 秒，請稍候',
    ].join('\n');
    await webex.sendMessage(roomId, helpText, { markdown: helpText });
    return;
  }

  // 一般訊息 → AI 處理
  const fileUrls = message.files || [];
  console.log(`[Webex] Processing chat: user=${user.username} session=${sessionId} text="${msgText.slice(0, 50)}" files=${fileUrls.length}`);

  await processMessage(db, webex, user, sessionId, roomId, msgText, fileUrls, isDm);
}

module.exports = router;
