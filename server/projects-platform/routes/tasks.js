/**
 * /api/projects/projects/:projectId/tasks — Tasks CRUD
 *
 * Sprint C:
 *   GET    /:projectId/tasks                    list
 *   POST   /:projectId/tasks                    create(PM/admin)
 *   GET    /:projectId/tasks/:taskId            get
 *   PATCH  /:projectId/tasks/:taskId            update(owner / PM / admin)
 *   POST   /:projectId/tasks/:taskId/status     change status(shortcut)
 *   DELETE /:projectId/tasks/:taskId            delete(PM/admin)
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const { loadProject, requirePmOrAdmin } = require('../middleware/projectAclMiddleware');
const tasksService = require('../services/tasksService');

const router = express.Router({ mergeParams: true });

router.use(loadProject());

function getDb() {
  return require('../../database-oracle').db;
}

// ─── GET /:projectId/tasks ────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const tasks = await tasksService.list(getDb(), req.project.id, {
    status: req.query.status,
    stage_id: req.query.stage_id ? Number(req.query.stage_id) : undefined,
    parent_task_id:
      req.query.parent_task_id === 'null' ? null :
      req.query.parent_task_id ? Number(req.query.parent_task_id) :
      undefined,
  });
  res.json({ tasks, count: tasks.length });
}));

// ─── POST /:projectId/tasks ───────────────────────────────────────────
router.post('/', requirePmOrAdmin, asyncHandler(async (req, res) => {
  const {
    parent_task_id, stage_id, title, description, task_type,
    accountable_role, primary_owner_user_id, collaborator_user_ids,
    depends_on_task_id, relative_deadline_days, absolute_due_at,
    is_confidential, attachment_ids,
  } = req.body || {};

  try {
    const taskId = await tasksService.create(getDb(), {
      projectId: req.project.id,
      parentTaskId: parent_task_id,
      stageId: stage_id,
      title, description, taskType: task_type,
      accountableRole: accountable_role,
      primaryOwnerUserId: primary_owner_user_id,
      collaboratorUserIds: collaborator_user_ids,
      dependsOnTaskId: depends_on_task_id,
      relativeDeadlineDays: relative_deadline_days,
      absoluteDueAt: absolute_due_at,
      isConfidential: is_confidential,
      attachmentIds: attachment_ids,
      createdByUserId: req.user.id,
    });
    const task = await tasksService.get(getDb(), taskId);
    res.status(201).json({ task });
  } catch (e) {
    if (/required|invalid/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ─── GET /:projectId/tasks/:taskId ────────────────────────────────────
router.get('/:taskId', asyncHandler(async (req, res) => {
  const task = await tasksService.get(getDb(), Number(req.params.taskId));
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (Number(task.project_id) !== Number(req.project.id)) {
    return res.status(404).json({ error: 'task not in this project' });
  }
  res.json({ task });
}));

// ─── PATCH /:projectId/tasks/:taskId ──────────────────────────────────
router.patch('/:taskId', asyncHandler(async (req, res) => {
  const taskId = Number(req.params.taskId);
  const task = await tasksService.get(getDb(), taskId);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (Number(task.project_id) !== Number(req.project.id)) {
    return res.status(404).json({ error: 'task not in this project' });
  }

  // 權限:owner / PM / admin 可改;collaborator 可改 progress + status
  const acl = req.projectAcl;
  const isOwner = Number(task.primary_owner_user_id) === Number(req.user.id);
  const isCollab = (task.collaborator_user_ids || []).map(Number).includes(Number(req.user.id));
  const canEdit = acl.is_admin || acl.is_pm || isOwner || isCollab;
  if (!canEdit) return res.status(403).json({ error: 'no permission to edit this task' });

  try {
    await tasksService.update(getDb(), taskId, req.body || {});
    const updated = await tasksService.get(getDb(), taskId);
    res.json({ task: updated });
  } catch (e) {
    if (/invalid/.test(e.message)) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

// ─── POST /:projectId/tasks/:taskId/status ────────────────────────────
// Shortcut for status-only change(可以 owner 自己改自己的)
router.post('/:taskId/status', asyncHandler(async (req, res) => {
  const taskId = Number(req.params.taskId);
  const task = await tasksService.get(getDb(), taskId);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (Number(task.project_id) !== Number(req.project.id)) {
    return res.status(404).json({ error: 'task not in this project' });
  }

  const acl = req.projectAcl;
  const isOwner = Number(task.primary_owner_user_id) === Number(req.user.id);
  const isCollab = (task.collaborator_user_ids || []).map(Number).includes(Number(req.user.id));
  if (!acl.is_admin && !acl.is_pm && !isOwner && !isCollab) {
    return res.status(403).json({ error: 'no permission' });
  }

  try {
    await tasksService.update(getDb(), taskId, {
      status: req.body?.status,
      progress_percent: req.body?.progress_percent,
      blocker_reason: req.body?.blocker_reason,
    });
    const updated = await tasksService.get(getDb(), taskId);
    res.json({ task: updated });
  } catch (e) {
    if (/invalid/.test(e.message)) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

// ─── DELETE ───────────────────────────────────────────────────────────
router.delete('/:taskId', requirePmOrAdmin, asyncHandler(async (req, res) => {
  await tasksService.remove(getDb(), Number(req.params.taskId));
  res.json({ ok: true });
}));

module.exports = router;
