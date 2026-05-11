/**
 * Plugin Registry — 各 project_type 的 plugin 註冊表
 *
 * 對應 spec §9 Plugin 架構 + §12.10 AI 加速 plugin 整合
 *
 * 規則:
 *   - Plugin code 是 source of truth(spec §3.2 project_types)
 *   - admin 介面只能 enable/disable,不能新增 type_code
 *   - 新增 type:RD 加 plugin 檔案 + boot 時自動載入
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('plugins/registry');

const _plugins = {};

function register(plugin) {
  if (!plugin || !plugin.type_code) {
    log.warn('invalid plugin (missing type_code):', plugin);
    return;
  }
  if (_plugins[plugin.type_code]) {
    log.warn(`plugin ${plugin.type_code} already registered, overriding`);
  }
  _plugins[plugin.type_code] = plugin;
  log.log(`registered ${plugin.type_code}`);
}

function get(typeCode) {
  return _plugins[typeCode] || null;
}

function list() {
  return Object.keys(_plugins);
}

/**
 * Boot all known plugins(scaffold:只列 QUOTE / GENERAL,實際 require 等實作)
 */
function bootAll() {
  try { register(require('./quote')); } catch (e) { log.warn('quote plugin load:', e.message); }
  try { register(require('./general')); } catch (e) { log.warn('general plugin load:', e.message); }
  log.log(`booted ${list().length} plugins: ${list().join(', ')}`);
}

module.exports = {
  register,
  get,
  list,
  bootAll,
};
