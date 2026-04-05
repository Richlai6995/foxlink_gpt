'use strict';

/**
 * Rubric 評分引擎 — Hotspot / DragDrop / QuizInline 互動評分
 * 所有函數接受可選的 config 參數，未提供時使用預設值。
 * config 來自 courses.settings_json.scoring
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Default Configs
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_HOTSPOT_GUIDED = {
  step_points: 2,
  order_max: 5,
  efficiency_max: 3,
  time_max: 2,
  time_thresholds: [30, 60],        // <30=full, 30-60=half, >60=0
  efficiency_thresholds: [0, 2, 5], // 0=full, 1-2=2pts, 3-5=1pt, 5+=0
};

const DEFAULT_HOTSPOT_EXPLORE = {
  correctness_weight: 70,
  efficiency_weight: 30,
  efficiency_thresholds: [0, 2],    // 0=full, 1-2=2/3, 3+=1/3
};

const DEFAULT_DRAGDROP = {
  partial_credit: true,  // false = 全對才得分
};

const DEFAULT_QUIZ_INLINE = {
  partial_credit: true,
  wrong_penalty: 0.5,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Hotspot Scoring
// ═══════════════════════════════════════════════════════════════════════════════

function scoreHotspot({ action_log = [], total_steps, steps_completed, wrong_clicks, total_time_seconds, interaction_mode }, config) {
  if (total_steps === 0) return { score: 0, max_score: 0, breakdown: {} };

  if (interaction_mode === 'explore') {
    return scoreHotspotExplore({ action_log, total_steps, steps_completed, wrong_clicks }, config?.hotspot_explore);
  }
  return scoreHotspotGuided({ action_log, total_steps, steps_completed, wrong_clicks, total_time_seconds }, config?.hotspot_guided);
}

function scoreHotspotExplore({ action_log, total_steps, steps_completed, wrong_clicks }, cfg) {
  const c = { ...DEFAULT_HOTSPOT_EXPLORE, ...cfg };
  const maxScore = c.correctness_weight + c.efficiency_weight;

  // 正確性
  const correctRatio = total_steps > 0 ? steps_completed / total_steps : 0;
  const correctScore = Math.round(correctRatio * c.correctness_weight);

  // 效率
  const et = c.efficiency_thresholds;
  let efficiencyScore;
  if (wrong_clicks <= et[0]) efficiencyScore = c.efficiency_weight;
  else if (wrong_clicks <= et[1]) efficiencyScore = Math.round(c.efficiency_weight * 2 / 3);
  else efficiencyScore = Math.round(c.efficiency_weight / 3);

  const score = correctScore + efficiencyScore;
  return {
    score,
    max_score: maxScore,
    breakdown: {
      correctness: { earned: correctScore, max: c.correctness_weight, detail: `${steps_completed}/${total_steps}` },
      efficiency: { earned: efficiencyScore, max: c.efficiency_weight, detail: `${wrong_clicks} wrong clicks` }
    }
  };
}

function scoreHotspotGuided({ action_log, total_steps, steps_completed, wrong_clicks, total_time_seconds }, cfg) {
  const c = { ...DEFAULT_HOTSPOT_GUIDED, ...cfg };
  const maxScore = total_steps * c.step_points + c.order_max + c.efficiency_max + c.time_max;

  // 步驟正確性
  const stepScore = steps_completed * c.step_points;

  // 順序
  let orderScore = c.order_max;
  const successActions = (action_log || []).filter(a => a.correct);
  let outOfOrder = 0;
  for (let i = 1; i < successActions.length; i++) {
    if (successActions[i].step < successActions[i - 1].step) outOfOrder++;
  }
  if (outOfOrder === 0) orderScore = c.order_max;
  else if (outOfOrder === 1) orderScore = Math.round(c.order_max * 3 / 5);
  else orderScore = 0;

  // 效率
  const et = c.efficiency_thresholds;
  let efficiencyScore;
  if (wrong_clicks <= et[0]) efficiencyScore = c.efficiency_max;
  else if (wrong_clicks <= et[1]) efficiencyScore = Math.round(c.efficiency_max * 2 / 3);
  else if (wrong_clicks <= et[2]) efficiencyScore = Math.round(c.efficiency_max / 3);
  else efficiencyScore = 0;

  // 時間
  const tt = c.time_thresholds;
  let timeScore;
  if (total_time_seconds < tt[0]) timeScore = c.time_max;
  else if (total_time_seconds <= tt[1]) timeScore = Math.round(c.time_max / 2);
  else timeScore = 0;

  const score = stepScore + orderScore + efficiencyScore + timeScore;
  return {
    score,
    max_score: maxScore,
    breakdown: {
      steps: { earned: stepScore, max: total_steps * c.step_points, detail: `${steps_completed}/${total_steps}` },
      order: { earned: orderScore, max: c.order_max, detail: `${outOfOrder} out-of-order` },
      efficiency: { earned: efficiencyScore, max: c.efficiency_max, detail: `${wrong_clicks} wrong clicks` },
      time: { earned: timeScore, max: c.time_max, detail: `${total_time_seconds}s` }
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DragDrop Scoring
// ═══════════════════════════════════════════════════════════════════════════════

function scoreDragDrop({ mode, user_answer, correct_answer, total_time_seconds }, config) {
  const c = { ...DEFAULT_DRAGDROP, ...config?.dragdrop };
  const maxScore = 100;

  if (mode === 'ordering') {
    const items = correct_answer || [];
    const user = user_answer || [];
    let correctCount = 0;
    for (let i = 0; i < items.length; i++) {
      if (user[i] === items[i]) correctCount++;
    }
    const total = items.length || 1;
    const score = c.partial_credit
      ? Math.round((correctCount / total) * maxScore)
      : (correctCount === total ? maxScore : 0);
    return {
      score, max_score: maxScore,
      breakdown: { correct_positions: { earned: correctCount, max: total, detail: `${correctCount}/${total} correct` } }
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
  const score = c.partial_credit
    ? Math.round((correctCount / total) * maxScore)
    : (correctCount === total ? maxScore : 0);
  return {
    score, max_score: maxScore,
    breakdown: { correct_matches: { earned: correctCount, max: total, detail: `${correctCount}/${total} correct` } }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// QuizInline Scoring
// ═══════════════════════════════════════════════════════════════════════════════

function scoreQuizInline({ question_type, user_answer, correct_answer, points = 10 }, config) {
  const c = { ...DEFAULT_QUIZ_INLINE, ...config?.quiz_inline };

  if (question_type === 'single') {
    const isCorrect = user_answer === correct_answer;
    return { score: isCorrect ? points : 0, max_score: points, breakdown: { correct: isCorrect } };
  }

  if (question_type === 'multi') {
    const correct = new Set(correct_answer || []);
    const user = new Set(user_answer || []);
    let hits = 0;
    for (const a of user) { if (correct.has(a)) hits++; }
    const wrong = user.size - hits;

    let score;
    if (c.partial_credit) {
      score = Math.max(0, Math.round(((hits - wrong * c.wrong_penalty) / correct.size) * points));
    } else {
      score = (hits === correct.size && wrong === 0) ? points : 0;
    }
    return { score, max_score: points, breakdown: { hits, wrong, total: correct.size } };
  }

  if (question_type === 'fill_blank') {
    const answers = Array.isArray(correct_answer) ? correct_answer : [correct_answer];
    const isCorrect = answers.some(a =>
      String(a).trim().toLowerCase() === String(user_answer).trim().toLowerCase()
    );
    return { score: isCorrect ? points : 0, max_score: points, breakdown: { correct: isCorrect } };
  }

  return { score: 0, max_score: points, breakdown: { error: 'unknown question_type' } };
}

// Export defaults for frontend reference
module.exports = {
  scoreHotspot, scoreDragDrop, scoreQuizInline,
  DEFAULT_HOTSPOT_GUIDED, DEFAULT_HOTSPOT_EXPLORE, DEFAULT_DRAGDROP, DEFAULT_QUIZ_INLINE
};
