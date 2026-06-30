/**
 * Migration 012 — 三軸 function-RBAC 地基(軸① Function×Verb)
 *
 * 對應 docs/cortex-integration-sd.md §11 + cortex-dev-rollout-plan.md S0
 *
 * 新建 4 表(全加性 · 無 FK 指向 Cortex 主站表):
 *   - rbac_function           function 註冊表(seed 留待 can() 引擎切片填)
 *   - rbac_role_permission    role_code × function × verb(軸① 配置核心)
 *   - rbac_sod_exclusion      maker/checker 互斥對(SoD)
 *   - rbac_gate_config        flow/approval gate 動態啟用
 *
 * ALTER user_role_definitions(idempotent safeAddColumn · 不重建現役表):
 *   + is_active   軟停用(getEffectiveRoles/hasRole 要補 d.is_active=1)
 *   + copied_from IT「複製 role」來源 role_code
 *   + created_by  IT 自建 role 的建立者
 *   注:既有 is_system 直接當「seed/不可刪」旗標,不重複加 is_seed。
 *
 * Seed:疊加 12 個 Cortex 業務 role(與既有 13 system role 共存 · is_system=1)
 *   admin 已存在(008)→ 沿用;新增 11 個 cortex.* 業務 role。
 *
 * 注:rbac_function / rbac_role_permission 的內容(35 fn + 矩陣)留待 S2/S3
 * can() 引擎切片填,確保 seed 與引擎期待一致。本遷移只建空表 + 角色。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/012');

module.exports = async function migrate012(db) {
  const createTable = async (name, ddl) => {
    try {
      const r = await db.prepare(
        `SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`,
      ).get(name);
      if (r && Number(Object.values(r)[0]) > 0) return false;  // wrapper key 大小寫不定 → 取第一值
      await db.prepare(ddl).run();
      log.log(`created table ${name}`);
      return true;
    } catch (e) {
      log.warn(`createTable ${name}:`, e.message);
      return false;
    }
  };

  const safeAddColumn = async (table, col, colDdl) => {
    try {
      const r = await db.prepare(
        `SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name = UPPER(?) AND column_name = UPPER(?)`,
      ).get(table, col);
      if (r && Number(Object.values(r)[0]) > 0) return false;  // wrapper key 大小寫不定 → 取第一值
      await db.prepare(`ALTER TABLE ${table} ADD (${colDdl})`).run();
      log.log(`added column ${table}.${col}`);
      return true;
    } catch (e) {
      log.warn(`addColumn ${table}.${col}:`, e.message);
      return false;
    }
  };

  const _idx = async (sql, name) => {
    try {
      await db.prepare(sql).run();
      log.log(`created index ${name}`);
    } catch (e) {
      if (!/already used|already exists|ORA-00955|ORA-01408/.test(e.message)) {
        log.warn(`index ${name}:`, e.message);
      }
    }
  };

  // ==========================================================================
  // 1. rbac_function — function 註冊表(對 14 superset section)
  // ==========================================================================
  await createTable('RBAC_FUNCTION', `
    CREATE TABLE rbac_function (
      function_code     VARCHAR2(60) PRIMARY KEY,
      display_name_i18n CLOB,                          -- {zh-TW,en,vi}
      module            VARCHAR2(40),                  -- PROJECT|BOM|PURCHASE|CLEANSHEET|COST|QUOTE|MASTER|ADMIN|PORTFOLIO
      section_code      VARCHAR2(40),                  -- 對 14 superset section(前台 dispatch)
      applicable_verbs  VARCHAR2(200),                 -- CSV: view,create,edit,delete,lock,...
      is_field_gated    NUMBER(1) DEFAULT 0,           -- 機密欄受軸③
      field_capability  VARCHAR2(40),                  -- VIEW_TRUE_COST | VIEW_MARGIN(is_field_gated=1 時)
      display_order     NUMBER DEFAULT 0,
      is_active         NUMBER(1) DEFAULT 1,
      created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);

  // ==========================================================================
  // 2. rbac_role_permission — role_code × function × verb(配置核心)
  //    role_code FK → user_role_definitions(role_code)(UNIQUE 欄可被 FK 參照)
  //    相依寫入時展開成顯式列(edit⊃view 等),解析不推導。
  // ==========================================================================
  await createTable('RBAC_ROLE_PERMISSION', `
    CREATE TABLE rbac_role_permission (
      role_code      VARCHAR2(80) NOT NULL,
      function_code  VARCHAR2(60) NOT NULL,
      verb           VARCHAR2(20) NOT NULL,
      effect         VARCHAR2(10) DEFAULT 'ALLOW',     -- ALLOW | DENY(deny-wins)
      created_by     NUMBER,
      created_at     TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT pk_rbac_rp PRIMARY KEY (role_code, function_code, verb),
      CONSTRAINT fk_rbac_rp_role FOREIGN KEY (role_code)
        REFERENCES user_role_definitions(role_code) ON DELETE CASCADE
    )
  `);

  await _idx(`CREATE INDEX idx_rbac_rp_fn ON rbac_role_permission(function_code, verb)`, 'idx_rbac_rp_fn');

  // ==========================================================================
  // 3. rbac_sod_exclusion — SoD 互斥對(SELF_RECORD 預設)
  // ==========================================================================
  await createTable('RBAC_SOD_EXCLUSION', `
    CREATE TABLE rbac_sod_exclusion (
      id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      fn_a          VARCHAR2(60),  verb_a VARCHAR2(20),   -- maker 端
      fn_b          VARCHAR2(60),  verb_b VARCHAR2(20),   -- checker/lock 端
      enforce_level VARCHAR2(20) DEFAULT 'SELF_RECORD',   -- SELF_RECORD(actor≠maker 才放行) | HARD(同 user 不得同持)
      scope_grain   VARCHAR2(20) DEFAULT 'RECORD',        -- RECORD | ROLE_ASSIGN
      reason        VARCHAR2(500),
      is_active     NUMBER(1) DEFAULT 1,
      created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);

  // ==========================================================================
  // 4. rbac_gate_config — flow/approval gate 動態啟用
  // ==========================================================================
  await createTable('RBAC_GATE_CONFIG', `
    CREATE TABLE rbac_gate_config (
      function_code   VARCHAR2(60) PRIMARY KEY,
      gate_type       VARCHAR2(20),                       -- flow(不可全空) | approval(可跳過)
      skip_policy     VARCHAR2(20) DEFAULT 'NO_HOLDER',   -- NO_HOLDER | DISABLED | NEVER
      fallback_role   VARCHAR2(80),                       -- flow gate 單點保護
      disabled_reason VARCHAR2(500),
      disabled_by     NUMBER,
      is_active       NUMBER(1) DEFAULT 1,
      created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);

  // ==========================================================================
  // 5. ALTER user_role_definitions(idempotent · 既有 is_system 當 is_seed)
  // ==========================================================================
  await safeAddColumn('USER_ROLE_DEFINITIONS', 'is_active',   'is_active NUMBER(1) DEFAULT 1');
  await safeAddColumn('USER_ROLE_DEFINITIONS', 'copied_from', 'copied_from VARCHAR2(80)');
  await safeAddColumn('USER_ROLE_DEFINITIONS', 'created_by',  'created_by NUMBER');

  // ==========================================================================
  // 6. Seed 11 個 Cortex 業務 role(與既有 13 system role 共存 · admin 沿用既有)
  // ==========================================================================
  await _seedCortexRoles(db);

  log.log('migration 012 ✓');
};

async function _seedCortexRoles(db) {
  // category='cortex' · is_system=1(seed/不可刪)· function 權限留待 rbac_role_permission seed
  const ROLES = [
    { code: 'cortex.bpm',          zh: 'BPM 業務專案經理',       en: 'BPM (Biz Project Mgr)',  desc_zh: '報價案開案/Stage Gate/提交',        desc_en: 'Quote case init / stage gate / submit' },
    { code: 'cortex.dpm',          zh: 'DPM 開發總監',           en: 'DPM (Dev Director)',     desc_zh: 'Cost review/BOM final lock/二簽',    desc_en: 'Cost review / BOM final lock / 2nd sign' },
    { code: 'cortex.epm',          zh: 'EPM 廠製造工程經理',     en: 'EPM (Mfg Eng Mgr)',      desc_zh: '製程/Cleansheet/廠 lock',           desc_en: 'Process / cleansheet / factory lock' },
    { code: 'cortex.rd',           zh: 'RD 研發',                en: 'R&D',                    desc_zh: 'BOM 結構/CMF 變體',                 desc_en: 'BOM structure / CMF variants' },
    { code: 'cortex.buyer',        zh: '採購 Buyer(含 PKG)',    en: 'Buyer (incl. PKG)',      desc_zh: '採購策略/詢價/包裝 BOM',            desc_en: 'Purchase strategy / inquiry / packaging' },
    { code: 'cortex.buyer_lead',   zh: '採購主管',               en: 'Purchasing Lead',        desc_zh: '採購策略核准',                      desc_en: 'Approve purchase strategy' },
    { code: 'cortex.planning',     zh: '經管(廠級 master)',     en: 'Planning (Factory Master)', desc_zh: '廠 baseline/設備類別/工資 master', desc_en: 'Factory baseline / equip cat / wage master' },
    { code: 'cortex.sales',        zh: '業務 Sales(兼 Finance)', en: 'Sales (incl. Finance)',  desc_zh: 'NRE/議價策略/報價匯出/Submit/Reprice', desc_en: 'NRE / strategy / export / submit / reprice' },
    { code: 'cortex.sales_assist', zh: '業助',                   en: 'Sales Assistant',        desc_zh: '報價匯出/NRE 協助(無 margin)',     desc_en: 'Export / NRE assist (no margin)' },
    { code: 'cortex.gm_bg',        zh: '總經理 / BG 高層',       en: 'GM / BG Exec',           desc_zh: 'BG Portfolio 檢視',                 desc_en: 'BG portfolio view' },
    { code: 'cortex.chairman',     zh: '董事長',                 en: 'Chairman',               desc_zh: '集團 Portfolio 檢視',               desc_en: 'Group portfolio view' },
  ];

  for (const r of ROLES) {
    try {
      const exists = await db.prepare(
        `SELECT id FROM user_role_definitions WHERE role_code = ?`,
      ).get(r.code);
      if (exists) continue;

      await db.prepare(`
        INSERT INTO user_role_definitions
          (role_code, name_i18n, description_i18n, category, is_system, permissions_json, is_active)
        VALUES (?, ?, ?, 'cortex', 1, ?, 1)
      `).run(
        r.code,
        JSON.stringify({ 'zh-TW': r.zh, en: r.en, vi: r.zh }),
        JSON.stringify({ 'zh-TW': r.desc_zh, en: r.desc_en, vi: r.desc_zh }),
        JSON.stringify({}),  // 軸① 權限走 rbac_role_permission,不塞 permissions_json
      );
      log.log(`seeded cortex role: ${r.code}`);
    } catch (e) {
      log.warn(`seed cortex role ${r.code} failed: ${e.message}`);
    }
  }
}
