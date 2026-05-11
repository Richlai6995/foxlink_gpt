/**
 * Error Boundary middleware — 確保 projects-platform 內任何 exception 不冒泡出去
 *
 * 對應解耦設計 §D.1:嚴格 Error Boundary
 * 規則 4:新平台 exception 不冒泡出 namespace 邊界
 *
 * 使用:每個 route handler 都用 asyncHandler 包,自動接 promise rejection
 */

const { makeLogger } = require('../services/logger');

const log = makeLogger('error-boundary');

/**
 * 將 async route handler 包成 express-friendly handler
 *
 * @example
 *   router.get('/:id', asyncHandler(async (req, res) => {
 *     const project = await projectsService.get(req.params.id);
 *     res.json(project);
 *   }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((e) => {
      log.error(`route ${req.method} ${req.path}:`, e.message, e.stack);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'projects-platform error',
          message: e.message,
          // 在 dev 模式才返回 stack
          ...(process.env.NODE_ENV !== 'production' ? { stack: e.stack } : {}),
        });
      }
    });
  };
}

/**
 * Worker safe wrapper — 確保 background worker 內 throw 不會 crash process
 */
function safeWorker(name, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      log.error(`worker ${name}:`, e.message, e.stack);
      // 不 throw — worker 自己活著
    }
  };
}

module.exports = {
  asyncHandler,
  safeWorker,
};
