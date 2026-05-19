/**
 * Approval Service — Sprint P · 多級簽核(spec roadmap Sprint P)
 *
 * 流程:
 *   1. PM/admin 點「申請 stage 推進」/「申請結案」/「升級為機密」
 *   2. service.createChain() 依 trigger rule 建 chain + N 個 steps
 *   3. 各 step approver 在 UI 看到 pending → approve/reject
 *   4. 全 steps approved → trigger target action(advanceStage / closeLifecycle / etc.)
 *   5. 任一 step rejected → chain 終結為 REJECTED,不執行 action
 *
 * Trigger 規則(MVP):
 *   - amount >= 100k USD → 高金額(BU director + sales 雙簽)
 *   - is_confidential 升級 → 機密升級(admin + confidential.policy_editor)
 *   - lifecycle CLOSED → 結案簽核(BU director 單簽)
 *   - 預設 stage gate 不卡 approval(沿用 Sprint A 既有 gate)
 */

const { makeLogger } = require('./logger');
const log = makeLogger('approvalService');

/**
 * 建 approval chain
 *
 * @param {object} db
 * @param {object} input
 * @param {number} input.projectId
 * @param {string} input.chainKind   — 'stage_gate' | 'lifecycle_close' | 'confidential_upgrade' | 'high_amount'
 * @param {string} input.title
 * @param {string} [input.reason]
 * @param {number} input.requestedByUserId
 * @param {object} [input.targetPayload]  — apply 時用的 patch(e.g. { stage_id, to_lifecycle })
 * @param {number} [input.targetStageId]
 * @param {number} [input.expiresInHours=72]
 */
async function createChain(db, input) {
  const {
    projectId, chainKind, title, reason, requestedByUserId,
    targetPayload, targetStageId, expiresInHours = 72,
  } = input;

  if (!projectId || !chainKind || !title || !requestedByUserId) {
    throw new Error('projectId / chainKind / title / requestedByUserId required');
  }

  // 找對應 trigger 規則 → 取 steps 範本
  const steps = await _resolveSteps(db, { projectId, chainKind });
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error(`no approver steps for chainKind ${chainKind} (請 admin 在 approval triggers 設定)`);
  }

  const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3600_000) : null;

  const ins = await db.prepare(`
    INSERT INTO project_approval_chains
      (project_id, chain_kind, title, reason, requested_by_user_id,
       target_stage_id, target_payload_json, total_steps, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId, chainKind, title.slice(0, 300),
    reason ? String(reason).slice(0, 1000) : null,
    requestedByUserId,
    targetStageId || null,
    targetPayload ? JSON.stringify(targetPayload) : null,
    steps.length,
    expiresAt,
  );
  const chainId = Number(ins.lastInsertRowid);

  // Insert steps
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await db.prepare(`
      INSERT INTO project_approval_steps
        (chain_id, step_order, approver_user_id, approver_role, step_kind)
      VALUES (?, ?, ?, ?, ?)
    `).run(chainId, i + 1, s.approver_user_id || null, s.approver_role || null, s.step_kind || 'approve');
  }

  log.log(`createChain ${chainId} kind=${chainKind} steps=${steps.length} project=${projectId}`);

  // 通知 step 1 approver
  await _notifyStep(db, chainId, 1);

  return { id: chainId, steps_count: steps.length };
}

/**
 * Approve / reject a step
 *
 * @param {object} db
 * @param {object} input
 * @param {number} input.chainId
 * @param {number} input.stepOrder
 * @param {string} input.decision   — 'approved' | 'rejected'
 * @param {number} input.decidedByUserId
 * @param {string} [input.comment]
 */
async function decide(db, { chainId, stepOrder, decision, decidedByUserId, comment }) {
  if (!chainId || !stepOrder || !decision) throw new Error('chainId / stepOrder / decision required');
  if (!['approved', 'rejected', 'skipped'].includes(decision)) {
    throw new Error(`invalid decision: ${decision}`);
  }

  // 找 chain + 確認狀態
  const chain = await db.prepare(`
    SELECT id, status, current_step_order, total_steps, chain_kind, target_stage_id,
           target_payload_json, project_id, requested_by_user_id
      FROM project_approval_chains WHERE id = ?
  `).get(chainId);
  if (!chain) throw new Error('chain not found');
  if (chain.status !== 'PENDING') throw new Error(`chain already ${chain.status}`);
  if (Number(chain.current_step_order) !== Number(stepOrder)) {
    throw new Error(`step ${stepOrder} 不是當前 active step(current=${chain.current_step_order})`);
  }

  // 找 step 確認 approver 身份
  const step = await db.prepare(`
    SELECT id, approver_user_id, approver_role, decision
      FROM project_approval_steps WHERE chain_id = ? AND step_order = ?
  `).get(chainId, stepOrder);
  if (!step) throw new Error('step not found');
  if (step.decision) throw new Error(`step already ${step.decision}`);

  // 權限 check:approver_user_id 指定 → 必須是同 user · approver_role 設 → user 必須有此 role
  const allowed = await _canDecide(db, step, decidedByUserId);
  if (!allowed) {
    throw new Error('not authorized to decide this step');
  }

  // 寫 decision
  await db.prepare(`
    UPDATE project_approval_steps
       SET decision = ?, decided_by_user_id = ?, decided_at = SYSTIMESTAMP, decision_comment = ?
     WHERE id = ?
  `).run(decision, decidedByUserId, comment ? String(comment).slice(0, 2000) : null, step.id);

  // Reject → chain 終結
  if (decision === 'rejected') {
    await db.prepare(`
      UPDATE project_approval_chains
         SET status = 'REJECTED', completed_at = SYSTIMESTAMP, completed_by_user_id = ?
       WHERE id = ?
    `).run(decidedByUserId, chainId);
    log.log(`chain ${chainId} REJECTED at step ${stepOrder}`);
    await _notifyResolved(db, chain, 'rejected', decidedByUserId);
    return { status: 'REJECTED', chain_id: chainId };
  }

  // Approved → 推進到下一 step 或 完成
  if (Number(stepOrder) >= Number(chain.total_steps)) {
    // 全 approve → 跑 target action
    await db.prepare(`
      UPDATE project_approval_chains
         SET status = 'APPROVED', completed_at = SYSTIMESTAMP, completed_by_user_id = ?
       WHERE id = ?
    `).run(decidedByUserId, chainId);
    log.log(`chain ${chainId} APPROVED · all ${chain.total_steps} steps done`);
    await _applyTargetAction(db, chain, decidedByUserId);
    await _notifyResolved(db, chain, 'approved', decidedByUserId);
    return { status: 'APPROVED', chain_id: chainId };
  }

  // 推進 step
  const nextStepOrder = Number(stepOrder) + 1;
  await db.prepare(`
    UPDATE project_approval_chains SET current_step_order = ?, updated_at = SYSTIMESTAMP WHERE id = ?
  `).run(nextStepOrder, chainId);
  await _notifyStep(db, chainId, nextStepOrder);

  return { status: 'PENDING', chain_id: chainId, current_step_order: nextStepOrder };
}

/**
 * 列 user 待 approve 的 chain steps
 */
async function listPendingForUser(db, userId) {
  if (!userId) return [];

  // 1. step.approver_user_id = userId 且 decision=NULL
  const direct = await db.prepare(`
    SELECT c.id AS chain_id, c.project_id, c.chain_kind, c.title, c.reason,
           c.requested_by_user_id, c.current_step_order, c.total_steps,
           c.expires_at, c.created_at,
           s.id AS step_id, s.step_order, s.approver_role, s.step_kind,
           p.project_code, p.data_payload,
           u.username AS requester_username, u.name AS requester_name
      FROM project_approval_steps s
      JOIN project_approval_chains c ON c.id = s.chain_id
      JOIN projects p ON p.id = c.project_id
      LEFT JOIN users u ON u.id = c.requested_by_user_id
     WHERE s.approver_user_id = ? AND s.decision IS NULL
       AND c.status = 'PENDING'
       AND c.current_step_order = s.step_order
     ORDER BY c.created_at DESC
     FETCH FIRST 100 ROWS ONLY
  `).all(userId).catch(() => []);

  // 2. step.approver_role 指定 + user 有此 role
  // 簡化:從 userRoleService.getEffectiveRoles 拿 user 的 role 列表
  const userRoles = require('./userRoleService');
  const effective = await userRoles.getEffectiveRoles(db, userId);
  const roleCodes = effective.map((g) => g.role_code);
  let viaRole = [];
  if (roleCodes.length) {
    const placeholders = roleCodes.map(() => '?').join(',');
    viaRole = await db.prepare(`
      SELECT c.id AS chain_id, c.project_id, c.chain_kind, c.title, c.reason,
             c.requested_by_user_id, c.current_step_order, c.total_steps,
             c.expires_at, c.created_at,
             s.id AS step_id, s.step_order, s.approver_role, s.step_kind,
             p.project_code, p.data_payload,
             u.username AS requester_username, u.name AS requester_name
        FROM project_approval_steps s
        JOIN project_approval_chains c ON c.id = s.chain_id
        JOIN projects p ON p.id = c.project_id
        LEFT JOIN users u ON u.id = c.requested_by_user_id
       WHERE s.approver_user_id IS NULL AND s.approver_role IN (${placeholders})
         AND s.decision IS NULL
         AND c.status = 'PENDING'
         AND c.current_step_order = s.step_order
       ORDER BY c.created_at DESC
       FETCH FIRST 100 ROWS ONLY
    `).all(...roleCodes).catch(() => []);
  }

  // 去重
  const seen = new Set();
  const out = [];
  for (const r of [...direct, ...viaRole]) {
    const key = `${r.chain_id}:${r.step_order}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(_formatPending(r));
  }
  return out;
}

/** 列某 project 的 chain history */
async function listForProject(db, projectId) {
  const chains = await db.prepare(`
    SELECT c.id, c.chain_kind, c.title, c.reason, c.status,
           c.requested_by_user_id, c.target_stage_id,
           c.current_step_order, c.total_steps,
           c.created_at, c.completed_at, c.expires_at,
           u.username AS requester_username, u.name AS requester_name
      FROM project_approval_chains c
      LEFT JOIN users u ON u.id = c.requested_by_user_id
     WHERE c.project_id = ?
     ORDER BY c.created_at DESC
     FETCH FIRST 100 ROWS ONLY
  `).all(projectId).catch(() => []);

  // 順便附帶 steps
  for (const c of chains) {
    c.steps = await db.prepare(`
      SELECT s.id, s.step_order, s.approver_user_id, s.approver_role, s.step_kind,
             s.decision, s.decided_by_user_id, s.decided_at, s.decision_comment AS comment,
             u1.name AS approver_name, u1.username AS approver_username,
             u2.name AS decided_by_name
        FROM project_approval_steps s
        LEFT JOIN users u1 ON u1.id = s.approver_user_id
        LEFT JOIN users u2 ON u2.id = s.decided_by_user_id
       WHERE s.chain_id = ?
       ORDER BY s.step_order
    `).all(c.id).catch(() => []);
  }
  return chains;
}

/** Cancel chain(requester 或 admin)*/
async function cancel(db, { chainId, byUserId, reason }) {
  const chain = await db.prepare(
    `SELECT id, status, requested_by_user_id FROM project_approval_chains WHERE id = ?`,
  ).get(chainId);
  if (!chain) throw new Error('chain not found');
  if (chain.status !== 'PENDING') throw new Error(`chain already ${chain.status}`);

  const u = await db.prepare(`SELECT role FROM users WHERE id = ?`).get(byUserId).catch(() => null);
  const isAdmin = u?.role === 'admin';
  const isRequester = Number(chain.requested_by_user_id) === Number(byUserId);
  if (!isAdmin && !isRequester) throw new Error('only requester or admin can cancel');

  await db.prepare(`
    UPDATE project_approval_chains
       SET status = 'CANCELLED', completed_at = SYSTIMESTAMP, completed_by_user_id = ?,
           reason = ?
     WHERE id = ?
  `).run(byUserId, reason ? String(reason).slice(0, 1000) : null, chainId);
  log.log(`chain ${chainId} CANCELLED by user ${byUserId}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
async function _resolveSteps(db, { projectId, chainKind }) {
  // 找 trigger config(per chain_kind · is_active)
  const trigger = await db.prepare(`
    SELECT approver_chain_json FROM project_approval_triggers
     WHERE chain_kind = ? AND is_active = 1
     ORDER BY id DESC FETCH FIRST 1 ROWS ONLY
  `).get(chainKind).catch(() => null);

  let steps;
  if (trigger?.approver_chain_json) {
    try {
      steps = JSON.parse(trigger.approver_chain_json);
    } catch (_) {
      steps = null;
    }
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    // Built-in default per chain_kind
    steps = _defaultSteps(chainKind);
  }
  return steps;
}

function _defaultSteps(chainKind) {
  switch (chainKind) {
    case 'high_amount':           return [{ approver_role: 'project.bu_director' }, { approver_role: 'project.sales' }];
    case 'confidential_upgrade':  return [{ approver_role: 'confidential.policy_editor' }, { approver_role: 'admin' }];
    case 'lifecycle_close':       return [{ approver_role: 'project.bu_director' }];
    case 'stage_gate':            return [{ approver_role: 'project.bu_director' }];
    default:                      return [{ approver_role: 'admin' }];
  }
}

async function _canDecide(db, step, userId) {
  // admin 永遠可
  const u = await db.prepare(`SELECT role FROM users WHERE id = ?`).get(userId).catch(() => null);
  if (u?.role === 'admin') return true;

  // approver_user_id 指定
  if (step.approver_user_id && Number(step.approver_user_id) === Number(userId)) return true;

  // approver_role 指定 → check user 有此 role grant
  if (step.approver_role) {
    const userRoles = require('./userRoleService');
    return await userRoles.hasRole(db, userId, step.approver_role);
  }

  return false;
}

async function _applyTargetAction(db, chain, decidedByUserId) {
  try {
    let payload = {};
    try { payload = JSON.parse(chain.target_payload_json || '{}'); } catch (_) {}

    if (chain.chain_kind === 'stage_gate' && chain.target_stage_id) {
      const stagesService = require('./stagesService');
      const user = { id: decidedByUserId, role: 'admin' };  // 套 admin 視角推進(approval 通過 = 系統授權)
      await stagesService.advance(db, Number(chain.target_stage_id), user, { notes: `[approval chain #${chain.id}] approved` });
    } else if (chain.chain_kind === 'lifecycle_close') {
      const projectsService = require('./projectsService');
      const user = { id: decidedByUserId, role: 'admin' };
      await projectsService.updateLifecycle(db, Number(chain.project_id), 'CLOSED', user, {
        reason: `[approval chain #${chain.id}] approved`,
      });
    } else if (chain.chain_kind === 'confidential_upgrade') {
      await db.prepare(`UPDATE projects SET is_confidential = 1, updated_at = SYSTIMESTAMP WHERE id = ?`).run(chain.project_id);
      log.log(`project ${chain.project_id} confidential upgraded via chain ${chain.id}`);
    } else if (chain.chain_kind === 'high_amount') {
      // High amount 簽核通過 → 解鎖報價(可選擇進一步推進報價狀態)
      log.log(`high_amount approved · project=${chain.project_id} chain=${chain.id} payload=${JSON.stringify(payload)}`);
    }
  } catch (e) {
    log.warn(`apply target action failed: ${e.message}`);
  }
}

async function _notifyStep(db, chainId, stepOrder) {
  try {
    const notify = require('./notificationEngine');
    const chain = await db.prepare(`
      SELECT c.id, c.project_id, c.chain_kind, c.title,
             s.approver_user_id, s.approver_role
        FROM project_approval_chains c
        JOIN project_approval_steps s ON s.chain_id = c.id AND s.step_order = ?
       WHERE c.id = ?
    `).get(stepOrder, chainId);
    if (!chain) return;

    // 用 in_app_badge + email · 不接 STAGE_GATE rule(獨立)
    const userNotif = require('../../services/userNotificationService');
    const linkUrl = `/projects-platform/projects/${chain.project_id}`;

    if (chain.approver_user_id) {
      await userNotif.create(db, {
        userId: chain.approver_user_id,
        type: 'proj_approval_pending',
        title: `🔔 簽核待批 · ${chain.title}`,
        message: `chain #${chain.id} · step ${stepOrder}`,
        linkUrl,
        payload: { chain_id: chain.id, step_order: stepOrder, chain_kind: chain.chain_kind },
      });
    } else if (chain.approver_role) {
      // 找所有有 approver_role 的 user
      const roleUsers = await db.prepare(`
        SELECT DISTINCT g.user_id FROM user_role_grants g
          JOIN user_role_definitions d ON d.id = g.role_id
         WHERE d.role_code = ? AND g.is_active = 1
           AND (g.expires_at IS NULL OR g.expires_at > SYSTIMESTAMP)
      `).all(chain.approver_role).catch(() => []);
      for (const r of roleUsers) {
        await userNotif.create(db, {
          userId: Number(r.user_id),
          type: 'proj_approval_pending',
          title: `🔔 簽核待批 · ${chain.title}`,
          message: `chain #${chain.id} · step ${stepOrder} · role ${chain.approver_role}`,
          linkUrl,
          payload: { chain_id: chain.id, step_order: stepOrder, chain_kind: chain.chain_kind },
        });
      }
    }
  } catch (e) {
    log.warn(`notify step failed: ${e.message}`);
  }
}

async function _notifyResolved(db, chain, decision, decidedByUserId) {
  try {
    const userNotif = require('../../services/userNotificationService');
    await userNotif.create(db, {
      userId: Number(chain.requested_by_user_id),
      type: `proj_approval_${decision}`,
      title: `${decision === 'approved' ? '✅' : '❌'} 簽核 ${decision === 'approved' ? '已通過' : '被拒'}`,
      message: `chain #${chain.id}`,
      linkUrl: `/projects-platform/projects/${chain.project_id}`,
      payload: { chain_id: chain.id, decision, decided_by: decidedByUserId },
    });
  } catch (e) {
    log.warn(`notify resolved failed: ${e.message}`);
  }
}

function _formatPending(row) {
  let payload = {};
  try { payload = JSON.parse(row.data_payload || '{}'); } catch (_) {}
  return {
    chain_id: Number(row.chain_id),
    chain_kind: row.chain_kind,
    title: row.title,
    reason: row.reason,
    requested_by_user_id: row.requested_by_user_id,
    requester_name: row.requester_name,
    requester_username: row.requester_username,
    step_id: Number(row.step_id),
    step_order: Number(row.step_order),
    current_step_order: Number(row.current_step_order),
    total_steps: Number(row.total_steps),
    approver_role: row.approver_role,
    step_kind: row.step_kind,
    project_id: Number(row.project_id),
    project_code: row.project_code,
    project_title: payload.title || null,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

module.exports = {
  createChain,
  decide,
  cancel,
  listPendingForUser,
  listForProject,
};
