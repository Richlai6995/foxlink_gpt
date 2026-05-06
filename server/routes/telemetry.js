const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

// POST /api/telemetry/device — 登入後 client 一次性 ping(silent)
// body: { profile: 'mobile' | 'desktop', ua?: string, viewport?: string }
router.post('/device', verifyToken, async (req, res) => {
  try {
    const { profile, ua, viewport } = req.body || {};
    if (profile !== 'mobile' && profile !== 'desktop') {
      return res.status(400).json({ error: 'invalid profile' });
    }
    const { db } = require('../database-oracle');
    await db.prepare(
      `INSERT INTO device_telemetry (user_id, profile, ua, viewport)
       VALUES (?, ?, ?, ?)`
    ).run(
      req.user.id,
      profile,
      (ua || req.headers['user-agent'] || '').slice(0, 500),
      (viewport || '').slice(0, 20)
    );
    res.json({ ok: true });
  } catch (e) {
    // 失敗不影響 user — silent fail
    console.warn('[telemetry] device record failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
