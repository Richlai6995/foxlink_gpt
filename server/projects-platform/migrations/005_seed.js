/**
 * Migration 005 — Seed project_types + workflow_templates from plugin registry
 *
 * 思路:plugin code 是 source of truth(README.md §plugin source of truth)
 *      - admin 介面不能新增 type_code
 *      - 每次 server boot,把 plugin metadata 同步到 DB(idempotent upsert)
 *
 * 對應 spec §3.2 / §9.1 / §18.1.5
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/005-seed');
const pluginRegistry = require('../plugins/registry');

module.exports = async function migrate005Seed(db) {
  // 確保 plugins 已載入(bootAll 在 index.js 啟動時跑,migration 也補一次保險)
  if (pluginRegistry.list().length === 0) {
    pluginRegistry.bootAll();
  }

  const codes = pluginRegistry.list();
  if (codes.length === 0) {
    log.warn('no plugins registered — skip seed');
    return;
  }

  for (const code of codes) {
    const plugin = pluginRegistry.get(code);
    if (!plugin) continue;

    // ─── 1. project_types upsert ────────────────────────────────────
    const typeRow = await db.prepare(
      `SELECT id FROM project_types WHERE type_code = ?`,
    ).get(code);

    let projectTypeId;
    if (typeRow) {
      projectTypeId = Number(typeRow.id);
      log.log(`project_type ${code} exists (id=${projectTypeId})`);
    } else {
      const ins = await db.prepare(
        `INSERT INTO project_types
           (type_code, name_i18n, description_i18n, icon, is_enabled, sort_order)
         VALUES (?, ?, ?, ?, 1, ?)`,
      ).run(
        code,
        JSON.stringify(plugin.name_i18n || { 'zh-TW': code, en: code }),
        JSON.stringify(plugin.description_i18n || { 'zh-TW': '', en: '' }),
        plugin.icon || '',
        plugin.sort_order || 100,
      );
      projectTypeId = Number(ins.lastInsertRowid);
      log.log(`project_type ${code} inserted (id=${projectTypeId})`);
    }

    // ─── 2. workflow_templates upsert(SYSTEM scope, 1 default per type) ─
    const stages = plugin.default_workflow_stages || [];
    if (stages.length === 0) {
      log.log(`plugin ${code} has no default_workflow_stages — skip template seed`);
      continue;
    }

    const templateCode = `${code}_DEFAULT`;
    let templateRow = await db.prepare(
      `SELECT id FROM workflow_templates WHERE code = ?`,
    ).get(templateCode);

    let templateId;
    if (templateRow) {
      templateId = Number(templateRow.id);
      log.log(`workflow_template ${templateCode} exists (id=${templateId})`);
    } else {
      const ins = await db.prepare(
        `INSERT INTO workflow_templates
           (code, name_i18n, project_type_id, scope, is_default, is_enabled, version)
         VALUES (?, ?, ?, 'SYSTEM', 1, 1, 1)`,
      ).run(
        templateCode,
        JSON.stringify({ 'zh-TW': `${code} 預設流程`, en: `${code} default workflow` }),
        projectTypeId,
      );
      templateId = Number(ins.lastInsertRowid);
      log.log(`workflow_template ${templateCode} inserted (id=${templateId})`);

      // 順便寫 default_workflow_template_id 回 project_types(便利 query)
      await db.prepare(
        `UPDATE project_types SET default_workflow_template_id = ? WHERE id = ?`,
      ).run(templateId, projectTypeId);

      // 寫 stages(只在 template 剛建立時 seed,後續不覆蓋避免 admin 改動被吃)
      for (const s of stages) {
        await db.prepare(
          `INSERT INTO workflow_template_stages
             (template_id, stage_code, stage_name_i18n, stage_order, sla_hours, required_role, gate_required)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          templateId,
          s.code,
          JSON.stringify({ 'zh-TW': s.name_zh || s.code, en: s.name_en || s.code }),
          s.order,
          s.sla_hours || null,
          s.required_role || null,
          s.gate_required ? 1 : 0,
        );
      }
      log.log(`seeded ${stages.length} stages for template ${templateCode}`);
    }
  }

  log.log('005_seed migration ✓');
};
