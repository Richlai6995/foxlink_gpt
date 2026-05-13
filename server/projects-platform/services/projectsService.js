/**
 * Projects Service — CRUD + lifecycle 狀態機 + auto-create channels & stages
 *
 * 對應 spec §10(Lifecycle 5-state)+ §13(Channels)+ §13.7(Stages)
 *
 * Sprint 1 最小版:
 *   - create(): 建 project + auto-create default channels(plugin metadata)+ auto-create stages(workflow_template)+ creator 自動加 PM membership
 *   - list():   依 user 身份過濾(admin 看全部、一般人看自己 PM/sales/member 的)
 *   - get():    含 channels / members / stages overview
 *   - updateLifecycle(): 5-state 狀態機驗證
 *
 * Lifecycle:
 *   DRAFT → ACTIVE → (PAUSED ↔ ACTIVE) → CLOSED → REOPENED(回 ACTIVE)
 */

const { makeLogger } = require('./logger');
const pluginRegistry = require('../plugins/registry');

const log = makeLogger('projectsService');

// ─── Lifecycle 狀態機(允許的轉移) ─────────────────────────────────
const LIFECYCLE_TRANSITIONS = {
  DRAFT:    ['ACTIVE'],
  ACTIVE:   ['PAUSED', 'CLOSED'],
  PAUSED:   ['ACTIVE', 'CLOSED'],
  CLOSED:   ['REOPENED'],
  REOPENED: ['ACTIVE'],
};

function canTransition(from, to) {
  return (LIFECYCLE_TRANSITIONS[from] || []).includes(to);
}

// ─── Helper:safe-parse JSON ─────────────────────────────────────────
function parseJsonSafe(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/**
 * 建立 project + auto-create channels & stages & PM membership
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.project_code  唯一識別
 * @param {string} input.type_code     QUOTE / GENERAL / ...
 * @param {string} input.title         顯示名稱(寫進 data_payload.title)
 * @param {number} input.bu_id         BU
 * @param {number} input.creator_id    建立者 user_id
 * @param {number} [input.pm_user_id]  PM(預設 = creator)
 * @param {number} [input.sales_user_id]
 * @param {object} [input.data_payload]
 * @param {string} [input.importance]  HIGH/NORMAL/LOW
 * @param {string} [input.urgency]
 */
async function create(db, input) {
  const {
    project_code,
    type_code,
    title,
    bu_id,
    creator_id,
    pm_user_id,
    sales_user_id,
    data_payload,
    importance = 'NORMAL',
    urgency = 'NORMAL',
  } = input;

  if (!project_code) throw new Error('project_code required');
  if (!type_code)    throw new Error('type_code required');
  if (!title)        throw new Error('title required');
  if (!bu_id)        throw new Error('bu_id required');
  if (!creator_id)   throw new Error('creator_id required');

  // 1. 驗證 type_code 對應的 plugin 存在
  const plugin = pluginRegistry.get(type_code);
  if (!plugin) throw new Error(`unknown project type: ${type_code}`);

  // 2. 拉 project_type_id
  const typeRow = await db.prepare(
    `SELECT id, default_workflow_template_id FROM project_types WHERE type_code = ?`,
  ).get(type_code);
  if (!typeRow) throw new Error(`project_type ${type_code} not seeded in DB`);

  const finalPmId = pm_user_id || creator_id;

  // 3. payload(title 寫進 payload,避免主表又加一欄)
  const payload = { title, ...(data_payload || {}) };

  // 3.5 機密旗標 — 從 payload 提取(Wizard Step 3 寫入)
  const isConfidential = (payload.isConfidential || payload.is_confidential) ? 1 : 0;
  const confidentialFieldsJson = Array.isArray(payload.confidentialFields)
    ? JSON.stringify(payload.confidentialFields)
    : null;

  // 4. INSERT projects
  const ins = await db.prepare(
    `INSERT INTO projects (
       project_code, project_type_id, workflow_template_id,
       data_payload,
       is_confidential, confidential_fields,
       sales_user_id, pm_user_id, bu_id,
       lifecycle_status, status,
       importance, urgency,
       created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'DRAFT', ?, ?, ?)`,
  ).run(
    project_code,
    Number(typeRow.id),
    typeRow.default_workflow_template_id ? Number(typeRow.default_workflow_template_id) : null,
    JSON.stringify(payload),
    isConfidential,
    confidentialFieldsJson,
    sales_user_id || null,
    finalPmId,
    bu_id,
    importance,
    urgency,
    creator_id,
  );

  const projectId = Number(ins.lastInsertRowid);
  if (!projectId) throw new Error('failed to get project id after insert');

  // 5. Auto-create PM membership(creator + pm if 不同人)
  await _addMember(db, projectId, finalPmId, 'PM', creator_id);
  if (sales_user_id && sales_user_id !== finalPmId) {
    await _addMember(db, projectId, sales_user_id, 'sales', creator_id);
  }
  if (creator_id !== finalPmId && creator_id !== sales_user_id) {
    await _addMember(db, projectId, creator_id, 'observer', creator_id);
  }

  // 6. Auto-create default channels(從 plugin metadata)
  await _createDefaultChannels(db, projectId, plugin, creator_id);

  // 7. Auto-create stages(從 default workflow template)
  if (typeRow.default_workflow_template_id) {
    await _createProjectStages(db, projectId, Number(typeRow.default_workflow_template_id));
  }

  log.log(`created project ${project_code} id=${projectId} type=${type_code}`);
  return projectId;
}

async function _addMember(db, projectId, userId, role, invitedBy) {
  try {
    await db.prepare(
      `INSERT INTO project_members
         (project_id, user_id, role, invited_by)
       VALUES (?, ?, ?, ?)`,
    ).run(projectId, userId, role, invitedBy);
  } catch (e) {
    if (!/UNIQUE constraint failed/.test(e.message)) {
      log.warn(`addMember p=${projectId} u=${userId}:`, e.message);
    }
  }
}

async function _createDefaultChannels(db, projectId, plugin, creatorId) {
  const channels = plugin.default_channels || [];
  for (const ch of channels) {
    try {
      const ins = await db.prepare(
        `INSERT INTO project_channels
           (project_id, name, channel_type, is_default, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(projectId, ch.name, ch.type, ch.is_default ? 1 : 0, creatorId);
      const channelId = Number(ins.lastInsertRowid);
      // creator 自動加入每個 channel(owner)
      await db.prepare(
        `INSERT INTO channel_participants (channel_id, user_id, role)
         VALUES (?, ?, 'owner')`,
      ).run(channelId, creatorId);
    } catch (e) {
      log.warn(`createChannel ${ch.name}:`, e.message);
    }
  }
}

async function _createProjectStages(db, projectId, templateId) {
  const stages = await db.prepare(
    `SELECT stage_code, stage_name_i18n, stage_order, sla_hours, required_role, gate_required
       FROM workflow_template_stages
      WHERE template_id = ?
      ORDER BY stage_order`,
  ).all(templateId);

  for (const s of stages) {
    try {
      await db.prepare(
        `INSERT INTO project_stages
           (project_id, stage_code, stage_name_i18n, stage_order,
            status, sla_hours, required_role, gate_required)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      ).run(
        projectId,
        s.stage_code,
        s.stage_name_i18n,
        Number(s.stage_order),
        s.sla_hours,
        s.required_role,
        Number(s.gate_required) ? 1 : 0,
      );
    } catch (e) {
      log.warn(`createStage ${s.stage_code}:`, e.message);
    }
  }
}

/**
 * 列出 user 可看的 project
 * - admin: 全部
 * - 一般人: pm_user_id / sales_user_id / 是 project_members
 */
async function list(db, user, { status, type_code, limit = 50, offset = 0 } = {}) {
  const isAdmin = user.role === 'admin';
  const params = [];
  const where = ['1=1'];

  if (!isAdmin) {
    where.push(`(
      p.pm_user_id = ?
      OR p.sales_user_id = ?
      OR EXISTS (SELECT 1 FROM project_members pm
                  WHERE pm.project_id = p.id AND pm.user_id = ?)
    )`);
    params.push(user.id, user.id, user.id);
  }

  if (status) {
    where.push(`p.lifecycle_status = ?`);
    params.push(status);
  }
  if (type_code) {
    where.push(`pt.type_code = ?`);
    params.push(type_code);
  }

  const rows = await db.prepare(
    `SELECT p.id, p.project_code, p.data_payload,
            pt.type_code, p.bu_id,
            p.pm_user_id, p.sales_user_id,
            p.lifecycle_status, p.status,
            p.importance, p.urgency, p.priority_score,
            p.current_stage_id, p.sla_due_at,
            p.created_at, p.updated_at
       FROM projects p
       JOIN project_types pt ON pt.id = p.project_type_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
  ).all(...params, offset, limit);

  return rows.map((r) => ({
    ...r,
    data_payload: parseJsonSafe(r.data_payload, {}),
  }));
}

/**
 * 取得單一 project 詳細 + channels + stages + members
 */
async function get(db, projectId, user) {
  const isAdmin = user.role === 'admin';

  const project = await db.prepare(
    `SELECT p.*, pt.type_code, pt.name_i18n AS type_name_i18n
       FROM projects p
       JOIN project_types pt ON pt.id = p.project_type_id
      WHERE p.id = ?`,
  ).get(projectId);

  if (!project) return null;

  // 權限:admin / pm / sales / member 才能看
  if (!isAdmin) {
    const hasAccess =
      Number(project.pm_user_id) === Number(user.id) ||
      Number(project.sales_user_id) === Number(user.id) ||
      !!(await db.prepare(
        `SELECT id FROM project_members WHERE project_id = ? AND user_id = ?`,
      ).get(projectId, user.id));

    if (!hasAccess) return { _forbidden: true };
  }

  const [channels, stages, members] = await Promise.all([
    db.prepare(
      `SELECT id, name, channel_type, is_default, is_archived
         FROM project_channels
        WHERE project_id = ?
        ORDER BY id`,
    ).all(projectId),
    db.prepare(
      `SELECT id, stage_code, stage_order, status, sla_hours, sla_due_at,
              entered_at, completed_at, gate_required, gate_confirmed_at
         FROM project_stages
        WHERE project_id = ?
        ORDER BY stage_order`,
    ).all(projectId),
    db.prepare(
      `SELECT pm.id, pm.user_id, pm.role, pm.sub_role,
              pm.invited_by, pm.invited_by_pm_user_id, pm.invited_at,
              u.username, u.name, u.email
         FROM project_members pm
         LEFT JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY pm.invited_at`,
    ).all(projectId),
  ]);

  return {
    ...project,
    data_payload:   parseJsonSafe(project.data_payload, {}),
    type_name_i18n: parseJsonSafe(project.type_name_i18n, {}),
    channels,
    stages,
    members,
  };
}

/**
 * Lifecycle 狀態轉移
 */
async function updateLifecycle(db, projectId, toStatus, user, { reason, pause_until } = {}) {
  const row = await db.prepare(
    `SELECT lifecycle_status, pm_user_id, created_by_user_id FROM projects WHERE id = ?`,
  ).get(projectId);
  if (!row) throw new Error('project not found');

  const isAdmin = user.role === 'admin';
  const isPm = Number(row.pm_user_id) === Number(user.id);
  const isCreator = Number(row.created_by_user_id) === Number(user.id);
  if (!isAdmin && !isPm && !isCreator) {
    throw new Error('forbidden: only PM/admin/creator can change lifecycle');
  }

  const from = row.lifecycle_status;
  if (!canTransition(from, toStatus)) {
    throw new Error(`invalid lifecycle transition: ${from} → ${toStatus}`);
  }

  const updates = [`lifecycle_status = ?`, `status = ?`, `updated_at = SYSTIMESTAMP`];
  const params = [toStatus, toStatus];

  if (toStatus === 'PAUSED') {
    updates.push(`pause_reason = ?`);
    params.push(reason || null);
    if (pause_until) {
      updates.push(`pause_until = ?`);
      params.push(new Date(pause_until));
    }
  } else if (toStatus === 'CLOSED') {
    updates.push(`closed_at = SYSTIMESTAMP`);
  } else if (toStatus === 'REOPENED') {
    updates.push(`reopen_reason = ?`, `closed_at = NULL`);
    params.push(reason || null);
  } else if (toStatus === 'ACTIVE' && from === 'PAUSED') {
    updates.push(`pause_reason = NULL`, `pause_until = NULL`);
  }

  params.push(projectId);
  await db.prepare(
    `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
  ).run(...params);

  // 結案 → fork 進沉澱 KB(spec §8)
  if (toStatus === 'CLOSED') {
    try {
      const kb = require('./kbPipeline');
      const r = await kb.forkToSediment(db, projectId);
      log.log(`CLOSED fork to sediment: ${JSON.stringify(r)}`);
    } catch (e) {
      log.warn(`fork to sediment failed: ${e.message}`);
    }
  }

  log.log(`project ${projectId} lifecycle ${from} → ${toStatus}`);
  return { from, to: toStatus };
}

module.exports = {
  create,
  list,
  get,
  updateLifecycle,
  canTransition,
  // internal — for testing
  _addMember,
  _createDefaultChannels,
  _createProjectStages,
};
