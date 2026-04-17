/**
 * Feedback Service — 工單 CRUD + 單號產生 + 狀態機
 */

// ─── 單號產生 ─────────────────────────────────────────────────────────────────

function _pad2(n) { return String(n).padStart(2, '0'); }

async function generateTicketNo(db) {
  const now = new Date();
  const base = 'FB-' +
    now.getFullYear() +
    _pad2(now.getMonth() + 1) +
    _pad2(now.getDate()) +
    _pad2(now.getHours()) +
    _pad2(now.getMinutes());

  // Retry loop 防止並發碰撞
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM feedback_tickets WHERE ticket_no LIKE ?`
    ).get(base + '%');
    const cnt = Number(row?.cnt ?? row?.CNT ?? 0);
    const candidate = cnt === 0 ? base : `${base}-${cnt + 1}`;

    // 確認不重複
    const exists = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM feedback_tickets WHERE ticket_no = ?'
    ).get(candidate);
    if (Number(exists?.cnt ?? exists?.CNT ?? 0) === 0) return candidate;
  }
  // fallback: 加 timestamp ms
  return `${base}-${Date.now() % 100000}`;
}

// ─── SLA 計算 ─────────────────────────────────────────────────────────────────

async function calcSlaDue(db, priority) {
  const sla = await db.prepare(
    'SELECT first_response_hours, resolution_hours FROM feedback_sla_configs WHERE priority = ?'
  ).get(priority || 'medium');
  if (!sla) return { sla_due_first_response: null, sla_due_resolution: null };

  const firstHours = Number(sla.first_response_hours ?? sla.FIRST_RESPONSE_HOURS);
  const resolveHours = Number(sla.resolution_hours ?? sla.RESOLUTION_HOURS);
  const now = new Date();

  return {
    sla_due_first_response: new Date(now.getTime() + firstHours * 3600000),
    sla_due_resolution: new Date(now.getTime() + resolveHours * 3600000),
  };
}

// ─── 建立工單 ─────────────────────────────────────────────────────────────────

async function createTicket(db, { user, subject, description, share_link, category_id, priority, tags, source, source_session_id, isDraft }) {
  const ticket_no = await generateTicketNo(db);
  const p = priority || 'medium';
  const status = isDraft ? 'draft' : 'open';

  // 草稿不算 SLA，送出時才開始計
  const sla = isDraft ? { sla_due_first_response: null, sla_due_resolution: null } : await calcSlaDue(db, p);

  await db.prepare(`
    INSERT INTO feedback_tickets
      (ticket_no, user_id, applicant_name, applicant_dept, applicant_employee_id, applicant_email,
       subject, description, share_link, category_id, priority, tags, status,
       sla_due_first_response, sla_due_resolution, source, source_session_id)
    VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?)
  `).run(
    ticket_no,
    user.id,
    user.name || user.username,
    user.dept_code || user.profit_center || null,
    user.employee_id || null,
    user.email || null,
    subject,
    description || null,
    share_link || null,
    category_id || null,
    p,
    tags ? JSON.stringify(tags) : null,
    status,
    sla.sla_due_first_response,
    sla.sla_due_resolution,
    source || 'web',
    source_session_id || null
  );

  return getTicketByNo(db, ticket_no);
}

/** 草稿送出 → open，開始計 SLA，觸發通知 */
async function submitTicket(db, id) {
  const ticket = await getTicketById(db, id);
  if (!ticket) throw new Error('工單不存在');
  if (ticket.status !== 'draft') throw new Error('只有草稿可以送出');

  const sla = await calcSlaDue(db, ticket.priority);
  await db.prepare(`
    UPDATE feedback_tickets
    SET status = 'open', sla_due_first_response = ?, sla_due_resolution = ?, updated_at = SYSTIMESTAMP
    WHERE id = ?
  `).run(sla.sla_due_first_response, sla.sla_due_resolution, id);

  return getTicketById(db, id);
}

// ─── 查詢工單 ─────────────────────────────────────────────────────────────────

async function getTicketByNo(db, ticket_no) {
  return db.prepare(`
    SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.is_erp AS category_is_erp,
           u.username AS assigned_username, u.name AS assigned_name
    FROM feedback_tickets t
    LEFT JOIN feedback_categories c ON c.id = t.category_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.ticket_no = ?
  `).get(ticket_no);
}

async function getTicketById(db, id) {
  return db.prepare(`
    SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.is_erp AS category_is_erp,
           u.username AS assigned_username, u.name AS assigned_name
    FROM feedback_tickets t
    LEFT JOIN feedback_categories c ON c.id = t.category_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.id = ?
  `).get(id);
}

async function listTickets(db, { userId, isAdmin, isAdminUser, isErpAdmin, status, priority, category_id, search, assigned_to, date_from, date_to, sort, order, page, limit }) {
  const conditions = [];
  const binds = [];

  // 是否可以看 internal note：預設以 isAdminUser 判斷；若未提供則 fallback 回 isAdmin
  const canSeeInternal = typeof isAdminUser === 'boolean' ? isAdminUser : !!isAdmin;

  if (!isAdmin) {
    if (isErpAdmin) {
      // ERP 管理員（非系統 admin）：可以看自己的工單 + 所有 ERP 分類工單
      conditions.push('(t.user_id = ? OR c.is_erp = 1)');
      binds.push(userId);
    } else {
      conditions.push('t.user_id = ?');
      binds.push(userId);
    }
  }
  if (status) {
    const statuses = status.split(',').map(s => s.trim());
    conditions.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
    binds.push(...statuses);
  }
  if (priority) {
    const priorities = priority.split(',').map(s => s.trim());
    conditions.push(`t.priority IN (${priorities.map(() => '?').join(',')})`);
    binds.push(...priorities);
  }
  if (category_id) {
    conditions.push('t.category_id = ?');
    binds.push(Number(category_id));
  }
  if (assigned_to) {
    conditions.push('t.assigned_to = ?');
    binds.push(Number(assigned_to));
  }
  if (search) {
    conditions.push('(UPPER(t.subject) LIKE UPPER(?) OR UPPER(t.ticket_no) LIKE UPPER(?))');
    binds.push(`%${search}%`, `%${search}%`);
  }
  if (date_from) {
    conditions.push(`t.created_at >= TO_TIMESTAMP(?, 'YYYY-MM-DD')`);
    binds.push(date_from);
  }
  if (date_to) {
    conditions.push(`t.created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD') + 1`);
    binds.push(date_to);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const sortCol = ['created_at', 'updated_at', 'priority', 'status'].includes(sort) ? sort : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const pg = Math.max(1, Number(page) || 1);
  const lim = Math.min(100, Math.max(1, Number(limit) || 20));
  const offset = (pg - 1) * lim;

  const countRow = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM feedback_tickets t LEFT JOIN feedback_categories c ON c.id = t.category_id ${where}`
  ).get(...binds);
  const total = Number(countRow?.cnt ?? countRow?.CNT ?? 0);

  // 最新一則非系統訊息（一般使用者過濾 internal note）
  const internalFilter = canSeeInternal ? '' : 'AND is_internal = 0';

  const rows = await db.prepare(`
    SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.is_erp AS category_is_erp,
           u.username AS assigned_username, u.name AS assigned_name,
           DBMS_LOB.SUBSTR(lm.content, 500, 1) AS last_message_content,
           lm.sender_role AS last_message_role,
           lm.is_internal AS last_message_is_internal,
           lm.created_at  AS last_message_at,
           lu.name        AS last_message_sender_name,
           lu.username    AS last_message_sender_username
    FROM feedback_tickets t
    LEFT JOIN feedback_categories c ON c.id = t.category_id
    LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN (
      SELECT ticket_id, content, sender_role, sender_id, is_internal, created_at,
             ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY created_at DESC, id DESC) AS rn
      FROM feedback_messages
      WHERE is_system = 0 ${internalFilter}
    ) lm ON lm.ticket_id = t.id AND lm.rn = 1
    LEFT JOIN users lu ON lu.id = lm.sender_id
    ${where}
    ORDER BY t.${sortCol} ${sortOrder}
    OFFSET ${offset} ROWS FETCH NEXT ${lim} ROWS ONLY
  `).all(...binds);

  return { tickets: rows, total, page: pg, limit: lim };
}

// ─── 更新工單 ─────────────────────────────────────────────────────────────────

async function updateTicket(db, id, fields) {
  const allowed = ['subject', 'description', 'share_link', 'category_id', 'priority', 'tags'];
  const sets = [];
  const binds = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      binds.push(key === 'tags' ? JSON.stringify(fields[key]) : fields[key]);
    }
  }
  if (sets.length === 0) return null;

  sets.push('updated_at = SYSTIMESTAMP');
  binds.push(id);

  await db.prepare(
    `UPDATE feedback_tickets SET ${sets.join(', ')} WHERE id = ?`
  ).run(...binds);

  // 如果 priority 變了，重算 SLA
  if (fields.priority) {
    const sla = await calcSlaDue(db, fields.priority);
    await db.prepare(
      `UPDATE feedback_tickets SET sla_due_first_response = ?, sla_due_resolution = ? WHERE id = ?`
    ).run(sla.sla_due_first_response, sla.sla_due_resolution, id);
  }

  return getTicketById(db, id);
}

// ─── 狀態機 ───────────────────────────────────────────────────────────────────

const STATUS_TRANSITIONS = {
  draft:        ['open'],
  open:         ['processing', 'resolved'],
  processing:   ['pending_user', 'resolved'],
  pending_user: ['processing', 'resolved'],
  resolved:     ['closed', 'reopened'],
  reopened:     ['processing', 'resolved'],
  closed:       [],
};

async function changeStatus(db, id, newStatus, userId, note) {
  const ticket = await getTicketById(db, id);
  if (!ticket) throw new Error('工單不存在');

  const currentStatus = ticket.status;
  const allowed = STATUS_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`無法從 ${currentStatus} 轉換到 ${newStatus}`);
  }

  const updates = ['status = ?', 'updated_at = SYSTIMESTAMP'];
  const binds = [newStatus];

  if (newStatus === 'processing' && !ticket.first_response_at) {
    updates.push('first_response_at = SYSTIMESTAMP');
  }
  if (newStatus === 'resolved') {
    updates.push('resolved_at = SYSTIMESTAMP');
    updates.push('resolved_by = ?');
    binds.push(userId);
    // 結案者自動成為處理者（如果尚未指派）
    if (!ticket.assigned_to) {
      updates.push('assigned_to = ?');
      binds.push(userId);
    }
    if (note) {
      updates.push('resolution_note = ?');
      binds.push(note);
    }
  }
  if (newStatus === 'closed') {
    updates.push('closed_at = SYSTIMESTAMP');
  }
  if (newStatus === 'reopened') {
    updates.push('reopened_at = SYSTIMESTAMP');
    updates.push('resolved_at = NULL');
    updates.push('resolved_by = NULL');
    updates.push('closed_at = NULL');
  }

  binds.push(id);
  await db.prepare(`UPDATE feedback_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...binds);

  // 寫入系統訊息
  await addSystemMessage(db, id, userId, `狀態變更: ${currentStatus} → ${newStatus}${note ? ' — ' + note : ''}`);

  return getTicketById(db, id);
}

async function assignTicket(db, id, adminId) {
  const ticket = await getTicketById(db, id);
  if (!ticket) throw new Error('工單不存在');

  // 合併為單一 UPDATE（原子性）
  if (ticket.status === 'open') {
    await db.prepare(
      `UPDATE feedback_tickets SET assigned_to = ?, status = 'processing', first_response_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP WHERE id = ?`
    ).run(adminId, id);
  } else {
    await db.prepare(
      'UPDATE feedback_tickets SET assigned_to = ?, updated_at = SYSTIMESTAMP WHERE id = ?'
    ).run(adminId, id);
  }

  return getTicketById(db, id);
}

async function submitSatisfaction(db, id, rating, comment) {
  await db.prepare(
    'UPDATE feedback_tickets SET satisfaction_rating = ?, satisfaction_comment = ?, updated_at = SYSTIMESTAMP WHERE id = ?'
  ).run(rating, comment || null, id);
  return getTicketById(db, id);
}

// ─── 對話訊息 ─────────────────────────────────────────────────────────────────

async function addMessage(db, { ticket_id, sender_id, sender_role, content, is_internal }) {
  await db.prepare(`
    INSERT INTO feedback_messages (ticket_id, sender_id, sender_role, content, is_internal)
    VALUES (?, ?, ?, ?, ?)
  `).run(ticket_id, sender_id, sender_role, content, is_internal ? 1 : 0);

  // CLOB 欄位可能導致 lastInsertRowid 為 null，改用 MAX(id) 取回
  const lastRow = await db.prepare(
    'SELECT MAX(id) AS last_id FROM feedback_messages WHERE ticket_id = ? AND sender_id = ?'
  ).get(ticket_id, sender_id);
  const msgId = lastRow?.last_id ?? lastRow?.LAST_ID;

  // 自動狀態轉換
  const ticket = await getTicketById(db, ticket_id);
  if (ticket) {
    // 管理員首次回覆 → 自動成為處理者
    if (sender_role === 'admin' && !is_internal && !ticket.assigned_to) {
      await db.prepare('UPDATE feedback_tickets SET assigned_to = ? WHERE id = ?').run(sender_id, ticket_id);
    }
    if (sender_role === 'admin' && ticket.status === 'open' && !is_internal) {
      await db.prepare(
        `UPDATE feedback_tickets SET status = 'processing', first_response_at = COALESCE(first_response_at, SYSTIMESTAMP), updated_at = SYSTIMESTAMP WHERE id = ?`
      ).run(ticket_id);
    } else if (sender_role === 'applicant' && ticket.status === 'pending_user') {
      await db.prepare(
        `UPDATE feedback_tickets SET status = 'processing', updated_at = SYSTIMESTAMP WHERE id = ?`
      ).run(ticket_id);
    }
    // 非內部備註且以上未更新 updated_at 時才更新
    if (!is_internal && !(sender_role === 'admin' && ticket.status === 'open') && !(sender_role === 'applicant' && ticket.status === 'pending_user')) {
      await db.prepare('UPDATE feedback_tickets SET updated_at = SYSTIMESTAMP WHERE id = ?').run(ticket_id);
    }
  }

  return msgId ? await db.prepare('SELECT * FROM feedback_messages WHERE id = ?').get(msgId) : { id: null, ticket_id, sender_id, sender_role, content, is_internal: is_internal ? 1 : 0 };
}

/** 刪除管理員自己的訊息（含相關附件） */
async function deleteMessage(db, messageId, userId, isAdmin) {
  const msg = await db.prepare('SELECT * FROM feedback_messages WHERE id = ?').get(messageId);
  if (!msg) throw new Error('訊息不存在');
  if (!isAdmin) throw new Error('只有管理員可以刪除訊息');
  if (msg.sender_id !== userId) throw new Error('只能刪除自己的訊息');
  if (msg.sender_role !== 'admin') throw new Error('只能刪除管理員訊息');
  if (msg.is_system) throw new Error('系統訊息無法刪除');

  // 取得相關附件以便刪檔
  const atts = await db.prepare('SELECT id, file_path FROM feedback_attachments WHERE message_id = ?').all(messageId);

  // 刪除附件記錄（檔案實體稍後由 route 層處理）
  await db.prepare('DELETE FROM feedback_attachments WHERE message_id = ?').run(messageId);

  // 刪除訊息
  await db.prepare('DELETE FROM feedback_messages WHERE id = ?').run(messageId);

  return { ticket_id: msg.ticket_id, attachments: atts };
}

async function addSystemMessage(db, ticket_id, sender_id, content) {
  await db.prepare(`
    INSERT INTO feedback_messages (ticket_id, sender_id, sender_role, content, is_system)
    VALUES (?, ?, 'system', ?, 1)
  `).run(ticket_id, sender_id, content);
}

async function listMessages(db, ticket_id, isAdmin) {
  const internalFilter = isAdmin ? '' : 'AND m.is_internal = 0';
  return db.prepare(`
    SELECT m.*, u.name AS sender_name, u.username AS sender_username
    FROM feedback_messages m
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.ticket_id = ? ${internalFilter}
    ORDER BY m.created_at ASC
  `).all(ticket_id);
}

// ─── 附件 ─────────────────────────────────────────────────────────────────────

async function addAttachment(db, { ticket_id, message_id, file_name, file_path, file_size, mime_type, uploaded_by }) {
  const result = await db.prepare(`
    INSERT INTO feedback_attachments (ticket_id, message_id, file_name, file_path, file_size, mime_type, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ticket_id, message_id || null, file_name, file_path, file_size || 0, mime_type || null, uploaded_by);
  return db.prepare('SELECT * FROM feedback_attachments WHERE id = ?').get(result.lastInsertRowid);
}

async function listAttachments(db, ticket_id, isAdmin) {
  if (isAdmin) {
    return db.prepare(
      'SELECT * FROM feedback_attachments WHERE ticket_id = ? ORDER BY created_at ASC'
    ).all(ticket_id);
  }
  // 非 admin：過濾掉掛在 internal message 上的附件
  return db.prepare(`
    SELECT a.* FROM feedback_attachments a
    LEFT JOIN feedback_messages m ON m.id = a.message_id
    WHERE a.ticket_id = ?
      AND (a.message_id IS NULL OR m.is_internal = 0 OR m.is_internal IS NULL)
    ORDER BY a.created_at ASC
  `).all(ticket_id);
}

async function deleteAttachment(db, id, userId, isAdmin) {
  const att = await db.prepare('SELECT * FROM feedback_attachments WHERE id = ?').get(id);
  if (!att) throw new Error('附件不存在');
  if (!isAdmin && att.uploaded_by !== userId) throw new Error('無刪除權限');
  await db.prepare('DELETE FROM feedback_attachments WHERE id = ?').run(id);
  return att;
}

// ─── 分類管理 ─────────────────────────────────────────────────────────────────

async function listCategories(db, lang) {
  const rows = await db.prepare(`
    SELECT c.*,
           ct.name AS trans_name, ct.description AS trans_description
    FROM feedback_categories c
    LEFT JOIN feedback_category_translations ct ON ct.category_id = c.id AND ct.lang = ?
    WHERE c.is_active = 1
    ORDER BY c.sort_order ASC, c.id ASC
  `).all(lang || 'zh-TW');

  return rows.map(r => ({
    ...r,
    name: r.trans_name || r.name,
    description: r.trans_description || r.description,
  }));
}

async function listAllCategories(db) {
  return db.prepare('SELECT * FROM feedback_categories ORDER BY sort_order ASC, id ASC').all();
}

async function createCategory(db, { name, description, icon, sort_order, is_erp }) {
  const result = await db.prepare(
    'INSERT INTO feedback_categories (name, description, icon, sort_order, is_erp) VALUES (?, ?, ?, ?, ?)'
  ).run(name, description || null, icon || null, sort_order || 0, is_erp ? 1 : 0);
  return db.prepare('SELECT * FROM feedback_categories WHERE id = ?').get(result.lastInsertRowid);
}

async function updateCategory(db, id, { name, description, icon, sort_order, is_active, is_erp }) {
  const sets = [];
  const binds = [];
  if (name !== undefined) { sets.push('name = ?'); binds.push(name); }
  if (description !== undefined) { sets.push('description = ?'); binds.push(description); }
  if (icon !== undefined) { sets.push('icon = ?'); binds.push(icon); }
  if (sort_order !== undefined) { sets.push('sort_order = ?'); binds.push(sort_order); }
  if (is_active !== undefined) { sets.push('is_active = ?'); binds.push(is_active ? 1 : 0); }
  if (is_erp !== undefined) { sets.push('is_erp = ?'); binds.push(is_erp ? 1 : 0); }
  if (sets.length === 0) return null;
  sets.push('updated_at = SYSTIMESTAMP');
  binds.push(id);
  await db.prepare(`UPDATE feedback_categories SET ${sets.join(', ')} WHERE id = ?`).run(...binds);
  return db.prepare('SELECT * FROM feedback_categories WHERE id = ?').get(id);
}

async function deleteCategory(db, id) {
  await db.prepare('DELETE FROM feedback_categories WHERE id = ?').run(id);
}

/** 批次更新分類順序：ids 為從上到下的完整順序 */
async function reorderCategories(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  for (let i = 0; i < ids.length; i++) {
    await db.prepare(
      'UPDATE feedback_categories SET sort_order = ?, updated_at = SYSTIMESTAMP WHERE id = ?'
    ).run(i + 1, Number(ids[i]));
  }
}

// ─── SLA 管理 ─────────────────────────────────────────────────────────────────

async function listSlaConfigs(db) {
  return db.prepare('SELECT * FROM feedback_sla_configs ORDER BY first_response_hours ASC').all();
}

async function updateSlaConfig(db, priority, { first_response_hours, resolution_hours, escalation_enabled, escalation_to }) {
  await db.prepare(`
    UPDATE feedback_sla_configs
    SET first_response_hours = ?, resolution_hours = ?, escalation_enabled = ?, escalation_to = ?, updated_at = SYSTIMESTAMP
    WHERE priority = ?
  `).run(first_response_hours, resolution_hours, escalation_enabled ? 1 : 0, escalation_to || null, priority);
  return db.prepare('SELECT * FROM feedback_sla_configs WHERE priority = ?').get(priority);
}

// ─── 統計 ─────────────────────────────────────────────────────────────────────

async function getStats(db, { date_from, date_to }) {
  const dateFilter = [];
  const binds = [];
  if (date_from) { dateFilter.push(`t.created_at >= TO_TIMESTAMP(?, 'YYYY-MM-DD')`); binds.push(date_from); }
  if (date_to) { dateFilter.push(`t.created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD') + 1`); binds.push(date_to); }
  const where = dateFilter.length > 0 ? 'WHERE ' + dateFilter.join(' AND ') : '';

  const [statusDist, priorityDist, categoryDist, summary] = await Promise.all([
    db.prepare(`SELECT status, COUNT(*) AS cnt FROM feedback_tickets t ${where} GROUP BY status`).all(...binds),
    db.prepare(`SELECT priority, COUNT(*) AS cnt FROM feedback_tickets t ${where} GROUP BY priority`).all(...binds),
    db.prepare(`
      SELECT c.name AS category_name, COUNT(*) AS cnt
      FROM feedback_tickets t
      LEFT JOIN feedback_categories c ON c.id = t.category_id
      ${where}
      GROUP BY c.name
    `).all(...binds),
    db.prepare(`
      SELECT
        COUNT(*) AS total,
        NVL(SUM(CASE WHEN ai_resolved = 1 THEN 1 ELSE 0 END), 0) AS ai_resolved_count,
        NVL(SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END), 0) AS sla_breached_count,
        ROUND(NVL(AVG(satisfaction_rating), 0), 1) AS avg_satisfaction
      FROM feedback_tickets t ${where}
    `).get(...binds),
  ]);

  return { statusDist, priorityDist, categoryDist, summary };
}

// ─── 通知 ─────────────────────────────────────────────────────────────────────

async function createNotification(db, { user_id, ticket_id, type, title, message }) {
  await db.prepare(`
    INSERT INTO feedback_notifications (user_id, ticket_id, type, title, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(user_id, ticket_id, type, title || '', message || '');
}

async function listNotifications(db, userId, { unread_only, limit: lim }) {
  const filter = unread_only ? 'AND n.is_read = 0' : '';
  const l = Math.min(100, Number(lim) || 50);
  return db.prepare(`
    SELECT n.*, t.ticket_no, t.subject
    FROM feedback_notifications n
    LEFT JOIN feedback_tickets t ON t.id = n.ticket_id
    WHERE n.user_id = ? ${filter}
    ORDER BY n.created_at DESC
    FETCH FIRST ${l} ROWS ONLY
  `).all(userId);
}

async function markNotificationsRead(db, userId, ids) {
  if (!ids || ids.length === 0) {
    await db.prepare('UPDATE feedback_notifications SET is_read = 1 WHERE user_id = ?').run(userId);
  } else {
    const placeholders = ids.map(() => '?').join(',');
    await db.prepare(
      `UPDATE feedback_notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`
    ).run(userId, ...ids);
  }
}

async function getUnreadCount(db, userId) {
  const row = await db.prepare(
    'SELECT COUNT(*) AS cnt FROM feedback_notifications WHERE user_id = ? AND is_read = 0'
  ).get(userId);
  return Number(row?.cnt ?? row?.CNT ?? 0);
}

module.exports = {
  generateTicketNo,
  createTicket,
  submitTicket,
  getTicketByNo,
  getTicketById,
  listTickets,
  updateTicket,
  changeStatus,
  assignTicket,
  submitSatisfaction,
  addMessage,
  deleteMessage,
  addSystemMessage,
  listMessages,
  addAttachment,
  listAttachments,
  deleteAttachment,
  listCategories,
  listAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  listSlaConfigs,
  updateSlaConfig,
  getStats,
  createNotification,
  listNotifications,
  markNotificationsRead,
  getUnreadCount,
};
