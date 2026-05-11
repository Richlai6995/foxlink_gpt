/**
 * Logger wrapper — 統一加 [projects-platform] prefix
 *
 * 對應解耦設計 §E:Log Namespace
 * 所有 projects-platform 內部 log 都走這裡,確保 Loki / grep 可篩選。
 */

const PREFIX = '[projects-platform]';

function _fmt(scope, args) {
  if (scope) return [`${PREFIX}/${scope}`, ...args];
  return [PREFIX, ...args];
}

function makeLogger(scope) {
  return {
    log: (...args) => console.log(..._fmt(scope, args)),
    warn: (...args) => console.warn(..._fmt(scope, args)),
    error: (...args) => console.error(..._fmt(scope, args)),
    debug: (...args) => {
      if (process.env.PROJECTS_DEBUG === 'true') {
        console.log(..._fmt(`${scope}/debug`, args));
      }
    },
  };
}

// Module-root logger
const root = makeLogger();

module.exports = {
  makeLogger,
  log: root.log,
  warn: root.warn,
  error: root.error,
  debug: root.debug,
};
