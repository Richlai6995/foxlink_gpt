/**
 * Stages Service — Stage Gate 推進邏輯
 *
 * 對應 spec §13.6 / §13.7 + Demo 手冊 §3(Stage Gate 業務確認制)
 *
 * Stage 狀態機:
 *   PENDING → ACTIVE → (gate_required ? READY_FOR_GATE : DONE) → DONE
 *   下一個 PENDING → ACTIVE
 *
 * advance() 規則:
 *   - 當前 stage 必須 ACTIVE 或 READY_FOR_GATE
 *   - gate_required=1 必須 PM/admin/sales(對齊 OIBG「業務 gate」)
 *   - 推進後寫 SYSTEM 訊息到 #announcement(讓 channel 看得到)
 */

const { makeLogger } = require('./logger');
const log = makeLogger('stagesService');

async function list(db, projectId) {
  return db.prepare(
    `SELECT id, project_id, stage_code, stage_order, status, sla_hours,
            required_role, gate_required, sla_due_at, entered_at, completed_at,
            gate_confirmed_by, gate_confirmed_at, gate_notes
       FROM project_stages
      WHERE project_id = ?
      ORDER BY stage_order`,
  ).all(projectId);
}

/**
 * 推進 stage(業務 gate 確認)
 *
 * @param {object} db
 * @param {number} stageId
 * @param {object} user
 * @param {string} [notes]
 */
async function advance(db, stageId, user, { notes } = {}) {
  const stage = await db.prepare(
    `SELECT s.id, s.project_id, s.stage_code, s.stage_order, s.status,
            s.gate_required, s.sla_hours,
            p.pm_user_id, p.sales_user_id, p.created_by_user_id
       FROM project_stages s
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?`,
  ).get(stageId);
  if (!stage) throw new Error('stage not found');

  if (stage.status === 'DONE' || stage.status === 'SKIPPED') {
    throw new Error(`stage ${stage.stage_code} already ${stage.status}`);
  }
  if (stage.status === 'PENDING') {
    throw new Error(`stage ${stage.stage_code} not active yet`);
  }

  // Gate 權限(只 PM / sales / admin 能 gate)
  const isAdmin = user.role === 'admin';
  const isPm = Number(stage.pm_user_id) === Number(user.id);
  const isSales = Number(stage.sales_user_id) === Number(user.id);
  const isCreator = Number(stage.created_by_user_id) === Number(user.id);
  if (Number(stage.gate_required) === 1 && !isAdmin && !isPm && !isSales && !isCreator) {
    throw new Error('only PM/sales/admin can advance a gated stage');
  }

  const isLast = await _isLastStage(db, stage.project_id, stage.stage_order);

  // 推進當前 stage → DONE
  await db.prepare(
    `UPDATE project_stages
        SET status = 'DONE',
            completed_at = SYSTIMESTAMP,
            gate_confirmed_by = ?,
            gate_confirmed_at = SYSTIMESTAMP,
            gate_notes = ?
      WHERE id = ?`,
  ).run(user.id, notes || null, stageId);

  // 啟動下一個 stage(PENDING → ACTIVE,算 SLA due)
  let nextStage = null;
  if (!isLast) {
    nextStage = await db.prepare(
      `SELECT id, stage_code, sla_hours FROM project_stages
        WHERE project_id = ? AND stage_order = ?`,
    ).get(stage.project_id, Number(stage.stage_order) + 1);
    if (nextStage) {
      const dueAt = nextStage.sla_hours
        ? new Date(Date.now() + Number(nextStage.sla_hours) * 3600000)
        : null;
      await db.prepare(
        `UPDATE project_stages
            SET status = 'ACTIVE',
                entered_at = SYSTIMESTAMP,
                sla_due_at = ?
          WHERE id = ?`,
      ).run(dueAt, Number(nextStage.id));
      // 同步 projects.current_stage_id
      await db.prepare(
        `UPDATE projects SET current_stage_id = ?, updated_at = SYSTIMESTAMP WHERE id = ?`,
      ).run(Number(nextStage.id), stage.project_id);
    }
  } else {
    // 最後 stage gate 通過 → 整個 project lifecycle CLOSED
    await db.prepare(
      `UPDATE projects SET lifecycle_status = 'CLOSED', status = 'CLOSED',
              closed_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP
        WHERE id = ?`,
    ).run(stage.project_id);
  }

  // 寫 SYSTEM 訊息到 announcement(讓所有人看到 stage 推進)
  await _postAnnouncement(db, stage.project_id, stage, nextStage, user, notes, isLast);

  // #9 Notification dispatch(fire-and-forget)
  try {
    const notify = require('./notificationEngine');
    notify.dispatch(db, 'STAGE_GATE', {
      project_id: stage.project_id,
      actor: user.id,
      title: isLast ? `✅ Stage ${stage.stage_code} 完成 · 專案結案` : `✅ Stage ${stage.stage_code} → ${nextStage?.stage_code}`,
      body: notes || (isLast ? '所有 stage 完成,專案進入 CLOSED 狀態' : `業務確認進入 ${nextStage?.stage_code}`),
      link_url: `/projects-platform/projects/${stage.project_id}`,
    }).catch((e) => log.warn(`STAGE_GATE notify async failed: ${e.message}`));
  } catch (e) {
    log.warn(`notify STAGE_GATE failed: ${e.message}`);
  }

  // WebSocket broadcast — stage 切換時讓 WarRoom ribbon 即時 refresh
  try {
    const sock = require('../../services/socketService');
    sock.emitProjectStageAdvanced(stage.project_id, {
      from_stage_code: stage.stage_code,
      from_stage_order: stage.stage_order,
      to_stage_code: nextStage?.stage_code || null,
      to_stage_id: nextStage?.id || null,
      project_closed: isLast,
      actor_user_id: user.id,
    });
    if (isLast) {
      sock.emitProjectLifecycleChanged(stage.project_id, { to: 'CLOSED', from: 'ACTIVE', actor_user_id: user.id });
    }
  } catch (e) {
    log.warn(`socket emit stage advance failed: ${e.message}`);
  }

  log.log(
    `stage ${stage.stage_code} → DONE by user ${user.id} · next=${nextStage?.stage_code || 'CLOSED'}`,
  );

  return {
    advanced_from: stage.stage_code,
    advanced_to: nextStage ? nextStage.stage_code : null,
    project_closed: isLast,
  };
}

async function _isLastStage(db, projectId, currentOrder) {
  const r = await db.prepare(
    `SELECT MAX(stage_order) AS max_order FROM project_stages WHERE project_id = ?`,
  ).get(projectId);
  return Number(r?.max_order) === Number(currentOrder);
}

async function _postAnnouncement(db, projectId, stage, nextStage, user, notes, isLast) {
  const ann = await db.prepare(
    `SELECT id FROM project_channels
      WHERE project_id = ? AND channel_type = 'announcement' AND is_archived = 0`,
  ).get(projectId);
  if (!ann) return;

  const content = isLast
    ? `✅ Stage ${stage.stage_order} ${stage.stage_code} 完成 · 專案結案\n\n${notes ? `備註:${notes}` : ''}`
    : `✅ Stage ${stage.stage_order} ${stage.stage_code} → ${nextStage?.stage_code}\n\n業務 (user#${user.id}) 已確認進入下一 stage${notes ? ` · ${notes}` : ''}`;

  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 64);

  try {
    await db.prepare(
      `INSERT INTO project_messages
         (channel_id, project_id, user_id, content, message_type, content_hash)
       VALUES (?, ?, ?, ?, 'SYSTEM', ?)`,
    ).run(Number(ann.id), projectId, user.id, content, hash);
  } catch (e) {
    log.warn(`announcement post failed: ${e.message}`);
  }
}

/**
 * 標記當前 stage 為 READY_FOR_GATE(由 task DONE 觸發,Sprint 後續做 hook)
 */
async function markReadyForGate(db, stageId) {
  await db.prepare(
    `UPDATE project_stages SET status = 'READY_FOR_GATE' WHERE id = ? AND status = 'ACTIVE'`,
  ).run(stageId);
}

module.exports = {
  list,
  advance,
  markReadyForGate,
};
