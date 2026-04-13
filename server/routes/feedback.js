const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { verifyToken, verifyAdmin } = require('./auth');
const feedbackService = require('../services/feedbackService');
const { emitNewMessage, emitStatusChanged, emitNewTicket, emitUserNotification, emitTicketAssigned } = require('../services/socketService');
const feedbackNotif = require('../services/feedbackNotificationService');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const feedbackUploadDir = path.join(UPLOAD_DIR, 'feedback');
if (!fs.existsSync(feedbackUploadDir)) fs.mkdirSync(feedbackUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(feedbackUploadDir, 'tmp');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // multer 預設 latin1 解碼，中文需轉 utf8
    const origName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // 移除路徑分隔符防止目錄遍歷
    const safeName = origName.replace(/[/\\]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      return cb(new Error('不允許上傳影片檔案'), false);
    }
    cb(null, true);
  }
});

router.use(verifyToken);

// ─── 分類（公開）─────────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const lang = req.query.lang || req.headers['accept-language']?.split(',')[0] || 'zh-TW';
    const cats = await feedbackService.listCategories(db, lang);
    res.json(cats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 工單 CRUD ───────────────────────────────────────────────────────────────

router.get('/tickets', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const isAdmin = req.user.role === 'admin';
    const my = req.query.my === 'true';
    const result = await feedbackService.listTickets(db, {
      userId: req.user.id,
      isAdmin: isAdmin && !my,
      status: req.query.status,
      priority: req.query.priority,
      category_id: req.query.category_id,
      search: req.query.search,
      assigned_to: req.query.assigned_to,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      sort: req.query.sort,
      order: req.query.order,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tickets', upload.array('files', 10), async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { subject, description, share_link, category_id, priority, tags, source, source_session_id, is_draft } = req.body;
    if (!subject) return res.status(400).json({ error: '主旨為必填' });

    const isDraft = is_draft === 'true' || is_draft === true;
    const ticket = await feedbackService.createTicket(db, {
      user: req.user,
      subject, description, share_link,
      category_id: category_id ? Number(category_id) : null,
      priority, tags: tags ? (() => { try { return JSON.parse(tags); } catch { return null; } })() : null,
      source, source_session_id, isDraft,
    });

    // 處理附件
    if (req.files && req.files.length > 0) {
      const ticketDir = path.join(feedbackUploadDir, `ticket_${ticket.ticket_no}`);
      fs.mkdirSync(ticketDir, { recursive: true });
      for (const file of req.files) {
        const dest = path.join(ticketDir, file.filename);
        fs.renameSync(file.path, dest);
        await feedbackService.addAttachment(db, {
          ticket_id: ticket.id,
          message_id: null,
          file_name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
          file_path: `feedback/ticket_${ticket.ticket_no}/${file.filename}`,
          file_size: file.size,
          mime_type: file.mimetype,
          uploaded_by: req.user.id,
        });
      }
    }

    // 草稿不發通知，送出時才發
    if (!isDraft) {
      feedbackNotif.onTicketCreated(db, ticket).catch(e => console.warn('[Feedback] notif error:', e.message));
    }

    res.status(201).json(ticket);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tickets/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    // 非管理員只能看自己的
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限查看' });
    }
    res.json(ticket);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/tickets/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限修改' });
    }
    const updated = await feedbackService.updateTicket(db, Number(req.params.id), req.body);
    if (!updated) return res.status(400).json({ error: '沒有可更新的欄位' });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 狀態操作 ────────────────────────────────────────────────────────────────

router.put('/tickets/:id/status', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { status, note } = req.body;
    if (!status) return res.status(400).json({ error: 'status 為必填' });
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限操作' });
    }
    const updated = await feedbackService.changeStatus(db, Number(req.params.id), status, req.user.id, note);
    emitStatusChanged(Number(req.params.id), { ticketId: Number(req.params.id), oldStatus: ticket.status, newStatus: status, changedBy: req.user.id });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/tickets/:id/submit', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (ticket.user_id !== req.user.id) return res.status(403).json({ error: '只有申請者可以送出' });
    const updated = await feedbackService.submitTicket(db, Number(req.params.id));
    feedbackNotif.onTicketCreated(db, updated).catch(() => {});
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/tickets/:id/assign', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
    const updated = await feedbackService.assignTicket(db, Number(req.params.id), req.user.id);
    emitTicketAssigned(Number(req.params.id), { ticketId: Number(req.params.id), assignedTo: req.user.id });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/tickets/:id/resolve', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限操作' });
    }
    const { note } = req.body;
    const updated = await feedbackService.changeStatus(db, Number(req.params.id), 'resolved', req.user.id, note);
    feedbackNotif.onTicketResolved(db, updated, note, req.user.name || req.user.username).catch(() => {});
    // KB sync（背景執行）
    const { syncTicketToKB } = require('../services/feedbackKBSync');
    syncTicketToKB(db, Number(req.params.id)).catch(e => console.warn('[FeedbackKB] sync error:', e.message));
    emitStatusChanged(Number(req.params.id), { ticketId: Number(req.params.id), oldStatus: ticket.status, newStatus: 'resolved' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/tickets/:id/reopen', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (ticket.user_id !== req.user.id) return res.status(403).json({ error: '只有申請者可以重開' });

    // 檢查 72hr 限制
    if (ticket.resolved_at) {
      const resolvedAt = new Date(ticket.resolved_at);
      const now = new Date();
      if (now - resolvedAt > 72 * 3600000) {
        return res.status(400).json({ error: '已超過 72 小時，無法重開' });
      }
    }

    const updated = await feedbackService.changeStatus(db, Number(req.params.id), 'reopened', req.user.id);
    feedbackNotif.onTicketReopened(db, updated).catch(() => {});
    emitStatusChanged(Number(req.params.id), { ticketId: Number(req.params.id), oldStatus: 'resolved', newStatus: 'reopened' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/tickets/:id/satisfaction', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (ticket.user_id !== req.user.id) return res.status(403).json({ error: '只有申請者可以評分' });
    if (!['resolved', 'closed'].includes(ticket.status)) return res.status(400).json({ error: '只有已結案的工單可以評分' });
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: '評分 1-5' });
    const updated = await feedbackService.submitSatisfaction(db, Number(req.params.id), rating, comment);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── 對話訊息 ────────────────────────────────────────────────────────────────

router.get('/tickets/:id/messages', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限查看' });
    }
    const messages = await feedbackService.listMessages(db, Number(req.params.id), req.user.role === 'admin');
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tickets/:id/messages', upload.array('files', 5), async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限操作' });
    }
    if (ticket.status === 'closed') return res.status(400).json({ error: '已結案，無法新增訊息' });

    const { content, is_internal } = req.body;
    if (!content) return res.status(400).json({ error: '訊息內容為必填' });

    const senderRole = req.user.role === 'admin' ? 'admin' : 'applicant';
    const msg = await feedbackService.addMessage(db, {
      ticket_id: Number(req.params.id),
      sender_id: req.user.id,
      sender_role: senderRole,
      content,
      is_internal: is_internal === 'true' || is_internal === true,
    });

    // 處理附件
    if (req.files && req.files.length > 0) {
      const ticketDir = path.join(feedbackUploadDir, `ticket_${ticket.ticket_no}`);
      fs.mkdirSync(ticketDir, { recursive: true });
      for (const file of req.files) {
        const dest = path.join(ticketDir, file.filename);
        fs.renameSync(file.path, dest);
        await feedbackService.addAttachment(db, {
          ticket_id: Number(req.params.id),
          message_id: msg.id,
          file_name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
          file_path: `feedback/ticket_${ticket.ticket_no}/${file.filename}`,
          file_size: file.size,
          mime_type: file.mimetype,
          uploaded_by: req.user.id,
        });
      }
    }

    // 對話訊息不發 email（避免轟炸），只靠站內通知 + WebSocket + Webex
    const isInternalBool = is_internal === 'true' || is_internal === true;

    // WebSocket: 推送新訊息 + Webex 通知
    emitNewMessage(Number(req.params.id), msg);
    feedbackNotif.onNewMessage(db, ticket, req.user.name || req.user.username, content, isInternalBool, senderRole).catch(() => {});

    res.status(201).json(msg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/messages/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const isAdmin = req.user.role === 'admin';
    const result = await feedbackService.deleteMessage(db, Number(req.params.id), req.user.id, isAdmin);

    // 刪除實體檔案
    for (const att of (result.attachments || [])) {
      try {
        const fullPath = path.join(UPLOAD_DIR, att.file_path);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch {}
    }

    // WebSocket 推送（觸發前端 refresh）
    emitNewMessage(result.ticket_id, { _deleted: true, id: Number(req.params.id) });

    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── AI 分析 ─────────────────────────────────────────────────────────────────

router.post('/tickets/:id/ai-analyze', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限操作' });
    }

    const feedbackAI = require('../services/feedbackAIService');

    // SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const lang = req.query.lang || req.headers['accept-language']?.split(',')[0] || 'zh-TW';
    const result = await feedbackAI.analyzeTicket(db, Number(req.params.id), req.user.id, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    }, lang);

    res.write(`data: ${JSON.stringify({ type: 'done', ragSources: result.ragSources, model: result.model })}\n\n`);
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
      res.end();
    }
  }
});

router.put('/ai-analyses/:id/helpful', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const feedbackAI = require('../services/feedbackAIService');
    const { is_helpful } = req.body;
    await feedbackAI.markAIHelpful(db, Number(req.params.id), is_helpful);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { searchFeedbackKB } = require('../services/feedbackKBSync');
    const feedbackAI = require('../services/feedbackAIService');
    const isAdmin = req.user.role === 'admin';
    // 優先向量搜尋，fallback 關鍵字
    let results = await searchFeedbackKB(db, req.query.q || '', isAdmin, Number(req.query.limit) || 5);
    if (results.length === 0) {
      results = await feedbackAI.searchSimilarTickets(db, req.query.q || '', req.user.id, Number(req.query.limit) || 5);
    }
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 附件 ────────────────────────────────────────────────────────────────────

router.post('/tickets/:id/attachments', upload.array('files', 10), async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限操作' });
    }

    const ticketDir = path.join(feedbackUploadDir, `ticket_${ticket.ticket_no}`);
    fs.mkdirSync(ticketDir, { recursive: true });

    const attachments = [];
    for (const file of (req.files || [])) {
      const dest = path.join(ticketDir, file.filename);
      fs.renameSync(file.path, dest);
      const att = await feedbackService.addAttachment(db, {
        ticket_id: Number(req.params.id),
        message_id: null,
        file_name: file.originalname,
        file_path: `feedback/ticket_${ticket.ticket_no}/${file.filename}`,
        file_size: file.size,
        mime_type: file.mimetype,
        uploaded_by: req.user.id,
      });
      attachments.push(att);
    }
    res.json(attachments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tickets/:id/attachments', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ticket = await feedbackService.getTicketById(db, Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: '工單不存在' });
    if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: '無權限查看' });
    }
    const attachments = await feedbackService.listAttachments(db, Number(req.params.id));
    res.json(attachments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/attachments/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const att = await feedbackService.deleteAttachment(db, Number(req.params.id), req.user.id, req.user.role === 'admin');
    // 刪除實體檔案
    try {
      const fullPath = path.join(UPLOAD_DIR, att.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {}
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── 通知 ────────────────────────────────────────────────────────────────────

router.get('/notifications', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const list = await feedbackService.listNotifications(db, req.user.id, {
      unread_only: req.query.unread_only === 'true',
      limit: req.query.limit,
    });
    const unread = await feedbackService.getUnreadCount(db, req.user.id);
    res.json({ notifications: list, unread_count: unread });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/notifications/read', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await feedbackService.markNotificationsRead(db, req.user.id, req.body.ids);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 管理員：分類管理 ────────────────────────────────────────────────────────

router.get('/admin/categories', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const cats = await feedbackService.listAllCategories(db);
    res.json(cats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/categories', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const cat = await feedbackService.createCategory(db, req.body);
    res.status(201).json(cat);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/categories/:id', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const cat = await feedbackService.updateCategory(db, Number(req.params.id), req.body);
    res.json(cat);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/categories/:id', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await feedbackService.deleteCategory(db, Number(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 管理員：分類翻譯 ───────────────────────────────────────────────────────

// Get translations for all categories
router.get('/admin/categories/translations', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare('SELECT category_id, lang, name, description FROM feedback_category_translations').all();
    // Group by category_id: { [catId]: { en: { name, desc }, vi: { name, desc } } }
    const map = {};
    for (const r of rows) {
      if (!map[r.category_id]) map[r.category_id] = {};
      map[r.category_id][r.lang] = { name: r.name, description: r.description };
    }
    res.json(map);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-translate a single category (or all if id=all)
router.post('/admin/categories/:id/translate', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { translateFields } = require('../services/translationService');
    const catId = req.params.id;

    // Gather categories to translate
    let cats;
    if (catId === 'all') {
      cats = await db.prepare('SELECT id, name, description FROM feedback_categories WHERE is_active=1').all();
    } else {
      const cat = await db.prepare('SELECT id, name, description FROM feedback_categories WHERE id=?').get(Number(catId));
      if (!cat) return res.status(404).json({ error: '分類不存在' });
      cats = [cat];
    }

    const results = [];
    for (const cat of cats) {
      try {
        const translated = await translateFields({ name: cat.name, description: cat.description || '' });
        // Upsert en + vi translations
        for (const lang of ['en', 'vi']) {
          const tName = lang === 'en' ? translated.name_en : translated.name_vi;
          const tDesc = lang === 'en' ? translated.desc_en : translated.desc_vi;
          if (!tName) continue;
          const existing = await db.prepare(
            'SELECT id FROM feedback_category_translations WHERE category_id=? AND lang=?'
          ).get(cat.id, lang);
          if (existing) {
            await db.prepare(
              'UPDATE feedback_category_translations SET name=?, description=? WHERE id=?'
            ).run(tName, tDesc || null, existing.id);
          } else {
            await db.prepare(
              'INSERT INTO feedback_category_translations (category_id, lang, name, description) VALUES (?, ?, ?, ?)'
            ).run(cat.id, lang, tName, tDesc || null);
          }
        }
        results.push({ id: cat.id, ok: true });
      } catch (e) {
        results.push({ id: cat.id, ok: false, error: e.message });
      }
    }
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 管理員：SLA 設定 ───────────────────────────────────────────────────────

router.get('/admin/sla-configs', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const configs = await feedbackService.listSlaConfigs(db);
    res.json(configs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/sla-configs/:priority', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const config = await feedbackService.updateSlaConfig(db, req.params.priority, req.body);
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 管理員：統計 ────────────────────────────────────────────────────────────

router.get('/admin/stats', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const stats = await feedbackService.getStats(db, {
      date_from: req.query.date_from,
      date_to: req.query.date_to,
    });
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 管理員：匯出 Excel ─────────────────────────────────────────────────────

router.get('/admin/export', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const result = await feedbackService.listTickets(db, {
      userId: null,
      isAdmin: true,
      status: req.query.status,
      priority: req.query.priority,
      category_id: req.query.category_id,
      search: req.query.search,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      sort: req.query.sort || 'created_at',
      order: req.query.order || 'desc',
      page: 1,
      limit: 10000,
    });

    const XLSX = require('xlsx');
    const data = result.tickets.map(t => ({
      '單號': t.ticket_no,
      '申請者': t.applicant_name,
      '部門': t.applicant_dept,
      '分類': t.category_name,
      '優先級': t.priority,
      '狀態': t.status,
      '主旨': t.subject,
      '建立時間': t.created_at,
      '首次回應': t.first_response_at,
      '解決時間': t.resolved_at,
      'SLA違反': t.sla_breached ? '是' : '否',
      '處理者': t.assigned_name,
      'AI解決': t.ai_resolved ? '是' : '否',
      '滿意度': t.satisfaction_rating,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '問題反饋');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=feedback_export_${Date.now()}.xlsx`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
