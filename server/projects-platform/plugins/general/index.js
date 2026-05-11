/**
 * GENERAL plugin — 一般專案(最簡)
 *
 * 對應 spec §9.1:其他 project_type 的最小範例
 */

module.exports = {
  type_code: 'GENERAL',

  confidential_field_defaults: [],

  ui_tabs: [
    { id: 'overview', order: 1, component: 'GeneralOverview' },
    { id: 'tasks',    order: 2, component: 'TaskBoard' },
  ],

  stage_hooks: {},
  scrub_rules: {},
  form_template: {},

  // 一般專案只建公告 + 一般討論
  default_channels: [
    { name: 'announcement', type: 'announcement', is_default: 1 },
    { name: 'general',      type: 'general',      is_default: 1 },
  ],

  // 通用流程模板(可由 PM 客製)
  default_workflow_stages: [
    { code: 'PLAN',     order: 1, sla_hours: 24, required_role: 'PM' },
    { code: 'EXECUTE',  order: 2, sla_hours: 168 },
    { code: 'REVIEW',   order: 3, sla_hours: 24 },
    { code: 'CLOSE',    order: 4, sla_hours: 8,  required_role: 'PM' },
  ],
};
