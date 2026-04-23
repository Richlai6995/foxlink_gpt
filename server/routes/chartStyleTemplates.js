/**
 * chartStyleTemplates — Phase 4c:使用者命名樣式 + 系統預設
 *
 * 套用優先序(client 端):
 *   spec.style(LLM / 使用者 override)
 *     → user default template(is_default=1 AND owner_id=me)
 *     → system default(is_system=1)
 *     → hardcoded fallback
 *
 * 路由:
 *   GET    /api/chart-style-templates            — 列 my + system
 *   POST   /api/chart-style-templates            — 建立
 *   PUT    /api/chart-style-templates/:id        — 更新(owner only;is_system 只允許 admin)
 *   DELETE /api/chart-style-templates/:id        — 刪除(owner only;is_system 不可刪)
 *   POST   /api/chart-style-templates/:id/set-default — 把其他 is_default 清掉,只留這張
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

router.use(verifyToken);

function hydrate(row) {
  if (!row) return row;
  const out = { ...row };
  if (out.style_json && typeof out.style_json === 'string') {
    try { out.style_json = JSON.parse(out.style_json); } catch (_) {}
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST — my templates + system defaults + which is my active default
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const u = req.user;

    // my templates
    const mine = await db.prepare(
      `SELECT id, owner_id, name, description, is_system, is_default, style_json,
              created_at, updated_at
       FROM chart_style_templates
       WHERE owner_id=? ORDER BY updated_at DESC`
    ).all(u.id);

    // system templates(全使用者都看得到,admin 可編)
    const system = await db.prepare(
      `SELECT id, owner_id, name, description, is_system, is_default, style_json,
              created_at, updated_at
       FROM chart_style_templates
       WHERE is_system=1 ORDER BY id ASC`
    ).all();

    res.json({
      mine: mine.map(hydrate),
      system: system.map(hydrate),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description, style_json } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '缺 name' });
    if (!style_json) return res.status(400).json({ error: '缺 style_json' });
    const styleStr = typeof style_json === 'string' ? style_json : JSON.stringify(style_json);
    const r = await db.prepare(
      `INSERT INTO chart_style_templates (owner_id, name, description, is_system, is_default, style_json)
       VALUES (?, ?, ?, 0, 0, ?)`
    ).run(req.user.id, name.trim().slice(0, 100), description || null, styleStr);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — owner only(系統模板只 admin 可編)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const tmpl = await db.prepare(`SELECT * FROM chart_style_templates WHERE id=?`).get(req.params.id);
    if (!tmpl) return res.status(404).json({ error: '模板不存在' });
    const isOwner = tmpl.owner_id === req.user.id;
    const isAdminEditSystem = tmpl.is_system === 1 && req.user.role === 'admin';
    if (!isOwner && !isAdminEditSystem) {
      return res.status(403).json({ error: '無編輯權限' });
    }

    const fields = [];
    const args = [];
    for (const k of ['name', 'description', 'style_json']) {
      if (req.body[k] === undefined) continue;
      let v = req.body[k];
      if (k === 'style_json' && typeof v === 'object') v = JSON.stringify(v);
      if (k === 'name') v = String(v).trim().slice(0, 100);
      fields.push(`${k}=?`);
      args.push(v);
    }
    if (fields.length === 0) return res.json({ ok: true });
    fields.push('updated_at=SYSTIMESTAMP');
    args.push(req.params.id);
    await db.prepare(`UPDATE chart_style_templates SET ${fields.join(',')} WHERE id=?`).run(...args);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — owner only;系統模板不可刪(避免站台空洞)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const tmpl = await db.prepare(`SELECT * FROM chart_style_templates WHERE id=?`).get(req.params.id);
    if (!tmpl) return res.status(404).json({ error: '模板不存在' });
    if (tmpl.is_system === 1) return res.status(400).json({ error: '系統模板不可刪除' });
    if (tmpl.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '無刪除權限' });
    }
    await db.prepare(`DELETE FROM chart_style_templates WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SET DEFAULT — atomic 把 owner 其他 is_default 清掉,只留這張
//   若 id=0 → 清除所有 default(等於回到系統預設)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/set-default', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const targetId = Number(req.params.id);
    // 先把該 owner 的 defaults 清掉(含系統以外的所有模板)
    await db.prepare(
      `UPDATE chart_style_templates SET is_default=0 WHERE owner_id=?`
    ).run(req.user.id);

    if (targetId > 0) {
      // 檢查 target 是這個 user 的(system 不能設為 user default,因 system 是全站共用)
      const tmpl = await db.prepare(`SELECT * FROM chart_style_templates WHERE id=?`).get(targetId);
      if (!tmpl) return res.status(404).json({ error: '模板不存在' });
      if (tmpl.owner_id !== req.user.id) {
        return res.status(400).json({ error: '只能設自己的模板為預設' });
      }
      await db.prepare(
        `UPDATE chart_style_templates SET is_default=1 WHERE id=?`
      ).run(targetId);
    }
    // id=0 意味回到「無 user default」,render 時會 fallback 到 system default
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
