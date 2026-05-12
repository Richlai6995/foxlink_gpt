/**
 * confidentialityMiddleware — 機密欄位 4 種顯示策略集中
 *
 * 對齊 spec §12 + PPT slide 17 + Demo 手冊 §8
 *
 * 4 顯示策略:
 *   TIER  — 數值分級(Tier-A/M/L/H)
 *   ALIAS — 名稱替換成代號(A001)
 *   MASK  — 字串部分隱藏(蘋果****)
 *   RANGE — 數值區間(100K~500K)
 *
 * 6 demo role 行為(對齊 Demo 手冊 §10):
 *   HOST              全明文
 *   PARTICIPANT       走 displayStrategy
 *   OBSERVER          全明文(唯讀但看完整)
 *   CHAT_GUEST        form 全 403(本檔不擋,只 mask;route 層擋)
 *   SUPER_PARTICIPANT 全明文(BU/HQ 經管)
 *   OUTSIDER          走 displayStrategy 最嚴(同 PARTICIPANT)
 *
 * 注意:Phase 1 機密 demo · 真實 AES-256-GCM 加密留 Sprint F+
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('confidentialityMiddleware');

const ROLE_FULL_VIEW = new Set(['HOST', 'OBSERVER', 'SUPER_PARTICIPANT', 'admin']);

/**
 * 從 req.headers / req.user 推斷 effective demo role
 */
function getDemoRole(req) {
  // Header 優先(前端 RoleSwitcher 切換用)
  const h = req.headers['x-demo-role'];
  if (h && typeof h === 'string') return h.toUpperCase();
  // admin 預設 HOST
  if (req.user?.role === 'admin') return 'HOST';
  return 'PARTICIPANT';
}

/**
 * Apply 顯示策略到單一值
 */
function applyStrategy(value, strategy) {
  if (value === null || value === undefined) return value;
  switch (strategy) {
    case 'TIER':
      if (typeof value === 'number') {
        if (value < 1 && value > 0) {
          // margin 比率 — 0.1 = 10%
          return value >= 0.2 ? 'Tier-H' : value >= 0.1 ? 'Tier-M' : 'Tier-L';
        }
        if (value >= 100000) return 'Tier-A';
        if (value >= 10000)  return 'Tier-M';
        return 'Tier-L';
      }
      return 'Tier-?';
    case 'ALIAS':
      // 真實系統會查 alias mapping table,demo 用 A001 + hash 後綴
      return 'A001';
    case 'MASK':
      {
        const s = String(value);
        if (s.length <= 2) return '*'.repeat(s.length);
        return s.slice(0, 2) + '*'.repeat(Math.min(4, s.length - 2));
      }
    case 'RANGE':
      if (typeof value === 'number') {
        if (value >= 100000) return '100K~500K';
        if (value >= 10000)  return '10K~100K';
        if (value >= 1000)   return '1K~10K';
        return '<1K';
      }
      return '—~—';
    case 'NONE':
    default:
      return value;
  }
}

/**
 * Apply mask 到一個 project 物件
 *
 * input.project — projectsService.get() 的回傳
 *   - data_payload: { confidentialFields: ['amount','margin',...], confidentialPolicies: { amount: { enabled, strategy } } }
 * input.role — 上面 getDemoRole 推斷的
 *
 * 回傳 new project 物件(不 mutate)+ 標記哪些欄位被 mask
 */
function maskProject(project, role) {
  if (!project) return project;
  if (!project.data_payload) return project;
  if (Number(project.is_confidential) !== 1) return project;
  if (ROLE_FULL_VIEW.has(role)) {
    return { ...project, _confidential_masked: false, _viewer_role: role };
  }

  const policies = project.data_payload.confidentialPolicies || {};
  const fields = project.data_payload.confidentialFields || [];

  const maskedPayload = { ...project.data_payload };
  const maskedKeys = [];

  for (const k of fields) {
    const p = policies[k];
    if (!p || !p.enabled) continue;
    if (k in maskedPayload) {
      const original = maskedPayload[k];
      maskedPayload[k] = applyStrategy(original, p.strategy || 'TIER');
      maskedKeys.push(k);
    }
  }

  // 對 OUTSIDER 把標題也 mask 一下,visual 上更明顯
  if (role === 'OUTSIDER' && maskedPayload.title) {
    maskedPayload.title = applyStrategy(maskedPayload.title, 'MASK');
  }

  return {
    ...project,
    data_payload: maskedPayload,
    _confidential_masked: true,
    _viewer_role: role,
    _masked_keys: maskedKeys,
  };
}

/**
 * Apply mask 到 list of projects(給 ProjectsList 用)
 */
function maskProjects(projects, role) {
  return projects.map((p) => maskProject(p, role));
}

/**
 * 對 status summary mask(對 OUTSIDER / CHAT_GUEST 蓋住 summary 內容)
 */
function maskSummary(summary, role) {
  if (!summary) return summary;
  if (ROLE_FULL_VIEW.has(role)) return summary;
  if (role === 'OUTSIDER' || role === 'CHAT_GUEST') {
    return {
      ...summary,
      progress: '🔒 (機密)',
      risk:     '🔒 (機密)',
      todo:     '🔒 (機密)',
      one_liner: '🔒 不可見',
      _viewer_role: role,
    };
  }
  // PARTICIPANT — 保留摘要(因為摘要本身已是 high-level)
  return { ...summary, _viewer_role: role };
}

module.exports = {
  getDemoRole,
  applyStrategy,
  maskProject,
  maskProjects,
  maskSummary,
};
