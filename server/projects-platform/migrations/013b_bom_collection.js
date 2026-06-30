/**
 * Migration 013b — BOM superset · Layer 3 BOM 結構鏈(FK projects + 自身鏈)
 *
 * 對應 bom-collection-sd + cortex-unified-architecture-sd §5(module/WHOOP 料號併入)
 *        + workflow bom-superset-schema-reconcile · rollout §3.6
 *
 * case = project:bom_instance.project_id → projects(id)(projects 表 0 ALTER)
 * 10 表(建表順序 = FK 依賴拓樸):
 *   bom_instance → bom_section → bom_category → bom_item
 *   → bom_ai_cache(先於 flk)→ bom_item_flk → bom_item_mfg
 *   → bom_item_price_snapshot → bom_item_price_tier · bom_erp_item_index(獨立)
 *
 * 注:
 *   - bom_item.final_flk_id 指 bom_item_flk 但「不建 DB FK」(循環 · app 層維護)
 *   - bom_item_price_tier 雙價:true_cost_usd / markup_pct 為 VIRTUAL(只引同表實欄)
 *   - bom_erp_item_index.embedding VECTOR(768,FLOAT32)(既有 kb_chunks 已用 · DB 支援)
 *   - ERP 識別(inventory_item_id/org_id/manufacturer_id)跨庫只存值不建 FK
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013b');

module.exports = async function migrate013b(db) {
  const createTable = async (name, ddl) => {
    try {
      const r = await db.prepare(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`).get(name);
      if (r && Number(Object.values(r)[0]) > 0) return false;
      await db.prepare(ddl).run();
      log.log(`created table ${name}`);
      return true;
    } catch (e) { log.warn(`createTable ${name}:`, e.message); return false; }
  };
  const _idx = async (sql, name) => {
    try { await db.prepare(sql).run(); log.log(`index ${name}`); }
    catch (e) { if (!/already used|already exists|ORA-00955|ORA-01408/.test(e.message)) log.warn(`index ${name}:`, e.message); }
  };

  // ========================================================================
  // bom_instance — BOM 版本主表(case = project)
  // ========================================================================
  await createTable('BOM_INSTANCE', `
    CREATE TABLE bom_instance (
      id                 NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id         NUMBER NOT NULL,
      version_no         NUMBER NOT NULL,
      variant_scope      VARCHAR2(20) DEFAULT 'shared',   -- shared|per_variant
      variant_key        VARCHAR2(40),                    -- NULL(shared)|black/white
      state              VARCHAR2(20) DEFAULT 'DRAFT',    -- DRAFT|LOCKED|SUPERSEDED
      default_org_id     NUMBER,
      default_ledger_id  NUMBER,
      allowed_org_ids    CLOB,                            -- L4 政策過濾 JSON snapshot
      price_period_months NUMBER DEFAULT 12,
      price_strategy     VARCHAR2(10) DEFAULT 'AVG',      -- MIN|AVG|MAX
      editing_user_id    NUMBER,                          -- single-edit lock
      final_locked_by    NUMBER,
      final_locked_at    TIMESTAMP,
      created_at         TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at         TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_bominst_proj FOREIGN KEY (project_id) REFERENCES projects(id)
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_bom_inst ON bom_instance(project_id, version_no, variant_key)`, 'uq_bom_inst');
  await _idx(`CREATE INDEX idx_bom_inst_state ON bom_instance(project_id, state)`, 'idx_bom_inst_state');

  // ========================================================================
  // bom_section — 子總成(含 unified §5 module 層)
  // ========================================================================
  await createTable('BOM_SECTION', `
    CREATE TABLE bom_section (
      id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      bom_instance_id NUMBER NOT NULL,
      module_code     VARCHAR2(40),
      module_category VARCHAR2(8),                         -- EE|ME
      display_order   NUMBER DEFAULT 100,
      name            VARCHAR2(120),
      scope           VARCHAR2(20) DEFAULT 'shared',
      description     CLOB,
      CONSTRAINT fk_bsec_inst FOREIGN KEY (bom_instance_id) REFERENCES bom_instance(id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE INDEX idx_bsec_inst ON bom_section(bom_instance_id, display_order)`, 'idx_bsec_inst');

  // ========================================================================
  // bom_category — 零件類別
  // ========================================================================
  await createTable('BOM_CATEGORY', `
    CREATE TABLE bom_category (
      id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      bom_section_id NUMBER NOT NULL,
      display_order  NUMBER DEFAULT 100,
      name           VARCHAR2(120),
      process_type   VARCHAR2(20),                         -- SMD|DIP|ASSEMBLY
      CONSTRAINT fk_bcat_sec FOREIGN KEY (bom_section_id) REFERENCES bom_section(id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE INDEX idx_bcat_sec ON bom_category(bom_section_id, display_order)`, 'idx_bcat_sec');

  // ========================================================================
  // bom_item — 料件主行(含 WHOOP 料號欄 · final_flk_id 不建 DB FK)
  // ========================================================================
  await createTable('BOM_ITEM', `
    CREATE TABLE bom_item (
      id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      bom_category_id     NUMBER NOT NULL,
      item_sequence       NUMBER,
      qty                 NUMBER(12,4),
      description         CLOB,
      reference           CLOB,
      customer_item       VARCHAR2(120),
      variant_key         VARCHAR2(40),
      final_flk_id        NUMBER,                           -- 指 bom_item_flk(app 層維護 · 不建 DB FK 避循環)
      source_org_id       NUMBER,
      derived_moq         NUMBER,
      derived_lead_time_w NUMBER,
      fpn                 VARCHAR2(80),                     -- WHOOP Foxlink P/N
      wpn                 VARCHAR2(80),                     -- WHOOP Whoop P/N
      consigned_pn        VARCHAR2(80),
      is_customer_specified NUMBER(1) DEFAULT 0,
      lead_time_w         NUMBER,
      CONSTRAINT fk_bitem_cat FOREIGN KEY (bom_category_id) REFERENCES bom_category(id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE INDEX idx_bitem_cat ON bom_item(bom_category_id, item_sequence)`, 'idx_bitem_cat');

  // ========================================================================
  // bom_ai_cache — AI 推薦快取(先於 flk · flk.ai_cache_id FK 到此)
  // ========================================================================
  await createTable('BOM_AI_CACHE', `
    CREATE TABLE bom_ai_cache (
      id                   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      description_hash     VARCHAR2(64),
      allowed_orgs_hash    VARCHAR2(64),
      period_months        NUMBER,
      recommendations      CLOB,
      recommendation_count NUMBER,
      llm_tokens_input     NUMBER,
      llm_tokens_output    NUMBER,
      llm_cost_usd         NUMBER(10,6),
      hit_count            NUMBER DEFAULT 0,
      created_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
      expires_at           TIMESTAMP
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_aicache ON bom_ai_cache(description_hash, allowed_orgs_hash, period_months)`, 'uq_aicache');
  await _idx(`CREATE INDEX idx_aicache_exp ON bom_ai_cache(expires_at)`, 'idx_aicache_exp');

  // ========================================================================
  // bom_item_flk — FLK 料號候選
  // ========================================================================
  await createTable('BOM_ITEM_FLK', `
    CREATE TABLE bom_item_flk (
      id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      bom_item_id      NUMBER NOT NULL,
      display_order    NUMBER DEFAULT 100,
      flk_part_number  VARCHAR2(120),
      inventory_item_id NUMBER,                             -- ERP 跨庫不建 FK
      org_id           NUMBER,
      source           VARCHAR2(20),                        -- RD_MANUAL|AI_RECOMMEND|ERP_LOOKUP
      ai_confidence    NUMBER(5,4),
      ai_cache_id      NUMBER,
      CONSTRAINT fk_flk_item FOREIGN KEY (bom_item_id) REFERENCES bom_item(id) ON DELETE CASCADE,
      CONSTRAINT fk_flk_aicache FOREIGN KEY (ai_cache_id) REFERENCES bom_ai_cache(id)
    )`);
  await _idx(`CREATE INDEX idx_flk_item ON bom_item_flk(bom_item_id, display_order)`, 'idx_flk_item');

  // ========================================================================
  // bom_item_mfg — 替代製造商
  // ========================================================================
  await createTable('BOM_ITEM_MFG', `
    CREATE TABLE bom_item_mfg (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      bom_item_id       NUMBER NOT NULL,
      bom_item_flk_id   NUMBER,
      display_order     NUMBER DEFAULT 100,
      manufacturer_id   NUMBER,                             -- ERP 跨庫不建 FK
      manufacturer_name VARCHAR2(200),
      mfg_part_number   VARCHAR2(120),
      source            VARCHAR2(20),
      is_preferred      NUMBER(1) DEFAULT 0,
      CONSTRAINT fk_mfg_item FOREIGN KEY (bom_item_id) REFERENCES bom_item(id) ON DELETE CASCADE,
      CONSTRAINT fk_mfg_flk FOREIGN KEY (bom_item_flk_id) REFERENCES bom_item_flk(id)
    )`);
  await _idx(`CREATE INDEX idx_mfg_item ON bom_item_mfg(bom_item_id)`, 'idx_mfg_item');

  // ========================================================================
  // bom_item_price_snapshot — 價格 snapshot
  // ========================================================================
  await createTable('BOM_ITEM_PRICE_SNAPSHOT', `
    CREATE TABLE bom_item_price_snapshot (
      id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      bom_item_id      NUMBER NOT NULL,
      bom_item_flk_id  NUMBER,
      period_months    NUMBER,
      strategy_used    VARCHAR2(10),
      price_min_usd    NUMBER(18,6),
      price_avg_usd    NUMBER(18,6),
      price_max_usd    NUMBER(18,6),
      po_line_count    NUMBER,
      vendor_count     NUMBER,
      earliest_po_date DATE,
      latest_po_date   DATE,
      applied_price_usd NUMBER(18,6),
      created_at       TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_psnap_item FOREIGN KEY (bom_item_id) REFERENCES bom_item(id) ON DELETE CASCADE,
      CONSTRAINT fk_psnap_flk FOREIGN KEY (bom_item_flk_id) REFERENCES bom_item_flk(id)
    )`);
  await _idx(`CREATE INDEX idx_psnap_item ON bom_item_price_snapshot(bom_item_id, bom_item_flk_id)`, 'idx_psnap_item');

  // ========================================================================
  // bom_item_price_tier — 價格分級 + 雙價(true/quote · VIRTUAL markup)
  // ========================================================================
  await createTable('BOM_ITEM_PRICE_TIER', `
    CREATE TABLE bom_item_price_tier (
      tier_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      snapshot_id      NUMBER NOT NULL,
      tier_seq         NUMBER,
      qty_min          NUMBER,
      qty_max          NUMBER,
      qty_tier_label   VARCHAR2(40),
      source_currency  VARCHAR2(8),
      true_cost_source NUMBER(15,6),
      fx_rate          NUMBER(15,6),
      true_cost_usd    NUMBER(15,6) GENERATED ALWAYS AS (true_cost_source / NULLIF(fx_rate,0)) VIRTUAL,
      quote_price_usd  NUMBER(15,6),
      markup_pct       NUMBER(10,4) GENERATED ALWAYS AS ((quote_price_usd - (true_cost_source / NULLIF(fx_rate,0))) / NULLIF(quote_price_usd,0)) VIRTUAL,
      is_chosen        NUMBER(1) DEFAULT 0,
      CONSTRAINT fk_ptier_snap FOREIGN KEY (snapshot_id) REFERENCES bom_item_price_snapshot(id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE INDEX idx_ptier_snap ON bom_item_price_tier(snapshot_id, tier_seq)`, 'idx_ptier_snap');

  // ========================================================================
  // bom_erp_item_index — ERP item 向量索引(AI 推薦 cosine search)
  // ========================================================================
  await createTable('BOM_ERP_ITEM_INDEX', `
    CREATE TABLE bom_erp_item_index (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      inventory_item_id NUMBER,
      org_id            NUMBER,
      flk_part_number   VARCHAR2(120),
      description       CLOB,
      description_hash  VARCHAR2(64),
      embedding         VECTOR(768, FLOAT32),
      embedding_model   VARCHAR2(60),
      enabled_flag      VARCHAR2(1),
      item_status       VARCHAR2(40),
      indexed_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      last_seen_at      TIMESTAMP
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_erpidx ON bom_erp_item_index(inventory_item_id, org_id)`, 'uq_erpidx');
  await _idx(`CREATE INDEX idx_erpidx_hash ON bom_erp_item_index(description_hash)`, 'idx_erpidx_hash');

  log.log('migration 013b ✓');
};
