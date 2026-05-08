'use strict';
/**
 * 長音訊背景轉錄 Job 服務
 *
 * 設計文件:docs/long-audio-background-job-plan.md
 * Pattern 來源:server/services/researchService.js(完全沿用 lock + heartbeat + recovery + sigterm)
 *
 * 流程:
 *   POST → createJob() → INSERT job + 立刻 setImmediate(runTranscribeJob)
 *                      ↓
 *   worker 取 lock + 啟動 heartbeat(60s)
 *                      ↓
 *   首次跑:ffprobe + ffmpeg 切片 → segments[]
 *   recovery:讀 segments_json,跳過已完成段
 *                      ↓
 *   平行 transcribe(concurrency=2)+ retry-with-backoff + Pro→Flash fallback
 *   每段完成 → UPDATE segments_json + segment_done(前端 polling 看得到進度)
 *                      ↓
 *   全完成 → 寫 transcript_<safe>_<ts>.txt 到 uploads/generated
 *         → UPDATE status='done', completed_at
 *         → UPDATE placeholder chat_message 改成完成訊息 + 附件
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  _probeAudioDuration,
  _splitAudio,
  _fmtTime,
  _transcribeWithRetry,
  LONG_AUDIO_SEGMENT_SEC,
  LONG_AUDIO_CONCURRENCY,
} = require('./gemini');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

// ─── Active Jobs Tracker (for graceful SIGTERM) ──────────────────────────────
const ACTIVE_JOBS = new Set();
const HEARTBEAT_INTERVAL_MS = 60_000;
const STALE_HEARTBEAT_MIN   = 5;
const MAX_RECOVERY_COUNT    = 3;

// ─── createJob ────────────────────────────────────────────────────────────────

/**
 * 創長音訊轉錄 job(從 chat.js audio branch 呼叫)
 * @param {object} db
 * @param {object} opts - { userId, sessionId, audioPath, audioFilename, audioSizeMb, audioMimeType }
 * @returns {Promise<string>} jobId
 */
async function createJob(db, opts) {
  const jobId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO transcribe_jobs (
      id, user_id, session_id, audio_filename, audio_path,
      audio_size_mb, audio_mime_type, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    jobId,
    opts.userId,
    opts.sessionId || null,
    opts.audioFilename,
    opts.audioPath,
    opts.audioSizeMb || null,
    opts.audioMimeType || null,
  );
  console.log(`[TranscribeJob] created ${jobId} user=${opts.userId} file=${opts.audioFilename} ${opts.audioSizeMb}MB`);
  return jobId;
}

/**
 * 把 job 跟 placeholder chat_message 綁定(chat.js INSERT message 後呼叫)
 */
async function attachMessageId(db, jobId, messageId) {
  await db.prepare(
    `UPDATE transcribe_jobs SET message_id=?, updated_at=SYSTIMESTAMP WHERE id=?`
  ).run(messageId, jobId);
}

// ─── SIGTERM handlers (沿用 research pattern) ────────────────────────────────

async function _markJobForRecovery(db, jobId) {
  try {
    await db.prepare(`
      UPDATE transcribe_jobs SET
        lock_token = NULL,
        heartbeat_at = SYSTIMESTAMP - INTERVAL '10' MINUTE,
        updated_at = SYSTIMESTAMP
      WHERE id = ? AND status = 'running'
    `).run(jobId);
  } catch (e) {
    console.warn(`[TranscribeJob] _markJobForRecovery ${jobId} error:`, e.message);
  }
}

async function gracefullyPauseActiveJobs(db) {
  const ids = Array.from(ACTIVE_JOBS);
  if (!ids.length) return;
  console.log(`[TranscribeJob] SIGTERM: marking ${ids.length} active jobs for recovery`);
  for (const id of ids) {
    await _markJobForRecovery(db, id);
  }
}

// ─── Recovery scheduler(每 5 分鐘 cron 呼叫,server.js 啟動時也跑一次)──────

async function recoverStaleJobs(db) {
  try {
    // 1) recovery_count >= 3 → 直接 failed
    await db.prepare(`
      UPDATE transcribe_jobs SET
        status='failed',
        error_msg='已嘗試 ${MAX_RECOVERY_COUNT} 次恢復仍失敗',
        updated_at=SYSTIMESTAMP
      WHERE status='running'
        AND COALESCE(recovery_count, 0) >= ${MAX_RECOVERY_COUNT}
        AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
    `).run();

    // 2) 找 stale jobs
    const stale = await db.prepare(`
      SELECT id, COALESCE(recovery_count, 0) AS recovery_count
      FROM transcribe_jobs
      WHERE status='running'
        AND COALESCE(recovery_count, 0) < ${MAX_RECOVERY_COUNT}
        AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
    `).all();

    for (const row of stale) {
      try {
        const res = await db.prepare(`
          UPDATE transcribe_jobs SET
            recovery_count = COALESCE(recovery_count,0) + 1,
            lock_token = NULL,
            heartbeat_at = SYSTIMESTAMP,
            updated_at = SYSTIMESTAMP
          WHERE id = ? AND status = 'running'
            AND COALESCE(recovery_count, 0) = ?
            AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
        `).run(row.id, row.recovery_count);

        const affected = res?.rowsAffected || res?.changes || 0;
        if (affected > 0) {
          console.log(`[TranscribeJob] Recovering job ${row.id} (attempt ${row.recovery_count + 1}/${MAX_RECOVERY_COUNT})`);
          setImmediate(() => runTranscribeJob(db, row.id).catch((e) =>
            console.error(`[TranscribeJob] Recovery ${row.id} failed:`, e.message)
          ));
        }
      } catch (e) {
        console.warn(`[TranscribeJob] Recovery ${row.id} update error:`, e.message);
      }
    }
  } catch (e) {
    console.error('[TranscribeJob] recoverStaleJobs error:', e.message);
  }
}

// ─── Main worker ─────────────────────────────────────────────────────────────

async function runTranscribeJob(db, jobId) {
  let job;
  let heartbeatTimer = null;
  let lockToken = null;
  let tmpRoot = null;
  ACTIVE_JOBS.add(jobId);

  try {
    job = await db.prepare('SELECT * FROM transcribe_jobs WHERE id=?').get(jobId);
    if (!job) {
      ACTIVE_JOBS.delete(jobId);
      return;
    }

    // 1. 取 lock
    lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    await db.prepare(`
      UPDATE transcribe_jobs SET lock_token=?, heartbeat_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP, status='running'
      WHERE id=? AND (lock_token IS NULL OR lock_token=?)
    `).run(lockToken, jobId, lockToken);

    // 2. 啟動 heartbeat
    heartbeatTimer = setInterval(async () => {
      try {
        await db.prepare(
          `UPDATE transcribe_jobs SET heartbeat_at=SYSTIMESTAMP WHERE id=? AND lock_token=?`
        ).run(jobId, lockToken);
      } catch (_) {}
    }, HEARTBEAT_INTERVAL_MS);

    const tagId = `${jobId.slice(0,8)}|${path.basename(job.audio_path)}|${job.audio_size_mb}MB`;
    console.log(`[TranscribeJob] start ${tagId} status=${job.status} recovery_count=${job.recovery_count || 0}`);

    // 3. 確認音檔還在(NFS 應該還在;recovery 時要重新檢查)
    if (!fs.existsSync(job.audio_path)) {
      throw new Error(`Audio file not found at ${job.audio_path} (可能已被清理)`);
    }

    // 4. 切片 / 從 segments_json resume
    let segments = [];
    let totalDuration = job.duration_sec || 0;
    if (job.segments_json) {
      try {
        segments = JSON.parse(job.segments_json);
      } catch (e) {
        console.warn(`[TranscribeJob] ${tagId} segments_json parse failed, re-split: ${e.message}`);
        segments = [];
      }
    }

    if (segments.length === 0) {
      // 首次跑:ffprobe + ffmpeg
      tmpRoot = path.join(os.tmpdir(), `transcribe_job_${jobId.slice(0,8)}`);
      fs.mkdirSync(tmpRoot, { recursive: true });

      totalDuration = await _probeAudioDuration(job.audio_path);
      console.log(`[TranscribeJob] ${tagId} duration=${_fmtTime(totalDuration)} (${totalDuration.toFixed(0)}s)`);

      const tSplit = Date.now();
      const parts = await _splitAudio(job.audio_path, LONG_AUDIO_SEGMENT_SEC, tmpRoot);
      console.log(`[TranscribeJob] ${tagId} split into ${parts.length} parts in ${Date.now() - tSplit}ms`);
      if (parts.length === 0) throw new Error('ffmpeg produced no segments');

      segments = parts.map((partPath, i) => {
        const startSec = i * LONG_AUDIO_SEGMENT_SEC;
        const endSec = totalDuration > 0
          ? Math.min((i + 1) * LONG_AUDIO_SEGMENT_SEC, totalDuration)
          : (i + 1) * LONG_AUDIO_SEGMENT_SEC;
        return {
          idx: i,
          ok: false,
          partPath,
          marker: `${_fmtTime(startSec)}–${_fmtTime(endSec)}`,
          text: '',
          inputTokens: 0,
          outputTokens: 0,
          attempts: 0,
        };
      });

      await db.prepare(`
        UPDATE transcribe_jobs SET
          duration_sec=?,
          segment_total=?,
          segment_done=0,
          segments_json=?,
          updated_at=SYSTIMESTAMP
        WHERE id=?
      `).run(totalDuration, segments.length, JSON.stringify(segments), jobId);
    } else {
      // recovery:tmp 目錄可能不在了(pod 換了),重建並重切
      console.log(`[TranscribeJob] ${tagId} resume: ${segments.filter(s => s.ok).length}/${segments.length} done`);
      const partsExist = segments.every(s => s.ok || (s.partPath && fs.existsSync(s.partPath)));
      if (!partsExist) {
        tmpRoot = path.join(os.tmpdir(), `transcribe_job_${jobId.slice(0,8)}_r${job.recovery_count || 0}`);
        fs.mkdirSync(tmpRoot, { recursive: true });
        console.log(`[TranscribeJob] ${tagId} parts missing, re-split to ${tmpRoot}`);
        const newParts = await _splitAudio(job.audio_path, LONG_AUDIO_SEGMENT_SEC, tmpRoot);
        // 重新指派 partPath(順序對齊 idx)
        segments.forEach((s, i) => {
          if (!s.ok && newParts[i]) s.partPath = newParts[i];
        });
      } else if (segments.some(s => s.partPath)) {
        // 沿用既有 partPath 的 tmpRoot,從中推回(只為了 finally cleanup)
        const sample = segments.find(s => s.partPath)?.partPath;
        if (sample) tmpRoot = path.dirname(sample);
      }
    }

    // 5. 平行轉錄,sequential batch(concurrency=2)
    const lang = 'zh-TW'; // TODO: 之後可以從 session 拉
    for (let i = 0; i < segments.length; i += LONG_AUDIO_CONCURRENCY) {
      const batch = segments.slice(i, i + LONG_AUDIO_CONCURRENCY).filter(s => !s.ok);
      if (batch.length === 0) continue;

      await Promise.all(batch.map(async (seg) => {
        const tPart = Date.now();
        const r = await _transcribeWithRetry(seg.partPath, job.audio_mime_type, lang, seg.idx + 1, segments.length, tagId);
        seg.ok = r.ok;
        seg.text = r.text;
        seg.inputTokens = r.inputTokens || 0;
        seg.outputTokens = r.outputTokens || 0;
        seg.attempts = r.attempts || 1;
        if (!r.ok) seg.error = r.error;
        if (r.ok) {
          console.log(`[TranscribeJob] ${tagId} part ${seg.idx + 1}/${segments.length} ok in ${Date.now() - tPart}ms text=${r.text.length}chars attempts=${r.attempts}`);
        } else {
          console.error(`[TranscribeJob] ${tagId} part ${seg.idx + 1}/${segments.length} FAILED after ${Date.now() - tPart}ms attempts=${r.attempts}: ${r.error}`);
        }
      }));

      // 每 batch 完更新 DB(前端 polling 才看得到 N/M 進度)
      const done = segments.filter(s => s.ok).length;
      const totalIn = segments.reduce((sum, s) => sum + (s.inputTokens || 0), 0);
      const totalOut = segments.reduce((sum, s) => sum + (s.outputTokens || 0), 0);
      const totalChars = segments.filter(s => s.ok).reduce((sum, s) => sum + (s.text?.length || 0), 0);
      await db.prepare(`
        UPDATE transcribe_jobs SET
          segments_json=?,
          segment_done=?,
          in_tokens_total=?,
          out_tokens_total=?,
          transcript_chars=?,
          updated_at=SYSTIMESTAMP
        WHERE id=?
      `).run(JSON.stringify(segments), done, totalIn, totalOut, totalChars, jobId);
    }

    // 6. Concat → 寫 .txt
    const merged = segments.map(s => `[${s.marker}]\n${s.text}`).join('\n\n');
    const generatedDir = path.join(UPLOAD_DIR, 'generated');
    if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });
    const safeBase = job.audio_filename.replace(/\.[^.]+$/, '').replace(/[^\w一-龥\-]/g, '_').slice(0, 50);
    const txtFname = `transcript_${safeBase}_${Date.now()}.txt`;
    const txtPath = path.join(generatedDir, txtFname);
    const header = `音訊逐字稿\n檔案: ${job.audio_filename}\n時間: ${new Date().toISOString()}\n字數: ${merged.length}\n段數: ${segments.length}\n${'='.repeat(60)}\n\n`;
    fs.writeFileSync(txtPath, header + merged, 'utf-8');

    const allFailed = segments.every(s => !s.ok);
    const finalStatus = allFailed ? 'failed' : 'done';
    const finalError = allFailed ? '所有段都轉錄失敗' : null;

    await db.prepare(`
      UPDATE transcribe_jobs SET
        status=?,
        transcript_file=?,
        transcript_chars=?,
        error_msg=?,
        completed_at=SYSTIMESTAMP,
        updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(finalStatus, txtFname, merged.length, finalError, jobId);

    console.log(`[TranscribeJob] ${tagId} ALL done status=${finalStatus} chars=${merged.length} segs=${segments.length} ok=${segments.filter(s => s.ok).length}`);

    // 7. 更新 placeholder chat_message
    if (job.message_id) {
      try {
        const okCount = segments.filter(s => s.ok).length;
        const summary = finalStatus === 'done'
          ? `✅ 音訊轉錄完成:${job.audio_filename}\n📄 共 ${merged.length.toLocaleString()} 字 / ${segments.length} 段\n⬇ 點選附件下載完整逐字稿`
          : `❌ 音訊轉錄失敗:${job.audio_filename}\n${finalError}`;
        await db.prepare(
          `UPDATE chat_messages SET content=?, files_json=? WHERE id=?`
        ).run(
          summary,
          JSON.stringify([{ type: 'text', filename: txtFname, publicUrl: `/uploads/generated/${txtFname}` }]),
          job.message_id,
        );
      } catch (e) {
        console.warn(`[TranscribeJob] ${tagId} update chat_message ${job.message_id} failed: ${e.message}`);
      }
    }

  } catch (e) {
    console.error(`[TranscribeJob] ${jobId} FATAL: ${e.message}`, e.stack?.split('\n').slice(0, 5).join('\n'));
    try {
      await db.prepare(`
        UPDATE transcribe_jobs SET
          status='failed',
          error_msg=?,
          completed_at=SYSTIMESTAMP,
          updated_at=SYSTIMESTAMP
        WHERE id=?
      `).run(e.message?.slice(0, 1000) || 'unknown error', jobId);
    } catch (_) {}
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    ACTIVE_JOBS.delete(jobId);
    if (tmpRoot) {
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
      catch (e) { console.warn(`[TranscribeJob] tmp cleanup failed (${tmpRoot}): ${e.message}`); }
    }
  }
}

module.exports = {
  createJob,
  attachMessageId,
  runTranscribeJob,
  recoverStaleJobs,
  gracefullyPauseActiveJobs,
};
