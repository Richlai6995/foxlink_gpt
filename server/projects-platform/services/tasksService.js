/**
 * Tasks Service — project_tasks CRUD + dependency-based deadline 計算
 *
 * 對應 spec §14 + Demo 手冊 §6
 *
 * RACI:
 *   accountable_role     A · 背鍋的 role(DPM / BPM / MPM / sales / ...)
 *   primary_owner_user_id R · 實作的人
 *   collaborator_user_ids JSON array · 額外協辦人
 *
 * Dependency:
 *   depends_on_task_id      上游 task id
 *   relative_deadline_days  上游完成後 +N 天
 *   absolute_due_at         手動絕對截止
 *   computed_due_at         系統算出來的(API 寫入)
 *
 * Sprint C 範圍:
 *   - 基本 CRUD(list / get / create / update / patch status)
 *   - 計算 computed_due_at(依 dependency 或 absolute)
 *   - 不做 EPIC / SUBTASK 巢狀 — Sprint 後續
 */

const { makeLogger } = require('./logger');
const log = makeLogger('tasksService');

const ALLOWED_STATUS = ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_REVIEW', 'DONE', 'CANCELLED'];

function parseJsonSafe(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/**
 * List tasks of a project
 */
async function list(db, projectId, { status, stage_id, parent_task_id } = {}) {
  const params = [projectId];
  const wh = ['project_id = ?'];
  if (status) { wh.push('status = ?'); params.push(status); }
  if (stage_id) { wh.push('stage_id = ?'); params.push(stage_id); }
  if (parent_task_id !== undefined) {
    if (parent_task_id === null) wh.push('parent_task_id IS NULL');
    else { wh.push('parent_task_id = ?'); params.push(parent_task_id); }
  }

  const rows = await db.prepare(
    `SELECT id, project_id, parent_task_id, stage_id,
            title, description, task_type,
            accountable_role, primary_owner_user_id, collaborator_user_ids,
            status, progress_percent,
            depends_on_task_id, relative_deadline_days, absolute_due_at, computed_due_at,
            started_at, completed_at, cancelled_at, blocker_reason,
            is_confidential, attachment_ids,
            created_by_user_id, created_at, updated_at
       FROM project_tasks
      WHERE ${wh.join(' AND ')}
      ORDER BY stage_id NULLS LAST, id`,
  ).all(...params);

  return rows.map((r) => ({
    ...r,
    collaborator_user_ids: parseJsonSafe(r.collaborator_user_ids, []),
    attachment_ids: parseJsonSafe(r.attachment_ids, []),
  }));
}

async function get(db, taskId) {
  const r = await db.prepare(
    `SELECT * FROM project_tasks WHERE id = ?`,
  ).get(taskId);
  if (!r) return null;
  return {
    ...r,
    collaborator_user_ids: parseJsonSafe(r.collaborator_user_ids, []),
    attachment_ids: parseJsonSafe(r.attachment_ids, []),
  };
}

/**
 * Create task
 */
async function create(db, input) {
  const {
    projectId, parentTaskId, stageId, title, description, taskType = 'TASK',
    accountableRole, primaryOwnerUserId, collaboratorUserIds,
    dependsOnTaskId, relativeDeadlineDays, absoluteDueAt,
    isConfidential = false, attachmentIds, createdByUserId,
  } = input;

  if (!projectId) throw new Error('projectId required');
  if (!title)     throw new Error('title required');
  if (!createdByUserId) throw new Error('createdByUserId required');

  const ins = await db.prepare(
    `INSERT INTO project_tasks
       (project_id, parent_task_id, stage_id, title, description, task_type,
        accountable_role, primary_owner_user_id, collaborator_user_ids,
        status, progress_percent,
        depends_on_task_id, relative_deadline_days, absolute_due_at,
        is_confidential, attachment_ids,
        created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    projectId,
    parentTaskId || null,
    stageId || null,
    title,
    description || null,
    taskType,
    accountableRole || null,
    primaryOwnerUserId || null,
    collaboratorUserIds ? JSON.stringify(collaboratorUserIds) : null,
    dependsOnTaskId || null,
    relativeDeadlineDays || null,
    absoluteDueAt ? new Date(absoluteDueAt) : null,
    isConfidential ? 1 : 0,
    attachmentIds ? JSON.stringify(attachmentIds) : null,
    createdByUserId,
  );

  const taskId = Number(ins.lastInsertRowid);

  // 算 computed_due_at:
  //   - 有 absolute → 直接寫
  //   - 有 dependency + relative_days → 等上游 DONE 再算(暫存 null)
  if (absoluteDueAt) {
    await db.prepare(`UPDATE project_tasks SET computed_due_at = ? WHERE id = ?`).run(new Date(absoluteDueAt), taskId);
  } else if (dependsOnTaskId && relativeDeadlineDays) {
    await _recomputeDueAt(db, taskId);
  }

  log.log(`created task ${taskId} in project ${projectId}`);
  return taskId;
}

/**
 * Update task status / progress / fields
 */
async function update(db, taskId, patch) {
  const updates = [];
  const params = [];

  const f = (col, val, transform) => {
    if (val === undefined) return;
    updates.push(`${col} = ?`);
    params.push(transform ? transform(val) : val);
  };

  f('title',                 patch.title);
  f('description',           patch.description);
  f('task_type',             patch.task_type);
  f('accountable_role',      patch.accountable_role);
  f('primary_owner_user_id', patch.primary_owner_user_id);
  f('collaborator_user_ids', patch.collaborator_user_ids, (v) => JSON.stringify(v));
  if (patch.status !== undefined) {
    if (!ALLOWED_STATUS.includes(patch.status)) throw new Error(`invalid status: ${patch.status}`);
    f('status', patch.status);
    if (patch.status === 'IN_PROGRESS') f('started_at', 'SYSTIMESTAMP');
    else if (patch.status === 'DONE') f('completed_at', 'SYSTIMESTAMP');
    else if (patch.status === 'CANCELLED') f('cancelled_at', 'SYSTIMESTAMP');
  }
  if (patch.progress_percent !== undefined) {
    const p = Math.max(0, Math.min(100, Number(patch.progress_percent)));
    f('progress_percent', p);
  }
  f('depends_on_task_id',      patch.depends_on_task_id);
  f('relative_deadline_days',  patch.relative_deadline_days);
  f('absolute_due_at',         patch.absolute_due_at, (v) => new Date(v));
  f('blocker_reason',          patch.blocker_reason);
  f('is_confidential',         patch.is_confidential, (v) => (v ? 1 : 0));

  if (updates.length === 0) return false;
  updates.push('updated_at = SYSTIMESTAMP');

  params.push(taskId);
  await db.prepare(
    `UPDATE project_tasks SET ${updates.join(', ')} WHERE id = ?`,
  ).run(...params);

  // 若 status 到 DONE,觸發下游 dependency 算 due_at
  if (patch.status === 'DONE') {
    await _recomputeDownstream(db, taskId);
  }

  log.log(`task ${taskId} updated`);
  return true;
}

/**
 * 算單一 task 的 computed_due_at(依 dependency 鏈)
 * 規則:
 *   - 若有 absolute_due_at → 用它
 *   - 否則 depends_on_task_id 完成時間 + relative_deadline_days
 *   - 上游沒完成 → null
 */
async function _recomputeDueAt(db, taskId) {
  const t = await db.prepare(
    `SELECT depends_on_task_id, relative_deadline_days, absolute_due_at FROM project_tasks WHERE id = ?`,
  ).get(taskId);
  if (!t) return;

  if (t.absolute_due_at) {
    await db.prepare(`UPDATE project_tasks SET computed_due_at = ? WHERE id = ?`).run(t.absolute_due_at, taskId);
    return;
  }
  if (t.depends_on_task_id && t.relative_deadline_days) {
    const upstream = await db.prepare(
      `SELECT completed_at FROM project_tasks WHERE id = ?`,
    ).get(Number(t.depends_on_task_id));
    if (upstream && upstream.completed_at) {
      const due = new Date(upstream.completed_at);
      due.setDate(due.getDate() + Number(t.relative_deadline_days));
      await db.prepare(`UPDATE project_tasks SET computed_due_at = ? WHERE id = ?`).run(due, taskId);
    } else {
      await db.prepare(`UPDATE project_tasks SET computed_due_at = NULL WHERE id = ?`).run(taskId);
    }
  }
}

/**
 * 上游完成 → 找所有 depends_on_task_id 指向自己的下游,重算 due
 */
async function _recomputeDownstream(db, parentTaskId) {
  const downstream = await db.prepare(
    `SELECT id FROM project_tasks WHERE depends_on_task_id = ?`,
  ).all(parentTaskId);
  for (const t of downstream) {
    await _recomputeDueAt(db, Number(t.id));
  }
}

async function remove(db, taskId) {
  await db.prepare(`DELETE FROM project_tasks WHERE id = ?`).run(taskId);
}

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  ALLOWED_STATUS,
};
