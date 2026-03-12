const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('./auth');
const db = require('../database-oracle').db;

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

router.use(verifyToken);

// ── helpers ──────────────────────────────────────────────────────────────────

function copyFileSafe(src, dest) {
  try {
    if (src && fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      return true;
    }
  } catch (e) {
    console.warn('[Share] copyFileSafe failed:', src, e.message);
  }
  return false;
}

function rmDirSafe(dir) {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
}

/**
 * Build the snapshot messages_json:
 * - Copy user-uploaded images → uploads/shared/<token>/u_<n>.<ext>
 * - Copy AI-generated images  → uploads/shared/<token>/g_<n>.<ext>
 * - Rewrite references in messages
 */
function buildSnapshotMessages(rawMessages, sharedDir, token) {
  let userImgIdx = 0;
  let genImgIdx = 0;

  return rawMessages.map((m) => {
    const msg = { ...m };
    if (!m.files_json) return msg;

    let parsed;
    try { parsed = JSON.parse(m.files_json); } catch { return msg; }

    if (m.role === 'user' && Array.isArray(parsed)) {
      // User message — copy images that have localPath
      const newFiles = parsed.map((f) => {
        if (f.type === 'image' && f.localPath && fs.existsSync(f.localPath)) {
          const ext = path.extname(f.localPath) || '.jpg';
          const sharedName = `u_${userImgIdx++}${ext}`;
          copyFileSafe(f.localPath, path.join(sharedDir, sharedName));
          return { ...f, sharedFile: sharedName, localPath: undefined };
        }
        return f;
      });
      msg.files_json = JSON.stringify(newFiles);
    } else if (m.role === 'assistant') {
      // AI message — handle both new {generated, historyParts} and old array format
      const isNew = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.generated;
      const generated = isNew ? parsed.generated : (Array.isArray(parsed) ? parsed : []);
      const historyParts = isNew ? (parsed.historyParts || []) : null;

      // Copy generated image files
      const genMap = {}; // original filename → shared filename
      const newGenerated = generated.map((g) => {
        if (g.type === 'image' && g.filename) {
          const srcPath = path.join(UPLOAD_DIR, 'generated', g.filename);
          const ext = path.extname(g.filename) || '.png';
          const sharedName = `g_${genImgIdx++}${ext}`;
          copyFileSafe(srcPath, path.join(sharedDir, sharedName));
          genMap[g.filename] = sharedName;
          return {
            ...g,
            filename: sharedName,
            publicUrl: `/uploads/shared/${token}/${sharedName}`,
            url: `/uploads/shared/${token}/${sharedName}`,
          };
        }
        return g;
      });

      // Update historyParts image references
      let newHistoryParts = historyParts;
      if (historyParts) {
        newHistoryParts = historyParts.map((p) => {
          if (p._type === 'image' && p.filename && genMap[p.filename]) {
            return { ...p, filename: genMap[p.filename] };
          }
          return p;
        });
      }

      if (isNew) {
        msg.files_json = JSON.stringify({ generated: newGenerated, historyParts: newHistoryParts });
      } else {
        msg.files_json = JSON.stringify(newGenerated);
      }
    }

    return msg;
  });
}

// ── GET /api/share  — list my shared sessions ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT id, session_id, title, model, created_at FROM share_snapshots
       WHERE created_by=? ORDER BY created_at DESC`
    ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/share  — create share snapshot ──────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId 為必填' });

    const session = await db.prepare(
      `SELECT * FROM chat_sessions WHERE id=? AND user_id=?`
    ).get(sessionId, req.user.id);
    if (!session) return res.status(404).json({ error: '找不到對話' });

    const rawMessages = await db.prepare(
      `SELECT id, role, content, files_json, created_at FROM chat_messages
       WHERE session_id=? ORDER BY created_at ASC`
    ).all(sessionId);

    const token = uuidv4();
    const sharedDir = path.join(UPLOAD_DIR, 'shared', token);
    fs.mkdirSync(sharedDir, { recursive: true });

    const snapshotMessages = buildSnapshotMessages(rawMessages, sharedDir, token);

    await db.prepare(
      `INSERT INTO share_snapshots (id, created_by, session_id, title, model, messages_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(token, req.user.id, sessionId, session.title || '未命名對話', session.model, JSON.stringify(snapshotMessages));

    res.json({ token, shareUrl: `/share/${token}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/share/:token  — view share ───────────────────────────────────
router.get('/:token', async (req, res) => {
  try {
    const snap = await db.prepare(
      `SELECT s.id, s.title, s.model, s.created_at, s.messages_json,
              u.name AS creator_name, u.username AS creator_username
       FROM share_snapshots s JOIN users u ON u.id = s.created_by
       WHERE s.id=?`
    ).get(req.params.token);
    if (!snap) return res.status(404).json({ error: '找不到分享' });

    let messages = [];
    try { messages = JSON.parse(snap.messages_json); } catch {}

    // Transform messages for frontend
    const transformed = messages.map((m) => {
      const out = { ...m };
      if (!m.files_json) return out;
      let parsed;
      try { parsed = JSON.parse(m.files_json); } catch { return out; }

      if (m.role === 'user' && Array.isArray(parsed)) {
        out.files = parsed.map((f) => ({
          name: f.name,
          type: f.type,
          url: f.sharedFile ? `/uploads/shared/${req.params.token}/${f.sharedFile}` : f.url,
        }));
      } else if (m.role === 'assistant') {
        const isNew = parsed && !Array.isArray(parsed) && parsed.generated;
        const generated = isNew ? parsed.generated : (Array.isArray(parsed) ? parsed : []);
        out.generated_files = generated.map((g) => ({
          type: g.type || 'image',
          filename: g.filename,
          publicUrl: g.publicUrl || g.url || `/uploads/shared/${req.params.token}/${g.filename}`,
        }));
      }

      return out;
    });

    res.json({
      id: snap.id,
      title: snap.title,
      model: snap.model,
      created_at: snap.created_at,
      creator_name: snap.creator_name,
      creator_username: snap.creator_username,
      is_owner: false, // resolved below
      messages: transformed,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/share/:token/fork  — fork into new session ─────────────────
router.post('/:token/fork', async (req, res) => {
  try {
    const snap = await db.prepare(
      `SELECT id, title, model, messages_json, created_by FROM share_snapshots WHERE id=?`
    ).get(req.params.token);
    if (!snap) return res.status(404).json({ error: '找不到分享' });

    const sharedDir = path.join(UPLOAD_DIR, 'shared', snap.id);
    const userImgDir = path.join(UPLOAD_DIR, 'user_images');
    const genDir = path.join(UPLOAD_DIR, 'generated');
    fs.mkdirSync(userImgDir, { recursive: true });
    fs.mkdirSync(genDir, { recursive: true });

    let snapMessages = [];
    try { snapMessages = JSON.parse(snap.messages_json); } catch {}

    // Create new session
    const newSessionId = uuidv4();
    await db.prepare(
      `INSERT INTO chat_sessions (id, user_id, title, model) VALUES (?, ?, ?, ?)`
    ).run(newSessionId, req.user.id, `[Fork] ${snap.title || '分享對話'}`, snap.model || 'pro');

    const ts = Date.now();
    let forkImgIdx = 0;
    let forkGenIdx = 0;

    for (const m of snapMessages) {
      let newFilesJson = m.files_json || null;

      if (m.files_json) {
        let parsed;
        try { parsed = JSON.parse(m.files_json); } catch {}

        if (m.role === 'user' && Array.isArray(parsed)) {
          const newFiles = parsed.map((f) => {
            if (f.type === 'image' && f.sharedFile) {
              const src = path.join(sharedDir, f.sharedFile);
              const ext = path.extname(f.sharedFile) || '.jpg';
              const newName = `user_${ts}_fork${forkImgIdx++}${ext}`;
              const dest = path.join(userImgDir, newName);
              copyFileSafe(src, dest);
              return { ...f, localPath: dest, sharedFile: undefined };
            }
            return f;
          });
          newFilesJson = JSON.stringify(newFiles);
        } else if (m.role === 'assistant' && parsed) {
          const isNew = !Array.isArray(parsed) && parsed.generated;
          const generated = isNew ? parsed.generated : (Array.isArray(parsed) ? parsed : []);
          const historyParts = isNew ? (parsed.historyParts || []) : null;

          const genMap = {};
          const newGenerated = generated.map((g) => {
            if (g.type === 'image' && g.filename) {
              const src = path.join(sharedDir, g.filename);
              const ext = path.extname(g.filename) || '.png';
              const newName = `fork_${ts}_${forkGenIdx++}${ext}`;
              const dest = path.join(genDir, newName);
              copyFileSafe(src, dest);
              genMap[g.filename] = newName;
              return {
                ...g,
                filename: newName,
                publicUrl: `/uploads/generated/${newName}`,
                url: `/uploads/generated/${newName}`,
              };
            }
            return g;
          });

          let newHistoryParts = historyParts;
          if (historyParts) {
            newHistoryParts = historyParts.map((p) => {
              if (p._type === 'image' && p.filename && genMap[p.filename]) {
                return { ...p, filename: genMap[p.filename] };
              }
              return p;
            });
          }

          newFilesJson = isNew
            ? JSON.stringify({ generated: newGenerated, historyParts: newHistoryParts })
            : JSON.stringify(newGenerated);
        }
      }

      await db.prepare(
        `INSERT INTO chat_messages (session_id, role, content, files_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(newSessionId, m.role, m.content || '', newFilesJson, new Date(m.created_at || Date.now()));
    }

    res.json({ sessionId: newSessionId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/share/:token  — delete share (owner only) ─────────────────
router.delete('/:token', async (req, res) => {
  try {
    const snap = await db.prepare(
      `SELECT id, created_by FROM share_snapshots WHERE id=?`
    ).get(req.params.token);
    if (!snap) return res.status(404).json({ error: '找不到分享' });
    if (snap.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '無刪除權限' });
    }
    rmDirSafe(path.join(UPLOAD_DIR, 'shared', snap.id));
    await db.prepare(`DELETE FROM share_snapshots WHERE id=?`).run(snap.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
