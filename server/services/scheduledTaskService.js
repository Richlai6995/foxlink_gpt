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

  try {
    const { result, attempt } = await withRetry(async (tryNum) => {
      attemptNum = tryNum;

      // Resolve model API id
      let apiModel = task.model;
      try {
        const row = await db.prepare('SELECT api_model FROM llm_models WHERE key=? AND is_active=1').get(task.model);
        if (row?.api_model) apiModel = row.api_model;
      } catch (_) {}

      // Render prompt variables (+ fetch any {{fetch:URL}} placeholders)
      const renderedPrompt = await substituteVarsAsync(task.prompt, task.name);

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
      const existing = await db.prepare(
        'SELECT id FROM token_usage WHERE user_id=? AND usage_date=? AND model=?'
      ).get(task.user_id, today, task.model);
      if (existing) {
        await db.prepare(
          'UPDATE token_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+? WHERE id=?'
        ).run(inputTokens, outputTokens, existing.id);
      } else {
        await db.prepare(
          'INSERT INTO token_usage (user_id, usage_date, model, input_tokens, output_tokens) VALUES (?,?,?,?,?)'
        ).run(task.user_id, today, task.model, inputTokens, outputTokens);
      }

      // Update session title
      try {
        const title = await generateTitle(renderedPrompt, text);
        await db.prepare('UPDATE chat_sessions SET title=? WHERE id=?').run(title, sid);
      } catch (_) {}

      // Process file generation blocks
      // If task has a filename_template, override AI-generated filename with it
      let processableText = text;
      if (task.output_type === 'file' && task.filename_template) {
        const renderedFilename = substituteVars(task.filename_template, task.name);
        // Replace only the filename part in generate blocks, keep the type
        processableText = text.replace(
          /```generate_(\w+):([^\n]+)/g,
          (_match, type) => '```generate_' + type + ':' + renderedFilename
        );
      }
      const blocks = await processGenerateBlocks(processableText, sid);
      generatedFiles = blocks.map(b => ({ filename: b.filename, publicUrl: b.publicUrl, filePath: b.filePath }));

      return { text, inputTokens, outputTokens };
    }, 3);

    responseText = result.text;

    // Update session updated_at
    await db.prepare(`UPDATE chat_sessions SET updated_at=? WHERE id=?`).run(twTimestamp(), sessionId);

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
        '您好，\n\n以下為 {{date}}（{{weekday}}）排程任務「{{task_name}}」的執行結果：\n\n{{ai_response}}\n\n如有附件請見附檔。\n\nFOXLINK GPT';
      const bodyText = substituteVars(bodyTemplate, task.name)
        .replace(/\{\{ai_response\}\}/g, stripMarkdownForEmail(responseText.slice(0, 4000)));

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
      (task_id, run_at, status, attempt, session_id, response_preview, generated_files_json, email_sent_to, error_msg, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id,
    twTimestamp(),
    runStatus,
    attemptNum,
    sessionId,
    responseText.slice(0, 500) || null,
    JSON.stringify(generatedFiles.map(f => ({ filename: f.filename, publicUrl: f.publicUrl }))),
    emailSentTo,
    runError,
    durationMs,
  );

  // ── Update task stats ───────────────────────────────────────────────────────
  const twNow_ = twTimestamp();
  await db.prepare(
    `UPDATE scheduled_tasks
     SET run_count=run_count+1, last_run_at=?, last_run_status=?, updated_at=?
     WHERE id=?`
  ).run(twNow_, runStatus, twNow_, task.id);

  console.log(`[Scheduled] Task ${task.id} "${task.name}" done — status=${runStatus} duration=${durationMs}ms`);
}

// ── Cron management ───────────────────────────────────────────────────────────
const _cronJobs = new Map(); // taskId → cron.ScheduledTask

function buildCronExpr(task) {
  const h = task.schedule_hour ?? 8;
  const m = task.schedule_minute ?? 0;
  switch (task.schedule_type) {
    case 'weekly':  return `${m} ${h} * * ${task.schedule_weekday ?? 1}`;
    case 'monthly': return `${m} ${h} ${task.schedule_monthday ?? 1} * *`;
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
  const job = cron.schedule(expr, () => {
    console.log(`[Scheduled] Triggering task ${task.id} "${task.name}"`);
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

module.exports = { initScheduler, scheduleTask, unscheduleTask, runTask, enqueue };
