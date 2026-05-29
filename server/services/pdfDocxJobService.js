'use strict';
/**
 * pdfDocxJobService.js — PDF → DOCX 背景轉檔 Job(Phase 1d + 1c 共用基礎)
 *
 * 用途:
 *   - 大檔(editable > 50 頁 / vision flash > 12 頁 / vision pro > 6 頁)
 *     同步會超 chat.js 120s tool dispatch timeout → 走背景
 *   - 加密 PDF 走 modal 旁路後也用 job 跑(避免密碼進 chat history)
 *
 * 流程:
 *   1. submitJob(opts) → INSERT row (status='queued', password 用 AES 加密)
 *   2. 同 pod worker loop 每 5s claimQueuedJob (atomic UPDATE WHERE status='queued')
 *   3. runJob → 依 format 跑 editable / vision
 *   4. markDone / markFailed → 清 password_encrypted、push user_notifications
 *
 * 密碼處理(高敏感):
 *   - INSERT 時 AES-256-CBC 加密(key 從 INTERNAL_API_SECRET PBKDF2 衍生)
 *   - run 時 decrypt → 餵 worker → run 完 UPDATE password_encrypted=NULL
 *   - DB dump 仍只看到 encrypted blob;job done 後幾秒內就清掉
 *
 * 不做 heartbeat / recovery(MVP):deploy 中斷的 in-flight job 標 failed,
 * 推 user 重新提交。PDF 重跑成本 < 5 min(vision flash 100 頁),可接受。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const userNotif = require('./userNotificationService');

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');
const GENERATED_DIR = path.join(UPLOAD_ROOT, 'generated');

// ── Password AES helpers ─────────────────────────────────────────────────────
// key 從 INTERNAL_API_SECRET PBKDF2 衍生;若 secret 變(server 重啟未 persist)
// 則舊 job 的 encrypted password 無法解 → markFailed 'PASSWORD_DECRYPT_FAILED'
function _deriveKey() {
  const secret = process.env.INTERNAL_API_SECRET || 'fallback-key-NOT-secure-for-prod';
  return crypto.pbkdf2Sync(secret, 'pdf-docx-jobs-v1', 100_000, 32, 'sha256');
}

function encryptPassword(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', _deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return iv.toString('base64') + ':' + enc.toString('base64');
}

function decryptPassword(stored) {
  if (!stored) return null;
  const parts = String(stored).split(':');
  if (parts.length !== 2) throw new Error('encrypted password bad format');
  const iv = Buffer.from(parts[0], 'base64');
  const enc = Buffer.from(parts[1], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', _deriveKey(), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ── 估時 / 決定要不要走背景 ──────────────────────────────────────────────────
function shouldUseBackground({ format, vision_model, pages }) {
  if (format === 'vision') {
    if ((vision_model || 'flash') === 'pro') return pages > 6;
    return pages > 12;
  }
  // editable
  return pages > 50;
}

// ── JOB lifecycle ────────────────────────────────────────────────────────────
function _uuid() { return crypto.randomUUID(); }

/**
 * 提交一個新 job。
 * @returns {Promise<string>} jobId
 */
async function submitJob(db, opts) {
  const {
    userId, sessionId, pdfPath, pdfName, password,
    format = 'auto', vision_model = 'flash', pages = null,
  } = opts || {};
  if (!userId || !pdfPath) throw new Error('submitJob: userId / pdfPath required');

  const jobId = _uuid();
  const passwordEnc = password ? encryptPassword(password) : null;
  await db.prepare(`
    INSERT INTO pdf_docx_jobs
      (id, user_id, session_id, source_pdf_path, source_pdf_name, password_encrypted,
       format, vision_model, pages, status, progress_pct, progress_msg)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 'Queued — waiting for worker')
  `).run(
    jobId, userId, sessionId || null, pdfPath, pdfName || path.basename(pdfPath),
    passwordEnc, format, vision_model, pages
  );
  console.log(`[pdfDocxJob] submitted job=${jobId} user=${userId} pages=${pages} format=${format} model=${vision_model}`);
  return jobId;
}

async function getJob(db, jobId) {
  const row = await db.prepare(`SELECT * FROM pdf_docx_jobs WHERE id = ?`).get(jobId);
  return row ? _format(row) : null;
}

async function listJobsForUser(db, userId, { limit = 50, status = null } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  let sql = `SELECT id, source_pdf_name, format, vision_model, pages, status, progress_pct,
                    progress_msg, out_filename, out_public_url, in_tokens, out_tokens,
                    error_msg, created_at, started_at, completed_at
             FROM pdf_docx_jobs WHERE user_id = ?`;
  const params = [userId];
  if (status) { sql += ` AND status = ?`; params.push(status); }
  sql += ` ORDER BY created_at DESC FETCH FIRST ${cap} ROWS ONLY`;
  const rows = await db.prepare(sql).all(...params);
  return rows.map(_format);
}

/**
 * Atomic claim 一個 queued job → 變 running、寫 lock_token。
 * 防多 worker 搶同 job。
 */
async function claimQueuedJob(db, lockToken) {
  // Step 1: 找最早的 queued job id
  const candidate = await db.prepare(`
    SELECT id FROM pdf_docx_jobs WHERE status = 'queued'
    ORDER BY created_at FETCH FIRST 1 ROW ONLY
  `).get();
  if (!candidate) return null;
  const jobId = candidate.id || candidate.ID;

  // Step 2: 加 WHERE status='queued' 條件做 atomic UPDATE;搶到 = 影響 1 row
  const res = await db.prepare(`
    UPDATE pdf_docx_jobs
    SET status='running', lock_token=?, started_at=SYSTIMESTAMP,
        progress_msg='Worker picked up'
    WHERE id=? AND status='queued'
  `).run(lockToken, jobId);
  // sql.js / Oracle 不同 driver,changes() 介面:row.changes 或 res.changes
  const changes = (res && (res.changes ?? res.rowsAffected ?? res.affectedRows)) || 0;
  if (changes < 1) {
    // 被別 worker 搶了
    return null;
  }
  return await getJob(db, jobId);
}

async function _updateProgress(db, jobId, pct, msg) {
  try {
    await db.prepare(`
      UPDATE pdf_docx_jobs SET progress_pct=?, progress_msg=? WHERE id=?
    `).run(Math.max(0, Math.min(100, Math.round(pct))), String(msg || '').slice(0, 500), jobId);
  } catch (e) {
    console.warn(`[pdfDocxJob] update progress failed for ${jobId}: ${e.message}`);
  }
}

async function markDone(db, job, result) {
  try {
    await db.prepare(`
      UPDATE pdf_docx_jobs
      SET status='done', progress_pct=100, progress_msg='Done',
          out_docx_path=?, out_public_url=?, out_filename=?,
          in_tokens=?, out_tokens=?,
          password_encrypted=NULL, completed_at=SYSTIMESTAMP
      WHERE id=?
    `).run(
      result.outDocxPath,
      result.outPublicUrl,
      result.outFilename,
      result.inTokens || 0,
      result.outTokens || 0,
      job.id
    );
  } catch (e) {
    console.error(`[pdfDocxJob] markDone DB failed for ${job.id}: ${e.message}`);
    return;
  }
  // 推鈴鐺
  try {
    await userNotif.create(db, {
      userId: job.user_id,
      type: userNotif.TYPE_PDF_DOCX_JOB_DONE,
      title: `PDF 轉 Word 完成:${job.source_pdf_name || job.id.slice(0, 8)}`,
      message: `已轉換 ${result.pages || job.pages || '?'} 頁(${job.format} mode${job.format === 'vision' ? ` / ${job.vision_model}` : ''})。[下載](${result.outPublicUrl})`,
      linkUrl: result.outPublicUrl,
      payload: {
        jobId: job.id,
        sessionId: job.session_id,
        outFilename: result.outFilename,
        format: job.format,
        visionModel: job.vision_model,
      },
    });
  } catch (e) {
    console.warn(`[pdfDocxJob] notification failed for ${job.id}: ${e.message}`);
  }
  try {
    await db.prepare(`UPDATE pdf_docx_jobs SET is_notified=1 WHERE id=?`).run(job.id);
  } catch (_) {}
  console.log(`[pdfDocxJob] DONE job=${job.id} → ${result.outFilename}`);
}

async function markFailed(db, job, errMsg) {
  const msg = String(errMsg || 'unknown').slice(0, 1000);
  try {
    await db.prepare(`
      UPDATE pdf_docx_jobs
      SET status='failed', progress_msg='Failed', error_msg=?,
          password_encrypted=NULL, completed_at=SYSTIMESTAMP
      WHERE id=?
    `).run(msg, job.id);
  } catch (e) {
    console.error(`[pdfDocxJob] markFailed DB failed for ${job.id}: ${e.message}`);
  }
  try {
    await userNotif.create(db, {
      userId: job.user_id,
      type: userNotif.TYPE_PDF_DOCX_JOB_FAILED,
      title: `PDF 轉 Word 失敗:${job.source_pdf_name || job.id.slice(0, 8)}`,
      message: `失敗原因:${msg}\n\n可重新對話請我用其他模式(editable / vision pro)重試。`,
      payload: { jobId: job.id, sessionId: job.session_id, error: msg },
    });
  } catch (e) {
    console.warn(`[pdfDocxJob] failure notification failed for ${job.id}: ${e.message}`);
  }
  try {
    await db.prepare(`UPDATE pdf_docx_jobs SET is_notified=1 WHERE id=?`).run(job.id);
  } catch (_) {}
  console.warn(`[pdfDocxJob] FAILED job=${job.id} reason=${msg}`);
}

// ── Run job(實際做事)─────────────────────────────────────────────────────
function _safeOutputPath(sourceName) {
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const base = path.basename(sourceName || 'output', path.extname(sourceName || ''))
    .replace(/[^a-zA-Z0-9._\-一-鿿]/g, '_').slice(0, 80) || 'output';
  const rand = crypto.randomBytes(3).toString('hex');
  return path.join(GENERATED_DIR, `${Date.now()}_${rand}_${base}.docx`);
}

async function runJob(db, job) {
  const { runWorker } = require('../python_workers/pdfWorker');
  const { rebuildPdfWithVision } = require('./pdfVisionRebuild');

  // 解密密碼(若有)
  let password = null;
  try {
    password = job.password_encrypted ? decryptPassword(job.password_encrypted) : null;
  } catch (e) {
    return markFailed(db, job, `PASSWORD_DECRYPT_FAILED: ${e.message}(server 可能重啟過 INTERNAL_API_SECRET 變了,請重新提交 job 並重輸密碼)`);
  }

  // 路徑安全
  let realPath;
  try {
    realPath = fs.realpathSync(job.source_pdf_path);
  } catch (e) {
    return markFailed(db, job, `來源 PDF 已被清除:${job.source_pdf_path}`);
  }
  if (!realPath.startsWith(UPLOAD_ROOT)) {
    return markFailed(db, job, `拒絕讀取此路徑(超出允許範圍)`);
  }

  // Resolve 真正要跑的 mode(format='auto' 就 inspect 拿 recommended_mode)
  let effectiveFormat = job.format;
  if (effectiveFormat === 'auto') {
    try {
      await _updateProgress(db, job.id, 5, 'Inspecting PDF...');
      const args = ['inspect', '--in', realPath];
      if (password) args.push('--password', password);
      const ins = await runWorker(args, { timeoutMs: 60_000 });
      if (!ins.ok) {
        return markFailed(db, job, `Inspect 失敗:${ins.error_code} ${ins.error || ''}`);
      }
      effectiveFormat = ins.recommended_mode === 'vision' ? 'vision' : 'editable';
      console.log(`[pdfDocxJob] job=${job.id} auto → ${effectiveFormat} (complexity=${ins.complexity_score})`);
    } catch (e) {
      return markFailed(db, job, `Inspect 例外:${e.message}`);
    }
  }

  const outPath = _safeOutputPath(job.source_pdf_name || 'output.pdf');
  const outFilename = path.basename(outPath);
  const outPublicUrl = `/uploads/generated/${outFilename}`;

  try {
    if (effectiveFormat === 'vision') {
      await _updateProgress(db, job.id, 10, `Vision rebuild (${job.vision_model})...`);
      const result = await rebuildPdfWithVision({
        pdfPath: realPath,
        outDocxPath: outPath,
        password,
        model: job.vision_model === 'pro' ? 'pro' : 'flash',
        concurrency: 3,
        dpi: 300,
        onProgress: (p) => {
          let pct = 10;
          if (p.stage === 'render') pct = 15;
          else if (p.stage === 'vision_start') pct = 20;
          else if (p.stage === 'vision_page_done') {
            pct = 20 + Math.round(70 * (p.pageNo / p.totalPages));
          }
          else if (p.stage === 'build') pct = 92;
          else if (p.stage === 'done') pct = 98;
          _updateProgress(db, job.id, pct, `${p.stage}${p.pageNo ? ` ${p.pageNo}/${p.totalPages}` : ''}`).catch(() => {});
        },
      });
      await markDone(db, job, {
        outDocxPath: outPath,
        outPublicUrl,
        outFilename,
        pages: result.totalPages,
        inTokens: result.totalTokens?.input || 0,
        outTokens: result.totalTokens?.output || 0,
      });
    } else {
      // editable
      await _updateProgress(db, job.id, 10, 'pdf2docx convert...');
      const args = ['convert', '--in', realPath, '--out', outPath];
      if (password) args.push('--password', password);
      const cv = await runWorker(args, { timeoutMs: 30 * 60_000 }); // 背景 30min 上限
      if (!cv.ok) {
        return markFailed(db, job, `pdf2docx convert 失敗:${cv.error_code} ${cv.error || ''}`);
      }
      await markDone(db, job, {
        outDocxPath: outPath,
        outPublicUrl,
        outFilename,
        pages: cv.pages_converted,
      });
    }
  } catch (e) {
    console.error(`[pdfDocxJob] runJob ${job.id} threw:`, e);
    return markFailed(db, job, `Job 執行例外:${e.message}`);
  }
}

// ── Worker poll loop(server.js 啟動時 call startWorker)─────────────────────
let _workerRunning = false;
const POLL_INTERVAL_MS = 5_000;
const LOCK_TOKEN = `${require('os').hostname()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

function startWorker(db) {
  if (_workerRunning) {
    console.warn('[pdfDocxJob] worker already running, skip');
    return;
  }
  _workerRunning = true;
  console.log(`[pdfDocxJob] worker loop started (token=${LOCK_TOKEN}, interval=${POLL_INTERVAL_MS}ms)`);

  const loop = async () => {
    if (!_workerRunning) return;
    try {
      const job = await claimQueuedJob(db, LOCK_TOKEN);
      if (job) {
        console.log(`[pdfDocxJob] picked up job=${job.id} pages=${job.pages} format=${job.format}`);
        await runJob(db, job).catch(e => console.error(`[pdfDocxJob] runJob unexpected: ${e.message}`));
        setImmediate(loop); // 立刻看下一個
        return;
      }
    } catch (e) {
      console.error(`[pdfDocxJob] worker loop error: ${e.message}`);
    }
    setTimeout(loop, POLL_INTERVAL_MS);
  };
  setTimeout(loop, 2_000); // 啟動延遲 2s 等 DB ready
}

function stopWorker() { _workerRunning = false; }

// ── format helper(統一大小寫 col 命名)──────────────────────────────────────
function _format(row) {
  if (!row) return null;
  const out = {};
  for (const k of Object.keys(row)) {
    out[k.toLowerCase()] = row[k];
  }
  return out;
}

module.exports = {
  submitJob, getJob, listJobsForUser,
  markDone, markFailed, runJob,
  shouldUseBackground,
  encryptPassword, decryptPassword,
  startWorker, stopWorker,
};
