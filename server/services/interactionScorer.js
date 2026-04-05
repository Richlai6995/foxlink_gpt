'use strict';

/**
 * Rubric 評分引擎 — Hotspot / DragDrop / QuizInline 互動評分
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Hotspot Scoring
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {Object} opts
 * @param {Array}  opts.action_log       — [{step, region_id, correct, attempt_number, timestamp}]
 * @param {number} opts.total_steps      — 總步驟數
 * @param {number} opts.steps_completed  — 完成步驟數
 * @param {number} opts.wrong_clicks     — 錯誤點擊數
 * @param {number} opts.total_time_seconds
 * @param {string} opts.interaction_mode — 'guided' | 'explore'
 * @returns {{ score: number, max_score: number, breakdown: Object }}
 */
function scoreHotspot({ action_log = [], total_steps, steps_completed, wrong_clicks, total_time_seconds, interaction_mode }) {
  if (total_steps === 0) return { score: 0, max_score: 0, breakdown: {} };

  if (interaction_mode === 'explore') {
    return scoreHotspotExplore({ action_log, total_steps, steps_completed, wrong_clicks });
  }
  return scoreHotspotGuided({ action_log, total_steps, steps_completed, wrong_clicks, total_time_seconds });
}

// 單步 (explore): 正確性 70% + 嘗試效率 30%
function scoreHotspotExplore({ action_log, total_steps, steps_completed, wrong_clicks }) {
  const maxScore = 100;

  // 正確性 (70%)
  const correctRatio = total_steps > 0 ? steps_completed / total_steps : 0;
  const correctScore = Math.round(correctRatio * 70);

  // 嘗試效率 (30%) — 0 錯 = 滿分, 1-2 = 2/3, 3+ = 1/3
  let efficiencyScore;
  if (wrong_clicks === 0) efficiencyScore = 30;
  else if (wrong_clicks <= 2) efficiencyScore = 20;
  else efficiencyScore = 10;

  const score = correctScore + efficiencyScore;
  return {
    score,
    max_score: maxScore,
    breakdown: {
      correctness: { earned: correctScore, max: 70, detail: `${steps_completed}/${total_steps}` },
      efficiency: { earned: efficiencyScore, max: 30, detail: `${wrong_clicks} wrong clicks` }
    }
  };
}

// 多步 (guided): 步驟正確性(每步2分) + 順序(5分) + 效率(3分) + 時間(2分)
function scoreHotspotGuided({ action_log, total_steps, steps_completed, wrong_clicks, total_time_seconds }) {
  const stepPoints = 2;
  const orderMax = 5;
  const efficiencyMax = 3;
  const timeMax = 2;
  const maxScore = total_steps * stepPoints + orderMax + efficiencyMax + timeMax;

  // 步驟正確性
  const stepScore = steps_completed * stepPoints;

  // 順序 — 檢查 action_log 中成功步驟是否按序
  let orderScore = orderMax;
  const successActions = (action_log || []).filter(a => a.correct);
  let outOfOrder = 0;
  for (let i = 1; i < successActions.length; i++) {
    if (successActions[i].step < successActions[i - 1].step) outOfOrder++;
  }
  if (outOfOrder === 0) orderScore = orderMax;
  else if (outOfOrder === 1) orderScore = 3;
  else orderScore = 0;

  // 效率 — 基於錯誤點擊
  let efficiencyScore;
  if (wrong_clicks === 0) efficiencyScore = efficiencyMax;
  else if (wrong_clicks <= 2) efficiencyScore = 2;
  else if (wrong_clicks <= 5) efficiencyScore = 1;
  else efficiencyScore = 0;

  // 時間 — <30s = 2, 30-60s = 1, >60s = 0
  let timeScore;
  if (total_time_seconds < 30) timeScore = timeMax;
  else if (total_time_seconds <= 60) timeScore = 1;
  else timeScore = 0;

  const score = stepScore + orderScore + efficiencyScore + timeScore;
  return {
    score,
    max_score: maxScore,
    breakdown: {
      steps: { earned: stepScore, max: total_steps * stepPoints, detail: `${steps_completed}/${total_steps}` },
      order: { earned: orderScore, max: orderMax, detail: `${outOfOrder} out-of-order` },
      efficiency: { earned: efficiencyScore, max: efficiencyMax, detail: `${wrong_clicks} wrong clicks` },
      time: { earned: timeScore, max: timeMax, detail: `${total_time_seconds}s` }
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DragDrop Scoring
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {Object} opts
 * @param {string} opts.mode            — 'ordering' | 'matching' | 'classification'
 * @param {Array}  opts.user_answer     — ordering: ['id1','id2',...] | matching: {targetId: itemId}
 * @param {Array}  opts.correct_answer  — same shape
 * @param {number} opts.total_time_seconds
 * @returns {{ score: number, max_score: number, breakdown: Object }}
 */
function scoreDragDrop({ mode, user_answer, correct_answer, total_time_seconds }) {
  const maxScore = 100;

  if (mode === 'ordering') {
    const items = correct_answer || [];
    const user = user_answer || [];
    let correctCount = 0;
    for (let i = 0; i < items.length; i++) {
      if (user[i] === items[i]) correctCount++;
    }
    const total = items.length || 1;
    const score = Math.round((correctCount / total) * maxScore);
    return {
      score,
      max_score: maxScore,
      breakdown: {
        correct_positions: { earned: correctCount, max: total, detail: `${correctCount}/${total} correct` }
      }
    };
  }

  // matching / classification
  const targets = correct_answer || {};
  const user = user_answer || {};
  const keys = Object.keys(targets);
  let correctCount = 0;
  for (const k of keys) {
    if (user[k] === targets[k]) correctCount++;
  }
  const total = keys.length || 1;
  const score = Math.round((correctCount / total) * maxScore);
  return {
    score,
    max_score: maxScore,
    breakdown: {
      correct_matches: { earned: correctCount, max: total, detail: `${correctCount}/${total} correct` }
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// QuizInline Scoring
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {Object} opts
 * @param {string} opts.question_type  — 'single' | 'multi' | 'fill_blank'
 * @param {*}      opts.user_answer
 * @param {*}      opts.correct_answer
 * @param {number} opts.points         — max points for this question
 * @returns {{ score: number, max_score: number, breakdown: Object }}
 */
function scoreQuizInline({ question_type, user_answer, correct_answer, points = 10 }) {
  if (question_type === 'single') {
    const isCorrect = user_answer === correct_answer;
    return {
      score: isCorrect ? points : 0,
      max_score: points,
      breakdown: { correct: isCorrect }
    };
  }

  if (question_type === 'multi') {
    const correct = new Set(correct_answer || []);
    const user = new Set(user_answer || []);
    let hits = 0;
    for (const a of user) { if (correct.has(a)) hits++; }
    const wrong = user.size - hits;
    const score = Math.max(0, Math.round(((hits - wrong * 0.5) / correct.size) * points));
    return {
      score,
      max_score: points,
      breakdown: { hits, wrong, total: correct.size }
    };
  }

  if (question_type === 'fill_blank') {
    const answers = Array.isArray(correct_answer) ? correct_answer : [correct_answer];
    const isCorrect = answers.some(a =>
      String(a).trim().toLowerCase() === String(user_answer).trim().toLowerCase()
    );
    return {
      score: isCorrect ? points : 0,
      max_score: points,
      breakdown: { correct: isCorrect }
    };
  }

  return { score: 0, max_score: points, breakdown: { error: 'unknown question_type' } };
}

module.exports = { scoreHotspot, scoreDragDrop, scoreQuizInline };
