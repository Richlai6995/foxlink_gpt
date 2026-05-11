/**
 * QUOTE plugin — 業務報價(對齊 OIBG RFQ flow)
 *
 * 對應 spec §9 Plugin 架構 + §11 Form 引擎 + §18.1.5 預設配置
 * Phase 1 scaffold:plugin metadata 框架,實際 stage_hooks / scrub_rules / form_template
 * 在後續 phase 1 開發時實作。
 */

module.exports = {
  type_code: 'QUOTE',

  // 預設機密欄位(對齊 §11.2.4 + §18.1.5)
  confidential_field_defaults: [
    'amount',
    'margin',
    'cost_breakdown',
  ],

  // UI tabs(實際 component 在 client 端,server 提供 metadata)
  ui_tabs: [
    { id: 'overview',    order: 1, component: 'QuoteOverview' },
    { id: 'war_room',    order: 2, component: 'WarRoom' },
    { id: 'costing',     order: 3, component: 'CostingPanel' },
    { id: 'factory_cmp', order: 4, component: 'FactoryCompare' },
    { id: 'tasks',       order: 5, component: 'TaskBoard' },
  ],

  // Stage hooks — 進入 / 離開 stage 時觸發的邏輯(待實作)
  stage_hooks: {
    // 'COSTING:on_enter': require('./hooks/runCostingEngine'),
    // 'CLOSED:on_enter':  require('./hooks/triggerDeclassify'),
  },

  // LLM scrub rules — 送外部 LLM 前替換敏感值(對應 §12.4)
  scrub_rules: {
    // 'amount': (v) => 'Tier-?',
    // 'customer_name': (v) => '[CUST_REDACTED]',
  },

  // Form template seed(對齊 §18.1.5 16+ deliverables RACI 表)
  // 實際 seed 在 Phase 1 開發時定案
  form_template: {
    // sections: [...],
    // fields: [...],
    // calculations: [...],
  },

  // Default channel config(對齊 §13.10 QUOTE plugin 預設 7 channels)
  default_channels: [
    { name: 'announcement', type: 'announcement', is_default: 1 },
    { name: 'general',      type: 'general',      is_default: 1 },
    { name: 'qa-customer',  type: 'group',        is_default: 1 },
    { name: 'engineering',  type: 'group',        is_default: 1 },
    { name: 'sourcing',     type: 'group',        is_default: 1 },
    { name: 'factory',      type: 'group',        is_default: 1 },
    { name: 'cost-review',  type: 'group',        is_default: 1 },
  ],

  // Workflow stages(對齊 §18.1.5 8 stages)
  default_workflow_stages: [
    { code: 'RECEIVE_RFQ',     order: 1, sla_hours: 4,  required_role: 'sales' },
    { code: 'Q_AND_A_COLLECT', order: 2, sla_hours: 24, required_role: 'DPM' },
    { code: 'Q_AND_A_FEEDBACK',order: 3, sla_hours: 8,  required_role: 'BPM' },
    { code: 'BOM_PROVIDE',     order: 4, sla_hours: 72, required_role: 'engineering' },
    { code: 'PARALLEL_COLLECT',order: 5, sla_hours: 48, required_role: 'ANY' },
    { code: 'BOM_COST_REVIEW', order: 6, sla_hours: 8,  required_role: 'DPM' },
    { code: 'RFQ_COST_REVIEW', order: 7, sla_hours: 16, required_role: 'DPM' },
    { code: 'SUBMIT_QUOTE',    order: 8, sla_hours: 4,  required_role: 'BPM' },
  ],
};
