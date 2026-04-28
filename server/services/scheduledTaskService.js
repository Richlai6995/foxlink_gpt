'use strict';

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

// ── Taiwan time helpers ────────────────────────────────────────────────────────
function twNow() {
  // Returns a Date that prints as Taiwan local time via toLocaleString
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}
function twDateStr(d = twNow()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function twTimestamp(d = twNow()) {
  const date = twDateStr(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${date} ${hh}:${mm}:${ss}`;
}

// ── Concurrency queue ─────────────────────────────────────────────────────────
const MAX_CONCURRENT = 2;
let _running = 0;
const _queue = [];

function enqueue(fn) {
  _queue.push(fn);
  drainQueue();
}

function drainQueue() {
  while (_running < MAX_CONCURRENT && _queue.length > 0) {
    const fn = _queue.shift();
    _running++;
    fn().finally(() => {
      _running--;
      drainQueue();
    });
  }
}

// ── Markdown → plain text (for email body) ────────────────────────────────────
function stripMarkdownForEmail(text) {
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')                        // headers → plain
    .replace(/\*\*(.+?)\*\*/gs, '$1')                          // **bold**
    .replace(/\*(.+?)\*/gs, '$1')                              // *italic*
    .replace(/__(.+?)__/gs, '$1')                              // __bold__
    .replace(/_(.+?)_/gs, '$1')                                // _italic_
    .replace(/`([^`]+)`/g, '$1')                               // `code`
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ( $2 )') // [text](url) → text ( url )
    .replace(/^\s*[-*]\s+/gm, '• ')                            // - / * bullets
    .replace(/^[-*_]{3,}$/gm, '──────────────────────────────') // HR
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Web fetch helper ──────────────────────────────────────────────────────────
async function fetchUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FOXLINK-GPT-Bot/1.0)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();

    const contentType = res.headers.get('content-type') || '';
    const isXml = contentType.includes('xml') || /^\s*(<\?xml|<rss|<feed)/.test(raw);

    let text;
    if (isXml) {
      // RSS/Atom: strip CDATA wrappers first so titles/descriptions are preserved
      text = raw
        .replace(/<!\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .replace(/<\/item>/gi, '\n---\n')   // separator between RSS items
        .replace(/<\/entry>/gi, '\n---\n')  // Atom feeds
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 50000);
    } else {
      // HTML: strip scripts/styles then all tags
      text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ( $1 )') // preserve absolute links only
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/td>/gi, '\t')
        .replace(/<\/th>/gi, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 50000);
    }
    return text;
  } catch (e) {
    return `[無法抓取 ${url}: ${e.message}]`;
  }
}

// ── Web scrape helper (readability-based, for regular HTML pages) ─────────────
async function scrapeUrl(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Use Readability to extract main content
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document, { charThreshold: 100 });
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 200) {
      // Readability got too little — likely JS-rendered, fall back to basic strip
      console.warn(`[Scheduled] scrapeUrl: readability returned thin content for ${url}, falling back to tag-strip`);
      const fallback = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 30000);
      return `以下是從 ${url} 抓取的網頁內容（可能含部分噪音）：\n---\n${fallback}\n---`;
    }

    const title = article.title ? `標題：${article.title}\n\n` : '';
    const byline = article.byline ? `作者：${article.byline}\n` : '';
    const excerpt = article.excerpt ? `摘要：${article.excerpt}\n\n` : '';
    const body = article.textContent.trim().slice(0, 40000);

    return `以下是從 ${url} 抓取的網頁主要內容：\n---\n${title}${byline}${excerpt}${body}\n---`;
  } catch (e) {
    return `[無法爬取 ${url}: ${e.message}]`;
  }
}

// ── Variable substitution (async — supports {{fetch:URL}} / {{scrape:URL}}) ───
function substituteVars(template, taskName) {
  // sync-only version (kept for non-async callers)
  const now = twNow();
  const date = twDateStr(now);
  const weekday = '星期' + WEEKDAY_ZH[now.getDay()];
  return (template || '')
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{weekday\}\}/g, weekday)
    .replace(/\{\{task_name\}\}/g, taskName || '');
}

async function substituteVarsAsync(template, taskName) {
  const now = twNow();
  const date = twDateStr(now);
  const weekday = '星期' + WEEKDAY_ZH[now.getDay()];
  let result = (template || '')
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{weekday\}\}/g, weekday)
    .replace(/\{\{task_name\}\}/g, taskName || '');

  // Process all {{fetch:URL}} placeholders (API / JSON / RSS — unchanged)
  const fetchPattern = /\{\{fetch:(https?:\/\/[^}]+)\}\}/g;
  for (const m of [...result.matchAll(fetchPattern)]) {
    const url = m[1].trim();
    console.log(`[Scheduled] fetch: ${url}`);
    const content = await fetchUrl(url);
    result = result.replace(m[0], `\n以下是從 ${url} 即時抓取的網頁內容（請根據此資料回答）：\n---\n${content}\n---\n`);
  }

  // Process all {{scrape:URL}} placeholders (regular HTML pages via Readability)
  const scrapePattern = /\{\{scrape:(https?:\/\/[^}]+)\}\}/g;
  for (const m of [...result.matchAll(scrapePattern)]) {
    const url = m[1].trim();
    console.log(`[Scheduled] scrape: ${url}`);
    const content = await scrapeUrl(url);
    result = result.replace(m[0], `\n${content}\n`);
  }

  return result;
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function withRetry(fn, maxAttempts) {
  let lastErr;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return { result: await fn(i), attempt: i };
    } catch (e) {
      lastErr = e;
      console.warn(`[Scheduled] Attempt ${i}/${maxAttempts} failed: ${e.message}`);
      if (i < maxAttempts) await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

// ── Core runner ───────────────────────────────────────────────────────────────
async function runTask(db, taskId) {
  const { generateTextSync, generateTitle } = require('./gemini');
  const { processGenerateBlocks } = require('./fileGenerator');
  const { sendMail } = require('./mailService');
  const { resolveToolRefs, hasToolRefs } = require('./promptResolver');
  const { runPipeline } = require('./pipelineRunner');
  const {
    getTemplateSchemaInstruction,
    parseJsonFromAiOutput,
    generateDocumentFromJson,
  } = require('./docTemplateService');

  // 註:多 pod 排程鎖移到 scheduleTask 的 cron handler(slot-based key, TTL 600s)。
  // runTask 故意不再 lock,讓 admin UI「立刻執行」/ retry / pipeline 內部呼叫都能直通。

  const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId);
  if (!task) { console.error(`[Scheduled] Task ${taskId} not found`); return; }

  // Check expiry
  if (task.expire_at && new Date(task.expire_at) < new Date()) {
    console.log(`[Scheduled] Task ${task.id} "${task.name}" expired, pausing`);
    await db.prepare(`UPDATE scheduled_tasks SET status='paused' WHERE id=?`).run(task.id);
    return;
  }
  // Check max_runs
  if (task.max_runs > 0 && task.run_count >= task.max_runs) {
    console.log(`[Scheduled] Task ${task.id} "${task.name}" reached max_runs, pausing`);
    await db.prepare(`UPDATE scheduled_tasks SET status='paused' WHERE id=?`).run(task.id);
    return;
  }
  // Phase 5 Track F-2: Token budget paused?(per-day,隔日 00:00 由 pmTokenBudgetService 解除)
  if (task.token_budget_paused_at || task.TOKEN_BUDGET_PAUSED_AT) {
    const pausedDate = new Date(task.token_budget_paused_at || task.TOKEN_BUDGET_PAUSED_AT).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (pausedDate === today) {
      console.log(`[Scheduled] Task ${task.id} "${task.name}" paused by token budget, skip until 00:00`);
      return;
    }
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(task.user_id);
  if (!user) { console.error(`[Scheduled] User ${task.user_id} not found`); return; }

  const UPLOAD_DIR = process.env.UPLOAD_DIR
    ? require('path').resolve(process.env.UPLOAD_DIR)
    : require('path').join(__dirname, '../uploads');

  const startMs = Date.now();
  let sessionId = null;
  let runStatus = 'ok';
  let runError = null;
  let responseText = '';
  let generatedFiles = [];
  let attemptNum = 1;
  let toolsUsed = { skills: [], kbs: [], mcp_tools: [], dify_kbs: [] };
  let pipelineLog = [];

  try {
    const { result, attempt } = await withRetry(async (tryNum) => {
      attemptNum = tryNum;

      // Resolve model API id(用統一 helper,alias miss 自動 fallback 預設 chat model 而非
      // 把 'pro' / 'flash' 字面傳給 Vertex 變 404)
      const { resolveTaskModel } = require('./llmDefaults');
      const apiModel = await resolveTaskModel(db, task.model, 'chat');

      // Render prompt variables (+ fetch any {{fetch:URL}} placeholders)
      let renderedPrompt = await substituteVarsAsync(task.prompt, task.name);

      // ── {{template:id}} tag in prompt ─────────────────────────────────────
      // Extract template IDs from prompt, strip the tags, append JSON instruction
      const tplTagRe = /\{\{template:([^}]+)\}\}/g;
      const promptTemplateIds = [];
      renderedPrompt = renderedPrompt.replace(tplTagRe, (_, id) => { promptTemplateIds.push(id.trim()); return ''; }).trim();
      // Also honour task-level output_template_id field
      if (task.output_template_id && !promptTemplateIds.includes(task.output_template_id)) {
        promptTemplateIds.push(task.output_template_id);
      }
      // Append JSON schema instructions for each template
      for (const tid of promptTemplateIds) {
        const instr = await getTemplateSchemaInstruction(db, tid).catch(() => null);
        if (instr) renderedPrompt += instr;
      }

      // Resolve tool references {{skill:}}, {{kb:}}, {{mcp:}}, {{dify:}}
      if (hasToolRefs(renderedPrompt)) {
        const resolved = await resolveToolRefs(renderedPrompt, db, {
          userId: task.user_id,
          taskName: task.name,
        });
        renderedPrompt = resolved.resolvedText;
        toolsUsed = resolved.toolsUsed;
      }

      // Create session
      const sid = uuidv4();
      sessionId = sid;
      await db.prepare(
        `INSERT INTO chat_sessions (id, user_id, title, model, source) VALUES (?, ?, ?, ?, 'scheduled')`
      ).run(sid, task.user_id, task.name + ' — ' + twDateStr(), task.model);

      // Insert user message
      await db.prepare(
        `INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)`
      ).run(sid, renderedPrompt);

      // Call Gemini (non-streaming)
      const { text, inputTokens, outputTokens } = await generateTextSync(apiModel, [], renderedPrompt);

      // Insert AI response
      await db.prepare(
        `INSERT INTO chat_messages (session_id, role, content, input_tokens, output_tokens) VALUES (?, 'assistant', ?, ?, ?)`
      ).run(sid, text, inputTokens, outputTokens);

      // Update token_usage (upsert pattern)
      const today = twDateStr();
      const DI = `TO_DATE(?, 'YYYY-MM-DD')`;
      const existing = await db.prepare(
        `SELECT id FROM token_usage WHERE user_id=? AND usage_date=${DI} AND model=?`
      ).get(task.user_id, today, task.model);
      if (existing) {
        await db.prepare(
          'UPDATE token_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+? WHERE id=?'
        ).run(inputTokens, outputTokens, existing.id);
      } else {
        await db.prepare(
          `INSERT INTO token_usage (user_id, usage_date, model, input_tokens, output_tokens) VALUES (?,${DI},?,?,?)`
        ).run(task.user_id, today, task.model, inputTokens, outputTokens);
      }

      // Update session title
      try {
        const title = await generateTitle(renderedPrompt, text);
        await db.prepare('UPDATE chat_sessions SET title=? WHERE id=?').run(title, sid);
      } catch (_) {}

      // Process file generation blocks
      let processableText = text;
      if (task.output_type === 'file' && task.filename_template) {
        // Override all generate block filenames with the task's filename template
        const renderedFilename = substituteVars(task.filename_template, task.name);
        processableText = text.replace(
          /```generate_(\w+):([^\n]+)/g,
          (_match, type) => '```generate_' + type + ':' + renderedFilename
        );
      } else {
        // Always substitute {{date}} / {{weekday}} / {{task_name}} in generate block filenames
        processableText = text.replace(
          /```generate_(\w+):([^\n]+)/g,
          (_match, type, fn) => '```generate_' + type + ':' + substituteVars(fn.trim(), task.name)
        );
      }
      // When template IDs are in play, skip free-form generate blocks to avoid
      // producing a duplicate default-styled file alongside the template output.
      if (promptTemplateIds.length === 0) {
        const blocks = await processGenerateBlocks(processableText, sid);
        generatedFiles = blocks.map(b => ({ filename: b.filename, publicUrl: b.publicUrl, filePath: b.filePath }));
      }

      // ── Template document generation ({{template:id}} or output_template_id) ─
      if (promptTemplateIds.length > 0) {
        const jsonData = parseJsonFromAiOutput(text);
        console.log(`[Scheduled] parseJsonFromAiOutput result: ${jsonData ? JSON.stringify(jsonData).slice(0,200) : 'null'}`);
        if (jsonData) {
          for (const tid of promptTemplateIds) {
            try {
              const tplFile = await generateDocumentFromJson(db, tid, jsonData, user);
              const renderedFilename = substituteVars(task.filename_template || tplFile.filename, task.name);
              generatedFiles.push({ filename: renderedFilename, publicUrl: tplFile.publicUrl, filePath: tplFile.filePath });
              console.log(`[Scheduled] Template ${tid} generated: ${tplFile.filename}`);
            } catch (e) {
              console.error(`[Scheduled] Template ${tid} generation failed:`, e.message, e.stack);
            }
          }
        } else {
          console.warn('[Scheduled] Template requested but AI output is not valid JSON, text snippet:', text.slice(0, 300));
        }
      }

      // ── Audio output: call TTS skill if file_type is mp3/wav ──────────────
      if (task.output_type === 'file' && (task.file_type === 'mp3' || task.file_type === 'wav')) {
        try {
          const FOXLINK_API = `http://127.0.0.1:${process.env.PORT || 3001}`;
          const SERVICE_KEY = process.env.SKILL_SERVICE_KEY || '';
          // Strip code blocks (generate_pdf/xlsx/... blocks) and excess whitespace before TTS
          const ttsText = text
            .replace(/```[\s\S]*?```/g, '')   // remove fenced code blocks
            .replace(/`[^`]+`/g, '')           // remove inline code
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, 4800);                   // Google TTS limit ~5000 bytes
          console.log(`[Scheduled] TTS text length: ${ttsText.length} chars`);
          const ttsRes = await fetch(`${FOXLINK_API}/api/skills/tts/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-service-key': SERVICE_KEY },
            body: JSON.stringify({ text: ttsText, user_id: task.user_id }),
            signal: AbortSignal.timeout(60000),
          });
          if (ttsRes.ok) {
            const ttsData = await ttsRes.json();
            const UPLOAD_DIR = process.env.UPLOAD_DIR
              ? require('path').resolve(process.env.UPLOAD_DIR)
              : require('path').join(__dirname, '../uploads');
            const audioFilename = substituteVars(task.filename_template || `{{task_name}}_{{date}}.mp3`, task.name);
            generatedFiles.push({
              filename: audioFilename,
              publicUrl: ttsData.audio_url,
              filePath: require('path').join(UPLOAD_DIR, 'generated', require('path').basename(ttsData.audio_url)),
            });
          } else {
            const errBody = await ttsRes.json().catch(() => ({}));
            console.error(`[Scheduled] TTS HTTP ${ttsRes.status}: ${errBody.error || ttsRes.statusText}`);
          }
        } catch (e) {
          console.error(`[Scheduled] TTS failed for task ${task.id}: ${e.message}`);
        }
      }

      return { text, inputTokens, outputTokens };
    }, 3);

    responseText = result.text;

    // Update session updated_at
    await db.prepare(`UPDATE chat_sessions SET updated_at=SYSTIMESTAMP WHERE id=?`).run(sessionId);

    // ── Pipeline execution ───────────────────────────────────────────────────
    let pipelineNodes = [];
    try { pipelineNodes = JSON.parse(task.pipeline_json || '[]'); } catch (_) {}
    if (pipelineNodes.length > 0) {
      console.log(`[Scheduled] Running pipeline (${pipelineNodes.length} nodes) for task ${task.id}`);
      try {
        // runId:pipeline 內節點(如 db_write)會把這個值寫進寫入 rows 的 meta_run_id,用於資料血緣
        // 用 startMs(epoch ms)當作 runId,唯一且可近似對應 scheduled_task_runs.run_at
        const runId = startMs;
        const { generatedFiles: pFiles, nodeOutputs, log: pLog } = await runPipeline(
          pipelineNodes,
          responseText,
          db,
          { userId: task.user_id, sessionId, taskName: task.name, user, runId, taskId: task.id }
        );
        generatedFiles.push(...pFiles);
        pipelineLog = pLog;
        console.log(`[Scheduled] Pipeline finished for task ${task.id}: log.length=${pipelineLog.length}, preview=${JSON.stringify(pipelineLog).slice(0, 500)}`);
        // Merge node outputs into response for email body
        // - 一般 AI 輸出(超過 10 字、不以 [ 起首)→ 直接附加
        // - db_write/kb_write 等系統節點輸出(以 [ 起首,如 [DB 寫入: 11 inserted...])→ 蒐集到「📥 資料落地摘要」段
        const normalOutputs = [];
        const systemSummaries = [];
        for (const v of Object.values(nodeOutputs)) {
          if (!v) continue;
          if (typeof v !== 'string') continue;
          if (v.startsWith('[') && v.length < 200) systemSummaries.push(v);
          else if (v.length > 10) normalOutputs.push(v);
        }
        const extras = [];
        if (normalOutputs.length) extras.push(normalOutputs.join('\n\n---\n\n'));
        if (systemSummaries.length) extras.push(`📥 **資料落地摘要**\n${systemSummaries.map(s => '• ' + s).join('\n')}`);
        if (extras.length) responseText = `${responseText}\n\n---\n\n${extras.join('\n\n')}`;
      } catch (e) {
        console.error(`[Scheduled] Pipeline error for task ${task.id}:`, e.message, e.stack);
        pipelineLog = [{ status: 'error', error: e.message }];
      }
    }

  } catch (e) {
    runStatus = 'fail';
    runError = e.message;
    console.error(`[Scheduled] Task ${task.id} "${task.name}" failed after retries: ${e.message}`);
  }

  const durationMs = Date.now() - startMs;

  // ── Send email ──────────────────────────────────────────────────────────────
  let emailSentTo = null;
  try {
    const recipients = JSON.parse(task.recipients_json || '[]');
    // Always include the task owner's email
    if (user.email && !recipients.includes(user.email)) recipients.unshift(user.email);

    if (recipients.length > 0 && runStatus === 'ok') {
      const subject = substituteVars(task.email_subject || '排程任務執行完成：{{task_name}} ({{date}})', task.name);
      const bodyTemplate = task.email_body ||
        '您好，\n\n以下為 {{date}}（{{weekday}}）排程任務「{{task_name}}」的執行結果：\n\n{{ai_response}}\n\n如有附件請見附檔。\n\nCortex';
      // Build tools used summary for email
      const toolsSummary = (() => {
        const parts = [];
        if (toolsUsed.skills?.length) parts.push(`技能：${toolsUsed.skills.map(s => s.name).join('、')}`);
        if (toolsUsed.kbs?.length) parts.push(`知識庫：${toolsUsed.kbs.map(k => k.name).join('、')}`);
        if (toolsUsed.mcp_tools?.length) parts.push(`MCP：${toolsUsed.mcp_tools.join('、')}`);
        return parts.length > 0 ? `使用工具：${parts.join('；')}` : '';
      })();

      const bodyText = substituteVars(bodyTemplate, task.name)
        .replace(/\{\{ai_response\}\}/g, stripMarkdownForEmail(responseText.slice(0, 4000)))
        .replace(/\{\{tools_used\}\}/g, toolsSummary);

      // Build attachments from generated files
      const attachments = generatedFiles
        .filter(f => f.filePath)
        .map(f => ({ filename: f.filename, path: f.filePath })); // use clean filename (no timestamp prefix)

      const sent = await sendMail({
        to: recipients.join(','),
        subject,
        html: bodyText
          .replace(/\n/g, '<br>')
          .replace(/(https?:\/\/[^\s<,()]+)/g, '<a href="$1">$1</a>'),
        text: bodyText,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      if (sent) emailSentTo = recipients.join(', ');
    }
  } catch (e) {
    console.error(`[Scheduled] Email failed for task ${task.id}: ${e.message}`);
  }

  // ── Write run record ────────────────────────────────────────────────────────
  await db.prepare(
    `INSERT INTO scheduled_task_runs
      (task_id, run_at, status, attempt, session_id, response_preview, generated_files_json, email_sent_to, error_msg, duration_ms, tools_used_json, pipeline_log_json)
     VALUES (?, SYSTIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id,
    runStatus,
    attemptNum,
    sessionId,
    responseText.slice(0, 500) || null,
    JSON.stringify(generatedFiles.map(f => ({ filename: f.filename, publicUrl: f.publicUrl }))),
    emailSentTo,
    runError,
    durationMs,
    JSON.stringify(toolsUsed),
    pipelineLog.length > 0 ? JSON.stringify(pipelineLog) : null,
  );

  // ── Update task stats ───────────────────────────────────────────────────────
  await db.prepare(
    `UPDATE scheduled_tasks
     SET run_count=run_count+1, last_run_at=SYSTIMESTAMP, last_run_status=?, updated_at=SYSTIMESTAMP
     WHERE id=?`
  ).run(runStatus, task.id);

  console.log(`[Scheduled] Task ${task.id} "${task.name}" done — status=${runStatus} duration=${durationMs}ms`);
}

// ── Cron management ───────────────────────────────────────────────────────────
const _cronJobs = new Map(); // taskId → cron.ScheduledTask

// 用「排程設計時間 + 當天日期」當 lock key,跨 pod 時鐘漂移仍能阻擋重複觸發。
// 不用 wall-clock minute(舊設計)是因為 enqueue 排隊延遲 + NTP drift 會讓不同 pod
// 算出不同 minute key,等於 lock 失效。Slot-based 不論幾點幾秒進來算的都是同一個 key。
function buildLockKey(task) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const pad = (n) => String(n).padStart(2, '0');

  if (['daily', 'weekly', 'monthly'].includes(task.schedule_type)) {
    return `sched_lock:${task.id}:${today}T${pad(task.schedule_hour ?? 8)}${pad(task.schedule_minute ?? 0)}`;
  }
  if (task.schedule_type === 'multi_time') {
    // multi_time 是整點觸發,當下 hour 就代表 slot
    return `sched_lock:${task.id}:${today}T${pad(now.getHours())}00`;
  }
  if (task.schedule_type === 'interval') {
    const n = Math.max(1, Math.min(23, Number(task.schedule_interval_hours || 4)));
    const bucket = Math.floor(now.getHours() / n) * n;
    return `sched_lock:${task.id}:${today}T${pad(bucket)}00`;
  }
  // cron_raw / 其他:fallback 到當下 hour:minute(精度跟 cron 觸發點對齊)
  return `sched_lock:${task.id}:${today}T${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function buildCronExpr(task) {
  const h = task.schedule_hour ?? 8;
  const m = task.schedule_minute ?? 0;
  switch (task.schedule_type) {
    case 'weekly':  return `${m} ${h} * * ${task.schedule_weekday ?? 1}`;
    case 'monthly': return `${m} ${h} ${task.schedule_monthday ?? 1} * *`;
    case 'interval': {
      // 每 N 小時(N: 1-23)。N=24 等於 daily,引導 user 用 daily 取代。
      const n = Math.max(1, Math.min(23, Number(task.schedule_interval_hours || 4)));
      return `0 */${n} * * *`;
    }
    case 'multi_time': {
      // 多時段。schedule_times_json: ["02:00","08:00","14:00","20:00"]
      let times = [];
      try { times = JSON.parse(task.schedule_times_json || '[]'); } catch (_) {}
      if (!Array.isArray(times) || !times.length) return `0 8 * * *`; // fallback
      const hours = times
        .map(t => String(t).split(':')[0])
        .filter(h => /^\d{1,2}$/.test(h))
        .map(h => Number(h))
        .filter(h => h >= 0 && h <= 23);
      if (!hours.length) return `0 8 * * *`;
      // node-cron 不支援單獨多分鐘,所以多時段都用 :00 整點觸發(實務上夠用)
      return `0 ${hours.join(',')} * * *`;
    }
    case 'cron_raw': {
      // Phase 4 14.5: admin 直接寫 cron expression(min hour day month weekday)
      // 例:'0 18 * * 1-5'(週一到週五 18:00)、'30 9 1 * *'(每月 1 號 09:30)
      // 'L' 表示月底:Oracle / node-cron 不直接支援 'L',user 想要要用 '0 18 28-31 * *' 加 day-check
      const expr = String(task.schedule_cron_expr || '').trim();
      if (!expr || !cron.validate(expr)) {
        console.warn(`[Scheduled] task ${task.id} cron_raw expression invalid: "${expr}", fallback to daily`);
        return `${m} ${h} * * *`;
      }
      return expr;
    }
    default:        return `${m} ${h} * * *`; // daily
  }
}

function scheduleTask(db, task) {
  if (_cronJobs.has(task.id)) {
    _cronJobs.get(task.id).stop();
    _cronJobs.delete(task.id);
  }
  if (task.status !== 'active') return;

  const expr = buildCronExpr(task);
  const job = cron.schedule(expr, async () => {
    // K8s 多 pod 都會跑這個 cron callback。在搶 lock 前先 fetch 最新 task,
    // 若 admin 剛改成 paused 或刪掉就 skip,避免 race。
    let latest;
    try {
      latest = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(task.id);
    } catch (e) {
      console.warn(`[Scheduled] cron handler fetch task ${task.id} failed:`, e.message);
      latest = task;
    }
    if (!latest || latest.status !== 'active') return;

    // 分散式鎖(slot-based + TTL 600s):同一排程 slot 不論 pod 之間時鐘漂移多少,
    // 都解析成同一個 key,只有第一個拿到 lock 的 pod 跑,其他 skip。
    const lockKey = buildLockKey(latest);
    try {
      const { tryLock } = require('./redisClient');
      const acquired = await tryLock(lockKey, 600);
      if (!acquired) {
        console.log(`[Scheduled] Task ${task.id} slot ${lockKey} held by another pod, skip`);
        return;
      }
    } catch (e) {
      console.warn(`[Scheduled] Redis lock failed (${e.message}) — 降級繼續執行(可能會重複)`);
    }

    console.log(`[Scheduled] Triggering task ${task.id} "${task.name}" (slot=${lockKey})`);
    enqueue(() => runTask(db, task.id));
  }, { timezone: 'Asia/Taipei' });

  _cronJobs.set(task.id, job);
  console.log(`[Scheduled] Task ${task.id} "${task.name}" scheduled: ${expr}`);
}

function unscheduleTask(taskId) {
  if (_cronJobs.has(taskId)) {
    _cronJobs.get(taskId).stop();
    _cronJobs.delete(taskId);
    console.log(`[Scheduled] Task ${taskId} unscheduled`);
  }
}

/** Called on server start — load all active tasks from DB */
async function initScheduler(db) {
  try {
    const tasks = await db.prepare(`SELECT * FROM scheduled_tasks WHERE status='active'`).all();
    tasks.forEach(t => scheduleTask(db, t));
    console.log(`[Scheduled] Loaded ${tasks.length} active task(s)`);
  } catch (e) {
    console.error('[Scheduled] initScheduler error:', e.message);
  }
}

module.exports = { initScheduler, scheduleTask, unscheduleTask, runTask, enqueue, substituteVarsAsync };
