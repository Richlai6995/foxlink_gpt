'use strict';
/**
 * Budget Guard Middleware
 *
 * 統一攔截所有 AI 呼叫路由，在請求執行前檢查使用者的
 * daily / weekly / monthly 預算限制。
 *
 * 用法：
 *   const { budgetGuard } = require('../middleware/budgetGuard');
 *   router.post('/messages', budgetGuard, handler);
 *
 * Admin 自動豁免；action='warn' 時不阻擋但寫 log。
 */

const { checkBudgetExceeded } = require('../services/tokenService');

/**
 * Express middleware — 讀取使用者 budget 設定，超額時回 429。
 */
async function budgetGuard(req, res, next) {
  try {
    // Admin 豁免
    if (req.user?.role === 'admin') return next();

    const userId = req.user?.id;
    if (!userId) return next(); // 無法辨識使用者 → 放行（不該發生，verifyToken 在前面）

    const db = require('../database-oracle').db;
    const result = await checkBudgetExceeded(db, userId);

    if (result.exceeded) {
      const username = req.user.username || req.user.name || userId;
      console.warn(`[BudgetGuard] BLOCKED user=${userId}(${username}) action=${result.action} msg=${result.message}`);

      if (result.action === 'warn') {
        // warn 模式：僅 log，不阻擋
        console.warn(`[BudgetGuard] WARN mode — allowing request for user=${userId}`);
        return next();
      }

      // block 模式：回 429
      return res.status(429).json({ error: result.message });
    }

    next();
  } catch (e) {
    // budget check 出錯時不阻擋（與原 checkBudgetExceeded 行為一致）
    console.error('[BudgetGuard] error:', e.message);
    next();
  }
}

module.exports = { budgetGuard };
