// -*- coding: utf-8 -*-
/**
 * agentJobService.js — type='agent' skill 的背景執行。
 *
 * agent loop 是長任務(多輪 LLM + 渲染 + vision),不能塞同步 chat SSE。
 * 對齊既有背景 job(excelQueryJobService / research_jobs):
 *   createJob() → INSERT pending → atomic claim → setImmediate(runJob)
 *   runJob:取 lock_token + heartbeat(60s)+ semaphore → 跑 runSkillAgent → 落檔 + 鈴鐺
 *   recoverStaleJobs:cron 撿回 heartbeat 失蹤的 running(>=MAX_RECOVERY 標 failed)
 *   gracefullyPauseActiveJobs:SIGTERM 把本 pod 的 active job NULL lock_token(讓別 pod 撿)
 *
 * 隔離現況(Phase 0/1 中間態):runSkillAgent in-process 跑、內部 spawn python/soffice 子程序。
 * S5 會把它換成 forked child + oom_score_adj + egress 鎖 + non-root,才開放跑「不可信」skill。
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const packageStore = require('./skillAgent/packageStore');
const { runSkillAgent } = require('./skillAgent/poc');
const userNotificationService = require('./userNotificationService');

const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '../uploads');
const GENERATED_DIR = path.join(UPLOAD_DIR, 'generated');

const HEARTBEAT_INTERVAL_MS = 60_000;
const STALE_HEARTBEAT_MIN = 5;
const MAX_RECOVERY_COUNT = 2;            // agent job 重跑成本高,>=2 即放棄
const MAX_CONCURRENT = Number(process.env.AGENT_JOB_CONCURRENCY) || 1;

const ACTIVE_JOBS = new Set();

// ── semaphore(agent job 很吃資源:LLM + python + soffice;預設 1)──────────────
let _active = 0;
const _waiters = [];
function _acquireSlot() {
  if (_active < MAX_CONCURRENT) { _active++; return Promise.resolve(); }
  return new Promise((resolve) => _waiters.push(resolve));
}
function _releaseSlot() {
  const next = _waiters.shift();
  if (next) next(); else _active = Math.max(0, _active - 1);
}

// ── createJob ─────────────────────────────────────────────────────────────────
async function createJob(db, opts) {
  const jobId = crypto.randomUUID();
  const imagesJson = (opts.images && opts.images.length) ? JSON.stringify(opts.images) : null;
  await db.prepare(`
    INSERT INTO agent_jobs (id, user_id, session_id, skill_id, task, status, input_images_json)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(jobId, opts.userId, opts.sessionId || null, opts.skillId, opts.task || null, imagesJson);
  console.log(`[AgentJob] created ${jobId} user=${opts.userId} skill=${opts.skillId} images=${opts.images?.length || 0}`);

  // atomic claim → setImmediate(runJob)。claim 沒中(理論不會)就留 pending 交給 recovery/poller。
  let claimed = 0;
  try {
    const r = await db.prepare(
      `UPDATE agent_jobs SET status='running', heartbeat_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
       WHERE id=? AND status='pending'`
    ).run(jobId);
    claimed = r?.rowsAffected || r?.changes || 0;
  } catch (e) { console.warn(`[AgentJob] ${jobId} inline claim failed: ${e.message}`); }
  if (claimed > 0) {
    setImmediate(() => runJob(db, jobId).catch((e) => console.error(`[AgentJob] ${jobId} worker error:`, e.message)));
  }
  return jobId;
}

async function _updateProgress(db, jobId, label, lockToken) {
  try {
    await db.prepare(
      `UPDATE agent_jobs SET progress_label=?, updated_at=SYSTIMESTAMP WHERE id=? AND lock_token=?`
    ).run(String(label).slice(0, 500), jobId, lockToken);
  } catch (_) {}
}

// ── runJob ────────────────────────────────────────────────────────────────────
async function runJob(db, jobId) {
  let heartbeatTimer = null;
  let lockToken = null;
  let slotHeld = false;
  ACTIVE_JOBS.add(jobId);

  try {
    const job = await db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(jobId);
    if (!job) { ACTIVE_JOBS.delete(jobId); return; }

    // 1. 取 lock(authoritative,防跨 pod 雙跑)
    lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const lockRes = await db.prepare(`
      UPDATE agent_jobs SET lock_token=?, heartbeat_at=SYSTIMESTAMP,
        started_at=COALESCE(started_at, SYSTIMESTAMP), updated_at=SYSTIMESTAMP, status='running'
      WHERE id=? AND lock_token IS NULL AND status IN ('pending','running')
    `).run(lockToken, jobId);
    if ((lockRes?.rowsAffected || lockRes?.changes || 0) === 0) {
      console.warn(`[AgentJob] ${jobId} 取 lock 失敗(已被接走),放棄`);
      ACTIVE_JOBS.delete(jobId);
      return;
    }

    // 2. heartbeat
    heartbeatTimer = setInterval(async () => {
      try {
        await db.prepare(`UPDATE agent_jobs SET heartbeat_at=SYSTIMESTAMP WHERE id=? AND lock_token=?`).run(jobId, lockToken);
      } catch (_) {}
    }, HEARTBEAT_INTERVAL_MS);

    // 3. 解析 skill 包目錄
    const skill = await db.prepare('SELECT id, name, type, skill_package_path, brain_provider FROM skills WHERE id=?').get(job.skill_id);
    if (!skill || skill.type !== 'agent') throw new Error(`skill #${job.skill_id} 不是 agent 或不存在`);
    const packageDir = skill.skill_package_path && fs.existsSync(skill.skill_package_path)
      ? skill.skill_package_path
      : packageStore.getPackageDir(job.skill_id);
    if (!fs.existsSync(path.join(packageDir, 'SKILL.md'))) {
      throw new Error(`skill 包不存在或缺 SKILL.md:${packageDir}`);
    }

    // 4. semaphore + 跑 agent loop
    await _acquireSlot(); slotHeld = true;
    await _updateProgress(db, jobId, '啟動 Skill Agent…', lockToken);
    console.log(`[AgentJob] start ${jobId.slice(0, 8)} skill=${skill.name} pkg=${packageDir}`);

    let images = [];
    try { images = job.input_images_json ? JSON.parse(job.input_images_json) : []; } catch (_) {}
    const result = await runSkillAgent(job.task || '', {
      packageDir,
      images,
      keepWorkspace: false,
      onLog: (line) => {
        // 只在關鍵節點更新進度(省 DB),其餘留 stdout
        if (/──|👁|✅|⚠|🔧|📦/.test(line)) _updateProgress(db, jobId, line.replace(/\s+/g, ' ').trim().slice(0, 200), lockToken);
      },
    });

    // 5. 結果落檔(out.pptx → generated/agent_<jobId>.pptx)
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    const files = [];
    const srcPptx = result.runDir ? path.join(result.runDir, 'out.pptx') : (result.pptxPath || null);
    let resultFilePath = null;
    if (srcPptx && fs.existsSync(srcPptx)) {
      const fname = `agent_${jobId}.pptx`;
      const dst = path.join(GENERATED_DIR, fname);
      fs.copyFileSync(srcPptx, dst);
      resultFilePath = dst;
      // type/filename/publicUrl = 前端 generated_files 下載格式;/uploads 有靜態服務(server.js)
      files.push({ type: 'pptx', filename: fname, publicUrl: `/uploads/generated/${fname}`, path: dst });
    }

    // 6. 寫 done
    await db.prepare(`
      UPDATE agent_jobs SET status='done', progress_step=100,
        result_file_path=?, result_files_json=?, vision_score=?, tokens_json=?,
        updated_at=SYSTIMESTAMP, completed_at=SYSTIMESTAMP
      WHERE id=? AND lock_token=?
    `).run(resultFilePath, JSON.stringify(files), result.vision?.score ?? null,
      JSON.stringify(result.tokens || {}), jobId, lockToken);

    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    const fresh = await db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(jobId);
    await _finishNotify(db, fresh, 'done', { files, vision: result.vision });
    console.log(`[AgentJob] done ${jobId.slice(0, 8)} ok=${result.ok} vision=${result.vision?.score ?? '?'} tokens=${result.tokens?.total ?? '?'}`);
  } catch (e) {
    console.error(`[AgentJob] ${jobId} failed:`, e.message);
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    try {
      if (lockToken) {
        await db.prepare(`
          UPDATE agent_jobs SET status='failed', error_msg=?, updated_at=SYSTIMESTAMP, completed_at=SYSTIMESTAMP
          WHERE id=? AND lock_token=?
        `).run(String(e.message).slice(0, 2000), jobId, lockToken);
        const fresh = await db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(jobId);
        if (fresh) await _finishNotify(db, fresh, 'failed', { error: e.message });
      }
    } catch (_) {}
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (slotHeld) _releaseSlot();
    ACTIVE_JOBS.delete(jobId);
  }
}

// ── 完成通知:補 chat_message + 推鈴鐺(is_notified 去重)─────────────────────
async function _finishNotify(db, job, status, extra = {}) {
  try {
    if (Number(job.is_notified ?? job.IS_NOTIFIED ?? 0) === 1) return;
  } catch (_) {}
  const skillName = job.skill_name || 'Agent';

  if (job.session_id) {
    try {
      const fileName = extra.files?.[0]?.filename;
      const content = status === 'done'
        ? `🤖 Agent 技能完成(背景):已產出 ${fileName || '檔案'}${extra.vision?.score != null ? `(版面評分 ${extra.vision.score})` : ''}。`
        : `❌ Agent 技能失敗(背景):${extra.error || 'unknown error'}`;
      // done + 有檔 → 存 files_json.generated,前端會把檔案渲染成可點的下載連結(對齊內建 generate_xxx)
      let filesJson = null;
      if (status === 'done' && Array.isArray(extra.files) && extra.files.length) {
        filesJson = JSON.stringify({
          generated: extra.files.map(f => ({ type: f.type, filename: f.filename, publicUrl: f.publicUrl })),
        });
      }
      await db.prepare(`INSERT INTO chat_messages (session_id, role, content, files_json) VALUES (?, 'assistant', ?, ?)`)
        .run(job.session_id, content, filesJson);
    } catch (e) { console.warn(`[AgentJob] ${job.id} append chat_message failed: ${e.message}`); }
  }

  try {
    const linkUrl = job.session_id ? `/chat?session=${job.session_id}` : null;
    if (status === 'done') {
      await userNotificationService.create(db, {
        userId: job.user_id,
        type: userNotificationService.TYPE_AGENT_JOB_DONE,
        title: `Agent 技能完成`,
        message: `已產出 ${extra.files?.[0]?.name || '檔案'},點此查看`,
        linkUrl,
        payload: { jobId: job.id, sessionId: job.session_id, files: extra.files || [] },
      });
    } else {
      await userNotificationService.create(db, {
        userId: job.user_id,
        type: userNotificationService.TYPE_AGENT_JOB_FAILED,
        title: `Agent 技能失敗`,
        message: String(extra.error || 'unknown error').slice(0, 500),
        linkUrl,
        payload: { jobId: job.id, sessionId: job.session_id, error: extra.error },
      });
    }
    await db.prepare(`UPDATE agent_jobs SET is_notified=1 WHERE id=?`).run(job.id);
  } catch (e) { console.warn(`[AgentJob] ${job.id} push notification failed: ${e.message}`); }
}

// ── recovery:撿回 heartbeat 失蹤的 running ───────────────────────────────────
async function recoverStaleJobs(db) {
  try {
    // 超過重試上限 → 直接標 failed
    await db.prepare(`
      UPDATE agent_jobs SET status='failed', error_msg='recovery 超過上限', lock_token=NULL,
        updated_at=SYSTIMESTAMP, completed_at=SYSTIMESTAMP
      WHERE status='running' AND recovery_count >= ${MAX_RECOVERY_COUNT}
        AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
    `).run();

    const stale = await db.prepare(`
      SELECT id FROM agent_jobs
      WHERE status='running' AND recovery_count < ${MAX_RECOVERY_COUNT}
        AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
    `).all();
    for (const row of (stale || [])) {
      const id = row.id || row.ID;
      const r = await db.prepare(`
        UPDATE agent_jobs SET recovery_count=recovery_count+1, lock_token=NULL,
          heartbeat_at=SYSTIMESTAMP, status='running', updated_at=SYSTIMESTAMP
        WHERE id=? AND status='running'
          AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
      `).run(id);
      if ((r?.rowsAffected || r?.changes || 0) > 0) {
        console.log(`[AgentJob] recover ${String(id).slice(0, 8)} → re-run`);
        setImmediate(() => runJob(db, id).catch((e) => console.error(`[AgentJob] recover ${id} error:`, e.message)));
      }
    }
  } catch (e) { console.error('[AgentJob] recoverStaleJobs error:', e.message); }
}

// ── SIGTERM:把本 pod 的 active job NULL lock_token,讓別 pod 撿 ────────────────
async function gracefullyPauseActiveJobs(db) {
  for (const jobId of ACTIVE_JOBS) {
    try {
      await db.prepare(`
        UPDATE agent_jobs SET lock_token=NULL, heartbeat_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
        WHERE id=? AND status='running'
      `).run(jobId);
    } catch (_) {}
  }
}

async function getJob(db, jobId) {
  return db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(jobId);
}

module.exports = {
  createJob,
  runJob,
  recoverStaleJobs,
  gracefullyPauseActiveJobs,
  getJob,
};
