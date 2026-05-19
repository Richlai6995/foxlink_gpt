/**
 * Win-Rate Predictor — Sprint O(spec §16.4 + Demo §8.5)
 *
 * 贏單機率預測:基於 BOM 結構 / 客戶等級 / 季節 / 競品 / 歷史類似案 預測 W/L
 *
 * Phase 3 MVP(2026-05-19):
 *   - 規則式 baseline(類比歷史 WIN/LOSS 比例 + projects 特徵打分)
 *   - LLM 補語意推論(優勢 / 風險 / 行動建議)
 *   - ML 框架備齊(features extractor),實際 model train/serve 待 data 累積
 *
 * 模型 serving 設計(後續):
 *   - Phase 3 末:Python sklearn 微 service(/ml/win-rate-predict)
 *   - Vertex AI Custom Predictor 上線
 *   - 本檔抽象出 PREDICTOR_BACKEND env:'rule' | 'sklearn' | 'vertex'
 *
 * 訓練資料:project_kb_chunks WHERE is_sediment=1 AND kind='case'
 *   - tags 含 'CLOSED_WIN' / 'CLOSED_LOSS' / 'CLOSED_HOLD' label
 *   - Sprint J fork pipeline 已寫進 chunk
 */

const { makeLogger } = require('./logger');
const log = makeLogger('winRatePredictor');

const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true';
const BACKEND = process.env.PROJECTS_WIN_RATE_BACKEND || 'rule';   // 'rule' | 'sklearn' | 'vertex'

/**
 * 預測 project 贏單機率
 *
 * @param {object} db
 * @param {object} input
 * @param {number} input.projectId
 * @param {object} input.user
 */
async function predict(db, { projectId, user }) {
  if (!projectId) throw new Error('projectId required');

  // 1. 抓 project + 特徵
  const features = await extractFeatures(db, projectId);
  if (!features) throw new Error('project not found');

  // 2. 規則式 base score
  const ruleResult = _ruleBasedPredict(features);

  // 3. LLM 補語意(若開)
  let reasoning = null;
  if (USE_LLM) {
    try {
      reasoning = await _llmReasoning(features, ruleResult);
    } catch (e) {
      log.warn(`LLM reasoning failed: ${e.message}`);
    }
  }

  // 4. (Future)真 ML 模型呼叫(BACKEND='sklearn' / 'vertex')
  let mlScore = null;
  if (BACKEND === 'sklearn' || BACKEND === 'vertex') {
    try {
      mlScore = await _callMlBackend(features);
    } catch (e) {
      log.warn(`ML backend ${BACKEND} failed: ${e.message}`);
    }
  }

  // 5. Final score:有 ML 用 ML,否則用 rule
  const finalScore = mlScore != null ? mlScore : ruleResult.score;

  return {
    project_id: projectId,
    win_rate_percent: Math.round(finalScore * 100),
    confidence: ruleResult.confidence,  // 'low' | 'mid' | 'high'(依歷史相似案數)
    backend: mlScore != null ? BACKEND : 'rule',
    features,
    factors: ruleResult.factors,         // [{ name, weight, direction, note }]
    similar_cases: ruleResult.similar_cases,
    reasoning_md: reasoning,
    _stub: !USE_LLM && BACKEND === 'rule',
  };
}

/**
 * 抽取 project 的 ML features
 */
async function extractFeatures(db, projectId) {
  const project = await db.prepare(`
    SELECT p.id, p.project_code, p.data_payload, p.lifecycle_status,
           p.priority_score, p.importance, p.urgency, p.bu_id, p.is_confidential,
           p.created_at, p.sla_due_at
      FROM projects p
     WHERE p.id = ?
  `).get(projectId);
  if (!project) return null;

  const payload = (() => { try { return JSON.parse(project.data_payload || '{}'); } catch { return {}; } })();

  // 找相似 sediment 案(part_no / specs LIKE)+ 統計 WIN/LOSS
  const similarCases = await _findSimilarSedimentCases(db, payload);
  const winCount  = similarCases.filter((c) => c.tags?.includes('CLOSED_WIN'))  .length;
  const lossCount = similarCases.filter((c) => c.tags?.includes('CLOSED_LOSS')) .length;
  const holdCount = similarCases.filter((c) => c.tags?.includes('CLOSED_HOLD')) .length;
  const historyWinRate = (winCount + lossCount) > 0 ? winCount / (winCount + lossCount) : null;

  // priority_score 越高代表越戰略客戶 → 對贏單通常正相關(但也可能因為更挑剔)
  const priorityScore = Number(project.priority_score) || 3;

  // 季節:當月(1-12)
  const month = new Date(project.created_at || new Date()).getMonth() + 1;

  // Open task / blocker 比例(進行中健康度)
  const tasksAgg = await db.prepare(`
    SELECT
      COUNT(*) AS total_cnt,
      SUM(CASE WHEN status='DONE' THEN 1 ELSE 0 END) AS done_cnt,
      SUM(CASE WHEN status='BLOCKED' THEN 1 ELSE 0 END) AS blocker_cnt
      FROM project_tasks WHERE project_id = ?
  `).get(projectId).catch(() => ({}));

  // BU win rate(該 BU 整體 WIN 比例)
  const buAgg = await db.prepare(`
    SELECT
      SUM(CASE WHEN status='CLOSED_WIN' THEN 1 ELSE 0 END) AS w,
      SUM(CASE WHEN status='CLOSED_LOSS' THEN 1 ELSE 0 END) AS l
      FROM projects WHERE bu_id = ? AND lifecycle_status='CLOSED'
  `).get(project.bu_id).catch(() => ({ w: 0, l: 0 }));
  const buWinRate = (Number(buAgg?.w || 0) + Number(buAgg?.l || 0)) > 0
    ? Number(buAgg.w) / (Number(buAgg.w) + Number(buAgg.l))
    : null;

  return {
    project_code:  project.project_code,
    customer:      payload.customer || payload.customer_name || null,
    part_no:       payload.partNo || payload.part_no || null,
    quantity:      Number(payload.quantity) || null,
    due_date:      payload.dueDate || payload.due_date || null,
    is_confidential: Number(project.is_confidential) === 1,
    bu_id:         Number(project.bu_id) || null,
    priority_score: priorityScore,
    importance:    project.importance,
    urgency:       project.urgency,
    lifecycle:     project.lifecycle_status,

    // ML features
    history_win_rate:   historyWinRate,
    history_sample:     similarCases.length,
    history_win_cnt:    winCount,
    history_loss_cnt:   lossCount,
    history_hold_cnt:   holdCount,
    bu_win_rate:        buWinRate,
    bu_total_closed:    Number(buAgg?.w || 0) + Number(buAgg?.l || 0),
    season_month:       month,
    task_total:         Number(tasksAgg?.total_cnt   || 0),
    task_done:          Number(tasksAgg?.done_cnt    || 0),
    task_blocker:       Number(tasksAgg?.blocker_cnt || 0),
  };
}

async function _findSimilarSedimentCases(db, payload) {
  const keys = [];
  if (payload.partNo)   keys.push(String(payload.partNo).slice(0, 30));
  if (payload.part_no)  keys.push(String(payload.part_no).slice(0, 30));
  if (payload.specs)    keys.push(...String(payload.specs).split(/[\s,。?!,?]/).filter((s) => s.length >= 3).slice(0, 3));
  if (keys.length === 0) return [];

  const wh = ["is_sediment = 1", "kind = 'case'",
              '(' + keys.map(() => "UPPER(content) LIKE UPPER(?)").join(' OR ') + ')'];
  const params = keys.map((k) => `%${k}%`);

  try {
    const rows = await db.prepare(`
      SELECT id, project_id, content, tags FROM project_kb_chunks
       WHERE ${wh.join(' AND ')}
       ORDER BY created_at DESC
       FETCH FIRST 30 ROWS ONLY
    `).all(...params);
    return rows.map((r) => {
      let tags = [];
      try { tags = JSON.parse(r.tags || '[]'); } catch (_) {}
      return { ...r, tags };
    });
  } catch (e) {
    log.warn(`find similar cases failed: ${e.message}`);
    return [];
  }
}

function _ruleBasedPredict(features) {
  // Base rate
  let score = 0.50;
  const factors = [];

  // 歷史相似 win rate(最強信號)
  if (features.history_win_rate != null && features.history_sample >= 3) {
    const histDelta = (features.history_win_rate - 0.50) * 0.7;
    score += histDelta;
    factors.push({
      name: '歷史相似案 win rate',
      value: `${Math.round(features.history_win_rate * 100)}% (n=${features.history_sample})`,
      weight: 0.7,
      direction: histDelta > 0 ? 'positive' : 'negative',
    });
  }

  // BU 整體 win rate
  if (features.bu_win_rate != null && features.bu_total_closed >= 5) {
    const buDelta = (features.bu_win_rate - 0.50) * 0.15;
    score += buDelta;
    factors.push({
      name: 'BU 平均 win rate',
      value: `${Math.round(features.bu_win_rate * 100)}% (n=${features.bu_total_closed})`,
      weight: 0.15,
      direction: buDelta > 0 ? 'positive' : 'negative',
    });
  }

  // priority_score(策略客戶通常更願意接 → +)
  if (features.priority_score >= 5) {
    score += 0.05;
    factors.push({ name: '高 priority_score', value: features.priority_score, weight: 0.05, direction: 'positive' });
  }

  // Blocker 比例(進行中阻力)
  if (features.task_total > 0) {
    const blockerRate = features.task_blocker / features.task_total;
    if (blockerRate > 0.15) {
      score -= 0.10;
      factors.push({ name: 'task BLOCKER 比例高', value: `${Math.round(blockerRate * 100)}%`, weight: -0.10, direction: 'negative' });
    }
  }

  // 季節:Q4 / 農曆年前報價通常更激烈(LOSS rate 略升)
  if ([10, 11, 12, 1].includes(features.season_month)) {
    score -= 0.03;
    factors.push({ name: `Q4/Q1 季節因素(month=${features.season_month})`, value: 'competitive', weight: -0.03, direction: 'negative' });
  }

  // Clamp
  score = Math.max(0.05, Math.min(0.95, score));

  // Confidence based on sample size
  const confidence = features.history_sample >= 10 ? 'high' :
                     features.history_sample >= 3  ? 'mid' :
                     'low';

  return {
    score,
    confidence,
    factors,
    similar_cases: features.history_sample,
  };
}

async function _llmReasoning(features, ruleResult) {
  const { getGenerativeModel, extractText } = require('../../services/geminiClient');
  const llmQueue = require('./llmQueue');

  const sys = `你是 Cortex 平台的 AI 助手(#17 贏單機率預測)。
用繁體中文 markdown,< 250 字:
1. 解讀「為何贏單機率是 X%」
2. 列出最強正向 / 負向因素
3. 給「提升勝率」的 2-3 條建議
規則:不引用機密原值(features 已 mask)`;

  const usr = `# Project features
${JSON.stringify(features, null, 2)}

# 規則式預測
score: ${ruleResult.score.toFixed(3)}
confidence: ${ruleResult.confidence}
factors:
${ruleResult.factors.map((f) => `- ${f.name}: ${f.value} (weight=${f.weight}, ${f.direction})`).join('\n')}

請給 markdown 解讀。`;

  const model = getGenerativeModel({
    model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash',
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
    systemInstruction: sys,
  });

  const res = await llmQueue.withLLM(async () => {
    return model.generateContent({ contents: [{ role: 'user', parts: [{ text: usr }] }] });
  }, { label: 'win_rate_reasoning', timeoutMs: 30_000 });

  return extractText(res).trim();
}

async function _callMlBackend(features) {
  // TODO:Phase 3 末 Python sklearn / Vertex AI Custom Predictor 上線後接通
  // 預設 stub
  log.log(`ML backend ${BACKEND} not yet implemented, falling back to rule`);
  return null;
}

/**
 * 批次預測(Sprint Q 用 — Dashboard widget C)
 *
 * @param {object} db
 * @param {object} input
 * @param {number[]} input.projectIds — 若空 → 撈所有 ACTIVE
 * @param {number} [input.limit=50]
 */
async function predictBatch(db, { projectIds, limit = 50 } = {}) {
  let ids = projectIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    const rows = await db.prepare(`
      SELECT id FROM projects WHERE lifecycle_status = 'ACTIVE'
       ORDER BY priority_score DESC NULLS LAST
       FETCH FIRST ${Math.min(limit, 200)} ROWS ONLY
    `).all().catch(() => []);
    ids = rows.map((r) => Number(r.id));
  }
  ids = ids.slice(0, Math.min(limit, 200));

  const results = [];
  for (const pid of ids) {
    try {
      // 批次跑跳過 LLM(只規則式)
      const features = await extractFeatures(db, pid);
      if (!features) continue;
      const rule = _ruleBasedPredict(features);
      results.push({
        project_id: pid,
        project_code: features.project_code,
        customer: features.customer,
        win_rate_percent: Math.round(rule.score * 100),
        confidence: rule.confidence,
        history_sample: features.history_sample,
        top_factor: rule.factors[0] || null,
      });
    } catch (e) {
      log.warn(`predict project ${pid} failed: ${e.message}`);
    }
  }
  return results;
}

module.exports = {
  predict,
  predictBatch,
  extractFeatures,
};
