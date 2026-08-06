/**
 * Migration 013x — QUOTE_DEFAULT stage gates(對齊 demo:stage 1/6/7/8 = GATE)
 * quote plugin 原 seed 沒寫 gate_required → 全 0,gated-stage 權限檢查從未生效。
 * 只改範本(新案生效);既有專案的 project_stages 不追溯。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013x');

module.exports = async function migrate013x(db) {
  try {
    await db.prepare(
      `UPDATE workflow_template_stages
          SET gate_required = 1
        WHERE stage_code IN ('RECEIVE_RFQ', 'BOM_COST_REVIEW', 'RFQ_COST_REVIEW', 'SUBMIT_QUOTE')
          AND gate_required = 0
          AND template_id IN (SELECT id FROM workflow_templates WHERE code = 'QUOTE_DEFAULT')`,
    ).run();
  } catch (e) {
    log.warn('set gate_required:', e.message);
  }
  log.log('migration 013x ✓');
};
