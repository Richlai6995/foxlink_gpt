/**
 * ⭐ #21 Status SUMMARY — 跨 channel + form + task 自動摘要
 *
 * Sprint D 範圍(MOCK):
 *   - 從 project + stages + tasks + 最近訊息 算 mock 三段摘要(進度 / 風險 / 待辦)
 *   - 不呼叫 LLM,Sprint F 才換成真實 Gemini Flash
 *
 * 對齊 PPT slide 14 + Demo 手冊 §8.4
 *
 * 三段式結構:
 *   進度:當前 stage / 完成度 / 哪幾個 task 在跑
 *   風險:Blocker / SLA 接近 / 客戶卡 Q&A
 *   待辦(24h):接下來要做什麼 / 等誰確認
 *
 * 三處顯示:
 *   - #announcement Pin(每天 09:00 自動 + Stage 切換時 + @bot summary 手動)
 *   - 專案列表行下(灰字摘要,cache 30 min)
 *   - 主管 Watchlist hover(完整摘要)
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('ai/statusSummary');

const SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min(對齊 spec)
const _cache = new Map(); // project_id → { generated_at, summary }

/** Sprint F:設 PROJECTS_PLATFORM_USE_LLM=true 啟用真 LLM;預設 false 走 mock 保守省 token */
const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true';
const LLM_MODEL = process.env.PROJECTS_PLATFORM_SUMMARY_MODEL || process.env.GEMINI_MODEL_FLASH || 'gemini-flash';

// Lazy import(只有 USE_LLM=true 才碰 geminiClient)
let _geminiClient = null;
let _llmQueue = null;
function _llm() {
  if (!_geminiClient) _geminiClient = require('../../services/geminiClient');
  return _geminiClient;
}
function _queue() {
  if (!_llmQueue) _llmQueue = require('../services/llmQueue');
  return _llmQueue;
}

/**
 * Generate(or get cached)summary
 *
 * @param {object} db
 * @param {number} projectId
 * @param {object} [opts]
 * @param {boolean} [opts.force]  忽略 cache 重產
 * @returns {Promise<{progress, risk, todo, oneLiner, generated_at}>}
 */
async function getSummary(db, projectId, { force = false } = {}) {
  if (!force) {
    const cached = _cache.get(projectId);
    if (cached && Date.now() - new Date(cached.generated_at).getTime() < SUMMARY_CACHE_TTL_MS) {
      return cached;
    }
  }

  const project = await db.prepare(
    `SELECT id, project_code, data_payload, lifecycle_status, priority_score,
            sla_due_at, current_stage_id, importance
       FROM projects WHERE id = ?`,
  ).get(projectId);

  if (!project) return null;

  // Stage 進度 — 當前 stage / done 比例
  const stages = await db.prepare(
    `SELECT stage_code, status, stage_order, sla_due_at
       FROM project_stages WHERE project_id = ? ORDER BY stage_order`,
  ).all(projectId);

  const activeStage = stages.find((s) => s.status === 'ACTIVE');
  const doneCount = stages.filter((s) => s.status === 'DONE').length;
  const totalStages = stages.length;
  const stageProgress = totalStages > 0 ? Math.round((doneCount / totalStages) * 100) : 0;

  // Task 統計
  const tasks = await db.prepare(
    `SELECT status, blocker_reason, computed_due_at FROM project_tasks WHERE project_id = ?`,
  ).all(projectId);

  const blocked = tasks.filter((t) => t.status === 'BLOCKED');
  const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS');
  const ready = tasks.filter((t) => t.status === 'READY_FOR_REVIEW');
  const overdue = tasks.filter((t) => {
    if (!t.computed_due_at || t.status === 'DONE') return false;
    return new Date(t.computed_due_at) < new Date();
  });

  // 風險判定
  const risks = [];
  if (blocked.length > 0) {
    risks.push(`${blocked.length} 個 task BLOCKED${blocked[0].blocker_reason ? `:${String(blocked[0].blocker_reason).slice(0, 60)}` : ''}`);
  }
  if (overdue.length > 0) risks.push(`${overdue.length} 個 task 已逾期`);
  if (project.sla_due_at && new Date(project.sla_due_at) < new Date()) {
    risks.push('Project SLA 超期');
  } else if (project.sla_due_at) {
    const hoursLeft = (new Date(project.sla_due_at).getTime() - Date.now()) / 3600000;
    if (hoursLeft < 24) risks.push(`SLA 接近(剩 ${Math.max(0, Math.round(hoursLeft))}h)`);
  }

  // 待辦
  const todos = [];
  if (ready.length > 0) todos.push(`${ready.length} 個 task 等審`);
  if (activeStage) {
    const isGate = await _isStageGate(db, projectId, activeStage.stage_code);
    if (isGate) todos.push(`業務確認進 Stage ${activeStage.stage_order} Gate`);
  }
  if (inProgress.length > 0 && todos.length < 2) todos.push(`${inProgress.length} 個 task 進行中`);

  // 進度摘要
  const progressParts = [];
  if (activeStage) {
    progressParts.push(`Stage ${activeStage.stage_order} ${activeStage.stage_code}`);
  } else if (project.lifecycle_status === 'DRAFT') {
    progressParts.push('草稿建立中');
  } else if (project.lifecycle_status === 'PAUSED') {
    progressParts.push('已暫停');
  } else if (project.lifecycle_status === 'CLOSED') {
    progressParts.push('已結案');
  }
  progressParts.push(`整體 ${stageProgress}%`);
  if (inProgress.length > 0) progressParts.push(`${inProgress.length} task 進行中`);

  // One-liner(列表行下用)— 取最重要的一則
  let oneLiner;
  if (risks.length > 0) oneLiner = `⚠ ${risks[0]}`;
  else if (todos.length > 0) oneLiner = `→ ${todos[0]}`;
  else if (activeStage) oneLiner = `Stage ${activeStage.stage_order} 進行中`;
  else oneLiner = `${project.lifecycle_status}`;

  // Base summary(mock — 適合 fallback / cache base)
  const baseSummary = {
    project_id: projectId,
    project_code: project.project_code,
    progress: progressParts.join(' · '),
    risk: risks.length > 0 ? risks.join(';') : '無顯著風險',
    todo: todos.length > 0 ? todos.join(';') : '依排程進行',
    one_liner: oneLiner,
    stage_progress_percent: stageProgress,
    active_stage_code: activeStage?.stage_code || null,
    risk_count: risks.length,
    overdue_task_count: overdue.length,
    blocked_task_count: blocked.length,
    generated_at: new Date().toISOString(),
    _mock: true,
  };

  // 真 LLM(可選)— PROJECTS_PLATFORM_USE_LLM=true 才打,失敗 fallback 回 mock
  let summary = baseSummary;
  if (USE_LLM) {
    try {
      summary = await _llmEnrich(baseSummary, { project, stages, tasks, activeStage, risks, todos });
    } catch (e) {
      log.warn(`LLM summary failed for project ${projectId}, fallback to mock:`, e.message);
      summary = baseSummary;
    }
  }

  _cache.set(projectId, summary);
  log.log(`generated summary for project ${projectId} (${project.project_code}) · ${summary._mock ? 'mock' : 'llm'}`);
  return summary;
}

/**
 * 用 Gemini Flash 把 mock 摘要升級成自然語言版
 * 走 llmQueue rate-limit · 失敗會被 caller catch fallback
 */
async function _llmEnrich(base, ctx) {
  const { project, stages, tasks, activeStage } = ctx;

  const promptCtx = {
    project_code:  base.project_code,
    title:         project.data_payload?.title || project.project_code,
    lifecycle:     project.lifecycle_status,
    active_stage:  activeStage?.stage_code || null,
    stage_progress: `${base.stage_progress_percent}%`,
    stages: stages.map((s) => ({ code: s.stage_code, status: s.status })),
    tasks_by_status: tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}),
    blocker_reasons: tasks.filter((t) => t.status === 'BLOCKED' && t.blocker_reason).map((t) => t.blocker_reason),
  };

  const prompt = `你是專案管理 AI 助手 #21。基於以下專案資料,產出三段式中文摘要。
規則:
1. 進度(progress):一句話描述當前 stage + 完成度 + 在跑什麼
2. 風險(risk):列 1-3 個風險(SLA、BLOCKER、客戶卡關),沒風險寫「無顯著風險」
3. 待辦(todo):列接下來 24h 內要做什麼,沒事寫「依排程進行」
4. one_liner:一句最重要的(優先 risk > todo > 進度)

回傳 JSON 格式:
{ "progress": "...", "risk": "...", "todo": "...", "one_liner": "..." }

專案資料:
${JSON.stringify(promptCtx, null, 2)}`;

  const queue = _queue();
  const result = await queue.withLLM(async () => {
    const model = _llm().getGenerativeModel({ model: LLM_MODEL });
    const resp = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return _llm().extractText(resp);
  });

  // 嘗試解析 JSON,失敗 fallback 用 base
  const text = String(result || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM did not return JSON');
  const parsed = JSON.parse(jsonMatch[0]);

  return {
    ...base,
    progress:  parsed.progress  || base.progress,
    risk:      parsed.risk      || base.risk,
    todo:      parsed.todo      || base.todo,
    one_liner: parsed.one_liner || base.one_liner,
    _mock: false,
    _llm_model: LLM_MODEL,
  };
}

async function _isStageGate(db, projectId, stageCode) {
  const r = await db.prepare(
    `SELECT gate_required FROM project_stages WHERE project_id = ? AND stage_code = ?`,
  ).get(projectId, stageCode);
  return r && Number(r.gate_required) === 1;
}

/** 批次:給 dashboard / projects list 用 */
async function getSummariesForProjects(db, projectIds) {
  const summaries = await Promise.all(projectIds.map((id) => getSummary(db, id).catch(() => null)));
  return summaries.filter(Boolean);
}

/** 強制刷新(@bot summary 觸發)*/
async function refresh(db, projectId) {
  return getSummary(db, projectId, { force: true });
}

/** Pin SUMMARY 到 announcement channel(每天 09:00 自動 / Stage 切換時)
 *  Sprint D 提供 API,Sprint F 加 cron + Stage hook
 */
async function pinToAnnouncement(db, projectId, byUserId) {
  const summary = await getSummary(db, projectId, { force: true });
  if (!summary) throw new Error('project not found');

  // 找 announcement channel
  const ann = await db.prepare(
    `SELECT id FROM project_channels
      WHERE project_id = ? AND channel_type = 'announcement' AND is_archived = 0`,
  ).get(projectId);
  if (!ann) throw new Error('announcement channel missing');

  // 找上一則 AI_INSIGHT 訊息把它 unpin(避免堆疊)
  const prev = await db.prepare(
    `SELECT id FROM project_messages
      WHERE channel_id = ? AND message_type = 'AI_INSIGHT' AND is_pinned = 1
      ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY`,
  ).get(Number(ann.id));
  if (prev) {
    await db.prepare(
      `UPDATE project_messages SET is_pinned = 0, pinned_by = NULL, pinned_at = NULL WHERE id = ?`,
    ).run(Number(prev.id));
  }

  // 新 SUMMARY 訊息
  const content =
    `⭐ Status SUMMARY · ${new Date().toLocaleString('zh-TW')}\n\n` +
    `🔵 進度:${summary.progress}\n` +
    `🟡 風險:${summary.risk}\n` +
    `🟢 待辦(24h):${summary.todo}\n\n` +
    `由 AI #21 跨 channel + form + tasks 自動生成 (mock,Sprint F 接 Gemini Flash)`;

  const ins = await db.prepare(
    `INSERT INTO project_messages
       (channel_id, project_id, user_id, content, message_type,
        is_pinned, pinned_by, pinned_at, pin_note, content_hash)
     VALUES (?, ?, ?, ?, 'AI_INSIGHT', 1, ?, SYSTIMESTAMP, '⭐ Status SUMMARY', ?)`,
  ).run(
    Number(ann.id), projectId, byUserId, content, byUserId,
    require('crypto').createHash('sha256').update(content).digest('hex').slice(0, 64),
  );
  log.log(`pinned SUMMARY for project ${projectId} as msg ${ins.lastInsertRowid}`);
  return { message_id: Number(ins.lastInsertRowid), summary };
}

module.exports = {
  getSummary,
  getSummariesForProjects,
  refresh,
  pinToAnnouncement,
  // for testing
  _cache,
};
