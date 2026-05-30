# Multi-Factory Cost Matrix · Schema 設計書(SD)

> **狀態**:v0.1 草稿 · 對齊 spec v0.5 §11.3.8 + bom-collection-sd v0.3 §16
> **日期**:2026-05-30
> **適用**:Cortex 通用專案管理平台 · QUOTE plugin · 三廠對比矩陣模組
> **下游**:Claude Code 實作
> **相關文件**:
>   - [`bom-collection-sd.md`](./bom-collection-sd.md) — BOM 主流程 SD(本文件配套)
>   - [`projects-platform-spec_v0.5.md`](./projects-platform-spec_v0.5.md) §11.3.8 — 主規格章節
>
> ⏳ **開工前置**:[§5 MVA 架構] 6 項待業主確認後跟 BOM 模組同步開工。

---

## 0. TL;DR

把 Phase 1-3 ship 的 `project.data_payload.factory_matrix` JSON CLOB **升級成 4 張 Oracle 23 AI 關聯表**:

```
project_factory_matrix      ← 主表 · 每 project × version 一張
  ├ pfm_factory            ← 廠別軸 · 含 MVA + erp_org_id(連動 BOM 價格聚合)
  ├ pfm_pkg_option         ← 包裝軸 · 含 pkg_cost
  └ pfm_cell               ← cell flat 表 · 3×3×N variant 鋪平
```

- **不影響 Phase 1-3 已 ship 的 demo**:API 自動 fallback 看 `data_payload.factory_matrix` JSON
- **新案 / DPM lock BOM 後**:寫進 4 表 · `pfm_cell.material_cost` 自動從 BOM SUM propagate
- **變體 / 廠擴充 / version chain / cell-level audit** 都能做(JSON CLOB 做不到)
- 工時 **4-5 天**(1 migration + 1 service + 1 component 改寫 + 1 propagate hook + test)

---

## 1. 為何要從 JSON CLOB 升級

### 1.1 Phase 1-3 現況(SteelSeries seed 對應)

```json
// project.data_payload.factory_matrix (CLOB JSON)
{
  "axes": { "factory": ["CN","VN","TW"], "pkg_option": ["A","B","C"] },
  "mandatory_factory": null,
  "recommended": { "factory": "CN", "pkg_option": "A" },
  "cheapest": { "factory": "VN", "pkg_option": "B", "value": 11.02 },
  "spread": 1.58,
  "cells": {
    "black": {
      "CN-A": 11.12, "CN-B": 11.11, "CN-C": 12.59,
      "VN-A": 11.12, "VN-B": 11.02, "VN-C": 12.59,
      "TW-A": 11.12, "TW-B": 11.02, "TW-C": 12.60
    },
    "white": {
      "CN-A": 11.34, "CN-B": 11.33, "CN-C": 12.75,
      "VN-A": 11.34, "VN-B": 11.24, "VN-C": 12.82,
      "TW-A": 11.34, "TW-B": 11.25, "TW-C": 12.82
    }
  },
  "mva": { "CN": 1.86, "VN": 1.43, "TW": 3.00 },
  "sga_profit": 0.75,
  "suggested_quote": 11.87,
  "annual_revenue": 4956000
}
```

### 1.2 JSON CLOB 9 個結構問題

| 維度 | JSON CLOB | 4 表升級後 |
|---|---|---|
| Version chain | ❌ 無 · 改了沒紀錄 | ✅ `version_no` UNIQUE |
| BOM 連動 | ❌ ad-hoc 寫死 JSON 欄位 · 沒 FK | ✅ `bom_instance_id` FK · cell 級 `material_cost_source` |
| Audit cell-level | ❌ 整 JSON 改了不知道是哪格 | ✅ per cell `material_cost_updated_at` + `pfm_cell_audit` |
| 跨 project 統計 | ❌ 要 parse N 個 JSON | ✅ SQL aggregate(`SELECT factory_code, AVG(material_cost) FROM pfm_cell ...`)|
| Variant 整合 | 結構固定 `black` / `white` 寫死 | ✅ `variant_key` 任意字串 · 動態擴充 |
| 廠別擴充(加 IN/MX) | 改 `axes.factory` + 補全所有 cell | INSERT `pfm_factory` row + cells 自動 |
| Lock 狀態 | ❌ 無 state · 改了沒 lock | ✅ `state=LOCKED` · `locked_by`/`locked_at` |
| 機密 mask | 整 JSON mask 粗暴(全 cell 看 / 全 cell 罩) | ✅ per cell 細緻(可單獨機密某 variant 某廠某 PKG) |
| Phase 2 form engine 整合 | 要重新搬資料進 `qp_form_field_values` | ✅ 直接對應 `data_type=matrix` field 的 underlying table |

---

## 2. 4 張表 Schema(Oracle 23 AI)

### 2.1 階層

```
project_factory_matrix
  ├ 1..N pfm_factory(廠別軸)
  ├ 1..N pfm_pkg_option(包裝軸)
  └ N×M×V pfm_cell(廠 × 包裝 × variant)
```

### 2.2 表 1 · `project_factory_matrix`(主表)

```sql
CREATE TABLE project_factory_matrix (
  id                        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id                NUMBER NOT NULL,
  version_no                NUMBER NOT NULL DEFAULT 1,

  -- BOM 連動(DPM lock BOM 後 propagate material_cost 進來)
  bom_instance_id           NUMBER REFERENCES bom_instance(id),
                                                          -- 可 NULL = manual 編輯(未連動 BOM)

  -- 客戶指定廠(若有)
  mandatory_factory_code    VARCHAR2(20),                  -- CN / VN / TW / NULL=未指定

  -- 推薦組合
  recommended_factory_code  VARCHAR2(20),
  recommended_pkg_code      VARCHAR2(20),

  -- 全 matrix 共用 settings
  sga_profit_per_unit       NUMBER(10,4),                  -- $0.75 / unit
  suggested_quote_per_unit  NUMBER(10,4),                  -- $11.87 / unit · 推薦售價(草)
  annual_quantity           NUMBER(12,2),                  -- 418000 · 從 project.data_payload.quantity 帶
  annual_revenue            NUMBER(18,2),                  -- 計算欄:qty × suggested_quote = 4.96M

  -- Lock / state
  state                     VARCHAR2(20) DEFAULT 'DRAFT',  -- DRAFT / LOCKED / SUPERSEDED
  locked_by                 NUMBER,
  locked_at                 TIMESTAMP,

  -- Audit
  created_at                TIMESTAMP DEFAULT SYSTIMESTAMP,
  created_by                NUMBER NOT NULL,
  updated_at                TIMESTAMP DEFAULT SYSTIMESTAMP,

  CONSTRAINT uq_pfm UNIQUE (project_id, version_no),
  CONSTRAINT chk_pfm_state CHECK (state IN ('DRAFT', 'LOCKED', 'SUPERSEDED'))
);

CREATE INDEX idx_pfm_project ON project_factory_matrix(project_id, version_no DESC);
```

### 2.3 表 2 · `pfm_factory`(廠別軸 · 含 MVA)

```sql
CREATE TABLE pfm_factory (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matrix_id           NUMBER NOT NULL REFERENCES project_factory_matrix(id) ON DELETE CASCADE,
  display_order       NUMBER NOT NULL,

  factory_code        VARCHAR2(20) NOT NULL,             -- CN / VN / TW / IN / MX
  factory_name        VARCHAR2(120),                       -- 中國 / 越南 / 台灣
  country_iso         VARCHAR2(3),                         -- CHN / VNM / TWN(便利報表 GROUP BY)

  -- ⭐ MVA(Manufacturing Value Add · 轉換成本 · per unit USD)
  -- ⏳ 細度依 §5 MVA-2 業主決定:單一欄 OR 拆 Labor/Equipment/Overhead 3 欄
  mva_per_unit        NUMBER(10,4),                       -- 1.86 / 1.43 / 3.00(預設只存合計)
  mva_labor           NUMBER(10,4),                       -- (optional · MVA-2 拆細時填)
  mva_equipment       NUMBER(10,4),                       -- (optional)
  mva_overhead        NUMBER(10,4),                       -- (optional)
  mva_source          VARCHAR2(40),                       -- 'cleansheet_CN' / 'manual' / 'erp_cost_rollup'
                                                          -- (⏳ MVA-1 決定可選值)

  -- ⭐ ERP organization_id(連動 BOM §3.2.4 價格聚合)
  -- 跟 BOM 共用 ORG 概念:同 factory_code 對應的 ORG 就是 BOM 撈 PO 用的 org_id
  erp_org_id          NUMBER,                              -- 對應 ERP mtl_system_items_b.organization_id
                                                          -- e.g. CN=83 / VN=2463 / TW=1101

  notes               CLOB,

  CONSTRAINT uq_pfm_factory UNIQUE (matrix_id, factory_code)
);

CREATE INDEX idx_pfm_factory_org ON pfm_factory(erp_org_id);
```

### 2.4 表 3 · `pfm_pkg_option`(包裝方案軸)

```sql
CREATE TABLE pfm_pkg_option (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matrix_id           NUMBER NOT NULL REFERENCES project_factory_matrix(id) ON DELETE CASCADE,
  display_order       NUMBER NOT NULL,

  pkg_code            VARCHAR2(20) NOT NULL,             -- A / B / C
  pkg_name            VARCHAR2(120),                       -- 標準包裝 / 減塑版 / FSC premium

  -- pkg cost(per unit · USD)· 對齊 v0.5 §11.3.7 Packaging 加總
  pkg_cost_per_unit   NUMBER(10,4),                       -- 對應 data_payload.packaging.total_per_unit
  pkg_source          VARCHAR2(40),                       -- 'data_payload.packaging' / 'manual'
                                                          -- 'packaging_template:Mouse_v1'

  notes               CLOB,

  CONSTRAINT uq_pfm_pkg UNIQUE (matrix_id, pkg_code)
);
```

### 2.5 表 4 · `pfm_cell`(矩陣 cell · flat)

```sql
CREATE TABLE pfm_cell (
  id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matrix_id                NUMBER NOT NULL REFERENCES project_factory_matrix(id) ON DELETE CASCADE,
  factory_id               NUMBER NOT NULL REFERENCES pfm_factory(id) ON DELETE CASCADE,
  pkg_option_id            NUMBER NOT NULL REFERENCES pfm_pkg_option(id) ON DELETE CASCADE,

  -- ⭐ Variant(對齊 v0.5 §11.3.5)
  variant_key              VARCHAR2(64),                   -- NULL = 全 variant 共用 / 'black' / 'white'

  -- 三層 cost(per unit · USD)— 加法層次
  material_cost            NUMBER(10,4),                   -- BOM 加總:SUM(qty × applied_price_usd)
  prime_cost               NUMBER(10,4),                   -- = material + factory.mva_per_unit
  total_cost_exfactory     NUMBER(10,4),                   -- = prime + matrix.sga_profit + pkg.cost

  -- Source tracking(audit)
  material_cost_source     VARCHAR2(80),                   -- 'bom_instance:#123' / 'manual:user#5'
  material_cost_updated_at TIMESTAMP,
  prime_cost_recalculated_at TIMESTAMP,                    -- factory.mva 改變時 trigger

  -- 標記(自動計算)
  is_min_in_variant        NUMBER(1) DEFAULT 0,            -- 此 variant 內最低 cell ✓ MIN

  -- 機密 mask(per cell · 對齊 spec §17)
  -- ⏳ Phase 2 用 · Phase 1 共用 matrix 級機密
  is_confidential_cell     NUMBER(1) DEFAULT 0,            -- 單一 cell 機密(罕見)

  notes                    CLOB,

  CONSTRAINT uq_pfm_cell UNIQUE (matrix_id, factory_id, pkg_option_id, variant_key)
);

CREATE INDEX idx_pfm_cell_lookup ON pfm_cell(matrix_id, variant_key);
CREATE INDEX idx_pfm_cell_factory ON pfm_cell(factory_id);
CREATE INDEX idx_pfm_cell_bom_source ON pfm_cell(material_cost_source);  -- BOM 反查
```

---

## 3. BOM lock 後 propagate flow(本 SD 核心)

### 3.1 觸發點

`bom_instance.state` 從 `DRAFT` → `LOCKED` 時(DPM 點 lock final),trigger 跑 propagate:

```javascript
// pseudo · bomService.lockFinal(bomInstanceId, user)
async function lockFinal(bomInstanceId, user) {
  await db.beginTransaction();
  try {
    await updateBomInstanceState(bomInstanceId, 'LOCKED', user);
    await propagateToFactoryMatrix(bomInstanceId, user);   // ⭐ 本 SD §3.2
    await writeAudit('final_locked', { bom_instance_id });
    await db.commit();
  } catch (e) {
    await db.rollback();
    await writeAudit('final_locked_failed', { bom_instance_id, error: e.message });
    throw e;
  }
}
```

**rollback 規則**:propagate 失敗 → BOM lock 也回滾(避免 factory_matrix 帶舊 cost)。

### 3.2 Propagate SQL(每 variant × factory × pkg 一筆 UPDATE)

```sql
-- 步驟 1:material_cost 從 BOM SUM 算出
-- 對每 (variant_key, factory_id, pkg_option_id) 組合
MERGE INTO pfm_cell c
USING (
  -- 算 SUM(qty × applied_price) per variant per factory(對應 erp_org_id)
  SELECT
    pfm.matrix_id,
    pfm.id   AS factory_id,
    bi.variant_key,
    SUM(bi.qty * COALESCE(bips.applied_price_usd, 0)) AS material_cost_calc
  FROM   bom_instance bom_inst
  JOIN   bom_category bc        ON bc.bom_section_id IN (
                                   SELECT id FROM bom_section WHERE bom_instance_id = bom_inst.id)
  JOIN   bom_item bi            ON bi.bom_category_id = bc.id
  LEFT JOIN bom_item_price_snapshot bips
                                ON bips.bom_item_id = bi.id
                               AND bips.id = (
                                     SELECT MAX(s.id) FROM bom_item_price_snapshot s
                                      WHERE s.bom_item_id = bi.id
                                          AND s.bom_item_flk_id = bi.final_flk_id
                                   )
  JOIN   pfm_factory pfm        ON pfm.erp_org_id = bi.source_org_id
  WHERE  bom_inst.id = :bom_instance_id
    AND  pfm.matrix_id = :matrix_id
  GROUP BY pfm.matrix_id, pfm.id, bi.variant_key
) src
ON (c.matrix_id  = src.matrix_id
AND c.factory_id = src.factory_id
AND (c.variant_key = src.variant_key OR (c.variant_key IS NULL AND src.variant_key IS NULL)))
WHEN MATCHED THEN UPDATE SET
  c.material_cost = src.material_cost_calc,
  c.material_cost_source = 'bom_instance:' || :bom_instance_id,
  c.material_cost_updated_at = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT (matrix_id, factory_id, pkg_option_id, variant_key, material_cost,
                              material_cost_source, material_cost_updated_at)
  VALUES (src.matrix_id, src.factory_id,
          (SELECT id FROM pfm_pkg_option WHERE matrix_id = src.matrix_id AND display_order = 1),
          src.variant_key, src.material_cost_calc,
          'bom_instance:' || :bom_instance_id, SYSTIMESTAMP);

-- 步驟 2:prime_cost = material + factory.mva_per_unit
UPDATE pfm_cell c
SET    c.prime_cost = c.material_cost
                    + NVL((SELECT mva_per_unit FROM pfm_factory WHERE id = c.factory_id), 0),
       c.prime_cost_recalculated_at = SYSTIMESTAMP
WHERE  c.matrix_id = :matrix_id;

-- 步驟 3:total_cost_exfactory = prime + matrix.sga_profit + pkg.cost
UPDATE pfm_cell c
SET    c.total_cost_exfactory = c.prime_cost
                              + NVL((SELECT sga_profit_per_unit FROM project_factory_matrix WHERE id = c.matrix_id), 0)
                              + NVL((SELECT pkg_cost_per_unit FROM pfm_pkg_option WHERE id = c.pkg_option_id), 0)
WHERE  c.matrix_id = :matrix_id;

-- 步驟 4:標記 is_min_in_variant
UPDATE pfm_cell c
SET    c.is_min_in_variant = CASE
         WHEN c.total_cost_exfactory = (
                SELECT MIN(c2.total_cost_exfactory) FROM pfm_cell c2
                 WHERE c2.matrix_id = c.matrix_id
                   AND (c2.variant_key = c.variant_key
                        OR (c2.variant_key IS NULL AND c.variant_key IS NULL))
              ) THEN 1
         ELSE 0
       END
WHERE  c.matrix_id = :matrix_id;
```

### 3.3 跨 variant_key 規則

| BOM `variant_key` | factory_matrix 對應 cell |
|---|---|
| NULL (shared BOM 全 variant 共用)| 寫進 cell where `variant_key IS NULL`(若有)· 否則寫進**每個** variant cell(同值)|
| 'black'(per_variant BOM 黑色版)| 只寫 `pfm_cell WHERE variant_key='black'` |
| 'white' | 同上 white |

### 3.4 跨 factory 規則(BOM `source_org_id` 反查)

`bom_item.source_org_id` ↔ `pfm_factory.erp_org_id` 對應:
- BOM item ORG=83 → 寫進 `pfm_factory WHERE erp_org_id=83` 那一列的 cells
- BOM item ORG 不在任何 `pfm_factory.erp_org_id` 內 → 寫 audit warn(不寫 cell)
- 多個 BOM item 同 ORG → SUM 加起來
- BOM item 同時對應多 ORG(罕見)→ 取 `source_org_id` 那個

### 3.5 audit 寫入

```sql
-- 對應 bom_audit_log 既有設計(本 SD §6)
INSERT INTO bom_audit_log
  (bom_instance_id, event_type, event_payload, actor_user_id, occurred_at)
VALUES
  (:bom_instance_id, 'factory_matrix_propagated',
   JSON_OBJECT(
     'matrix_id': :matrix_id,
     'cells_updated': :cells_updated,
     'min_total_before': :prev_min,
     'min_total_after': :new_min,
     'delta': :new_min - :prev_min
   ),
   :user_id, SYSTIMESTAMP);
```

---

## 4. UI 整合(FactoryMatrixSection.tsx 改寫)

### 4.1 改寫策略

當前 `client/src/pages/ProjectsPlatform/WarRoom/Form/FactoryMatrixSection.tsx`(Phase 1-3 ship)從 `project.data_payload.factory_matrix` 讀。改成:

```typescript
// 改寫後:打新 API
const { data } = useQuery({
  queryKey: ['factory-matrix', project.id],
  queryFn: () => api.get(`/api/projects/${project.id}/factory-matrix`),
});

// 渲染邏輯不變(spread / cells / variant tab / recommended)— 資料 shape 維持兼容
```

### 4.2 API backward compat

`GET /api/projects/{pid}/factory-matrix` 內部邏輯:

```javascript
async function getFactoryMatrix(projectId) {
  // 1. 先看新表
  const matrix = await db.prepare(
    `SELECT * FROM project_factory_matrix WHERE project_id = ? AND state != 'SUPERSEDED'
      ORDER BY version_no DESC FETCH FIRST 1 ROWS ONLY`
  ).get(projectId);

  if (matrix) {
    // 從 4 表 join 組裝回 JSON shape(跟 data_payload 相同 schema)
    return await assembleFromTables(matrix.id);
  }

  // 2. fallback 看舊 JSON
  const project = await db.prepare(`SELECT data_payload FROM projects WHERE id = ?`).get(projectId);
  const payload = JSON.parse(project?.data_payload || '{}');
  return payload?.factory_matrix || null;
}
```

**好處**:Phase 1-3 demo seed 不破 · SteelSeries 案維持原 JSON 顯示 · 新案開始走 4 表。

### 4.3 Socket push

DPM lock BOM → propagate 成功 → server `socketService.emit` 推給 channel 內所有 user:

```javascript
sock.emitFactoryMatrixUpdated(projectId, { matrix_id, cells_updated, version_no });
```

Client 收到 → re-fetch `/api/projects/{pid}/factory-matrix` → UI 即時更新。

### 4.4 機密 mask(per cell)

Phase 1 沿用 matrix 級 mask:
```typescript
const masked = isConf && !isHostOrAdmin;
// → 全 cell display ▒▒▒ / 或全 cell 明文
```

Phase 2(若需要)走 `pfm_cell.is_confidential_cell` 細粒度:
- 某 cell 機密度高(e.g. 某廠成本)單獨 mask
- 其他 cell 明文

---

## 5. ⏳ MVA 架構 6 項待業主確認

| # | 問題 | 影響 schema | 影響工時 |
|---|---|---|---|
| **MVA-1** | **MVA source**:cleansheet upload / ERP cost rollup / manual 哪個? | `pfm_factory.mva_source` enum 可選值 | 1-3 天(若 ERP rollup 要寫 SQL)|
| **MVA-2** | **MVA components 細度**:Labor / Equipment / Overhead 拆 3 欄 vs 單一 `mva_per_unit`? | `pfm_factory` 加 3 子欄 OR 保留 1 欄 | 0.5 天 |
| **MVA-3** | **MVA per variant**(色噴塗工時 black/white 不同)?| 新增 `pfm_factory_mva_variant`(matrix × factory × variant_key)| 1-2 天 |
| **MVA-4** | **MVA per pkg option**(包裝組裝工時)?| 新增 `pfm_factory_mva_pkg`(matrix × factory × pkg_option_id)| 1-2 天 |
| **MVA-5** | **MVA version chain**:跟 BOM 同步 lock 嗎? | 加 `pfm_mva_version` 或 `project_factory_matrix.mva_version_no` | 1 天 |
| **MVA-6** | **MVA 來源 ERP SQL**:若走 ERP rollup,SQL 怎麼寫? | `mvaErpService.js` 新檔 | 1-2 週(複雜)|

### 5.1 三個推薦設計選項(待業主拍)

#### 選項 1 · 最簡(MVA-2 維持 1 欄 / MVA-3,4 不做)
- `pfm_factory.mva_per_unit` 單一欄
- MVA 全 variant / 全 pkg 共用
- 適合:**業務經驗中 black/white 差不多 + 包裝對工時影響小**
- 工時 +0 天(維持本 SD 設計)

#### 選項 2 · 中度(MVA-2 拆 3 欄 + MVA-5 version chain)
- `pfm_factory.mva_labor / equipment / overhead` 3 欄
- MVA 仍全 variant 共用
- 加 `mva_version_no` 跟 matrix 同步
- 工時 +2 天

#### 選項 3 · 完整(全部 MVA-1 ~ MVA-6)
- 3 欄細度 + per variant + per pkg + version chain + ERP rollup SQL
- 適合:**真實 cleansheet 模型** + 需要月度 refresh
- 工時 +1.5 ~ 2 週

### 5.2 我建議走選項 1 開工 · 之後升級

理由:
- SteelSeries seed 顯示 MVA 看起來是「每廠一個合計值」(CN=1.86 / VN=1.43 / TW=3.00)
- 業務 demo 階段不需要 per variant / per pkg 細度
- Schema 預留 `mva_labor / equipment / overhead` 欄位但 NULL · 升級時不破壞
- 業主想升選項 2/3 隨時 alter table 加欄即可

---

## 6. Audit Log

複用 `bom_audit_log`(本 SD §6 / bom-collection-sd §9.5)· 加新 event_type:

| event_type | 何時 | payload |
|---|---|---|
| `factory_matrix_created` | 建新 matrix | `{ matrix_id, version_no, source: 'manual'|'cloned_from_v#' }` |
| `factory_matrix_cell_updated` | 改單 cell | `{ matrix_id, cell_id, field, from, to }` |
| `factory_matrix_propagated` | BOM lock 觸發 propagate | `{ matrix_id, bom_instance_id, cells_updated, delta }` |
| `factory_matrix_locked` | DPM lock | `{ matrix_id, locked_by }` |
| `factory_matrix_recommended_changed` | 改 recommended | `{ matrix_id, from, to }` |
| `mva_updated` | 改 pfm_factory.mva_* | `{ matrix_id, factory_id, from, to, source }` |
| `pkg_cost_updated` | 改 pfm_pkg_option.pkg_cost | `{ matrix_id, pkg_option_id, from, to }` |

---

## 7. API Endpoints

### 7.1 主流

| Method | Endpoint | 說明 |
|---|---|---|
| GET | `/api/projects/{pid}/factory-matrix` | 取最新 active matrix(state != SUPERSEDED)· 自動 fallback JSON |
| GET | `/api/projects/{pid}/factory-matrix/versions` | 列所有 version |
| POST | `/api/projects/{pid}/factory-matrix` | 建新 matrix(可從現有 version clone)|
| PATCH | `/api/projects/{pid}/factory-matrix/{mid}` | 改主表 settings(sga_profit / mandatory_factory / recommended)|
| POST | `/api/projects/{pid}/factory-matrix/{mid}/lock` | DPM lock final |
| POST | `/api/projects/{pid}/factory-matrix/{mid}/unlock` | admin 解鎖 → 建新 version |

### 7.2 軸 / cell 維護

| Method | Endpoint | 說明 |
|---|---|---|
| POST | `/api/projects/{pid}/factory-matrix/{mid}/factories` | 加新廠(IN/MX 等)|
| PATCH | `/api/projects/{pid}/factory-matrix/{mid}/factories/{fid}` | 改 MVA / erp_org_id |
| DELETE | `/api/projects/{pid}/factory-matrix/{mid}/factories/{fid}` | 移除廠(cascade 對應 cells)|
| POST | `/api/projects/{pid}/factory-matrix/{mid}/pkg-options` | 加新包裝方案 |
| PATCH | `/api/projects/{pid}/factory-matrix/{mid}/pkg-options/{poid}` | 改 pkg_cost |
| PATCH | `/api/projects/{pid}/factory-matrix/{mid}/cells/{cid}` | 改單 cell(只在 DRAFT state)|

### 7.3 BOM propagate

| Method | Endpoint | 說明 |
|---|---|---|
| POST | `/api/projects/{pid}/factory-matrix/{mid}/propagate-from-bom` | 手動觸發(body: `{ bom_instance_id }`)· 自動觸發見 §3 |
| GET | `/api/projects/{pid}/factory-matrix/{mid}/propagate-preview` | 預覽 propagate 結果不寫入(query: `bom_instance_id`)|

### 7.4 Audit

| Method | Endpoint | 說明 |
|---|---|---|
| GET | `/api/projects/{pid}/factory-matrix/{mid}/audit` | cell-level audit log(支援 event_type filter)|

---

## 8. Migration 策略

### 8.1 Migration script 順序

```javascript
// migrations/0XX_factory_matrix.js
// 注:具體 number 跟 BOM SD migration 一起決定(預估 012-015 連號)

// 1. 建 4 張表
await createTable('PROJECT_FACTORY_MATRIX', ...)
await createTable('PFM_FACTORY', ...)
await createTable('PFM_PKG_OPTION', ...)
await createTable('PFM_CELL', ...)

// 2. 建 index
await _idx(`CREATE INDEX idx_pfm_project ON project_factory_matrix(project_id, version_no DESC)`)
// ...

// 3. ⚠ 注意:不主動把舊 data_payload.factory_matrix JSON 轉進 4 表
//   (Phase 1 demo seed 不破 · API 自動 fallback)
//   若想主動轉:寫 one-off script,scan project_id WHERE data_payload LIKE '%factory_matrix%' 然後 INSERT 4 表
```

### 8.2 Backward compat 期(3-6 月)

- 新案直接寫 4 表 · 不再寫 `data_payload.factory_matrix`
- 舊案維持 `data_payload.factory_matrix` JSON
- API `GET` 自動 fallback(§4.2)
- 業主決定要不要 batch migrate 舊案進 4 表 → 寫 one-off script

### 8.3 不破 Phase 1-3 demo

`Q-2026-DEMO-009-SS` SteelSeries 案的 `data_payload.factory_matrix` JSON **不動**:
- 跑 `seed-demo-data.js` 仍然產 JSON CLOB
- `GET /api/projects/61/factory-matrix` 自動 fallback 回 JSON
- 想驗 4 表升級 → 用新建的非 demo case

---

## 9. Phase 規劃 & 工時(對齊 bom-collection-sd v0.3 §16.6)

| Phase | 工時 | 內容 |
|---|---|---|
| **Phase 1 已 ship** | — | JSON CLOB · FactoryMatrixSection.tsx · seed |
| **Phase 1 末 / Phase 2 初**(本 SD 範圍)| **4-5 天** | migration 4 表 + factoryMatrixService.js + propagate hook + API endpoints + UI 改寫 |
| **同期**(若 MVA 業主拍選項 2/3)| +2 天 ~ +2 週 | MVA 細度 / per variant / per pkg / version chain |

### 9.1 4-5 天細部切

| 天 | 內容 |
|---|---|
| Day 1 | migration 4 表 + index + audit event 補進 `bom_audit_log` enum |
| Day 2 | `factoryMatrixService.js` CRUD + assembleFromTables(API fallback)|
| Day 3 | propagate service §3 SQL + socket emit |
| Day 4 | `routes/factoryMatrix.js` 端點全套 + integration test |
| Day 5 | UI `FactoryMatrixSection.tsx` 改寫 + socket subscribe + smoke test |

---

## 10. 風險

| 風險 | 影響 | 緩解 |
|---|---|---|
| MVA 6 項未拍板就開工 | schema 跑去要 alter 多次 | **本 SD 規範 MVA-1 拍板才開工**(bom-sd §16.5 同步)|
| BOM `source_org_id` 對不上任何 `pfm_factory.erp_org_id` | propagate 寫不進 cell · 採購困惑 | audit 寫 warn + UI 提示「BOM ORG 不在矩陣廠列表 · 請補加廠」 |
| 同 ORG 同時對應多 factory_code(罕見) | propagate 寫進多 cell · 重複算 | UNIQUE `pfm_factory(matrix_id, erp_org_id)` constraint 阻擋 |
| Phase 1-3 demo seed 跑去重 build | data_payload.factory_matrix 跟新表雙寫 | API 一律先讀新表 · seed 不寫新表 |
| Cell-level audit 量大(每 BOM lock 18 行)| `bom_audit_log` 增長快 | 對 `factory_matrix_propagated` event 用 SUM 紀錄不 per-cell 寫 audit |

---

## 11. 與 Phase 2 form engine 整合(展望)

當 Phase 2 spec §11 form template engine 上線(`qp_form_*` 表),本 SD 4 表可作為 `data_type=matrix` field 的 **underlying storage**:

```
qp_form_template_fields
  data_type = 'matrix'
  config_json = {
    "underlying_tables": {
      "matrix": "project_factory_matrix",
      "axis_1": "pfm_factory",
      "axis_2": "pfm_pkg_option",
      "cell": "pfm_cell"
    },
    "axes": [
      { "key": "factory", "from_table": "pfm_factory", "label_field": "factory_name" },
      { "key": "pkg_option", "from_table": "pfm_pkg_option", "label_field": "pkg_name" }
    ],
    "cells": [
      { "key": "material_cost", "data_type": "currency", "is_confidential_default": true },
      { "key": "total_cost_exfactory", "data_type": "currency" }
    ]
  }
```

→ Form engine 直接消費 · 不重搬資料。

---

## 12. TBD 清單(15 項 · 對齊 bom-sd §15)

| # | 問題 | 章 |
|---|---|---|
| 1 | MVA-1 source | §5 |
| 2 | MVA-2 components 細度 | §5 |
| 3 | MVA-3 per variant | §5 |
| 4 | MVA-4 per pkg | §5 |
| 5 | MVA-5 version chain | §5 |
| 6 | MVA-6 ERP rollup SQL | §5 |
| 7 | `pfm_factory.factory_code` 跟 ERP `hr_organization_units.short_code` 對應規則(自動 / 手動)| §2.3 |
| 8 | 新建 matrix 時是否自動帶 3 廠 / 3 PKG 預設(SteelSeries case)?還是空白讓 PM 自填? | §7 |
| 9 | `pfm_pkg_option.pkg_cost_per_unit` 是否自動從 `data_payload.packaging.total_per_unit` 帶 · 採購可改? | §2.4 |
| 10 | DPM unlock → 自動 SUPERSEDED 舊 version + 建 v(N+1)還是 in-place 改? | §7 |
| 11 | propagate 預覽 endpoint 是否要回「對 suggested_quote 影響」估算? | §7.3 |
| 12 | 舊案 batch migrate 進 4 表的時機 / 方式 | §8.2 |
| 13 | per-cell `is_confidential_cell` 是否 Phase 1 就上,還是 Phase 2 才上? | §4.4 |
| 14 | 廠擴充(加 IN/MX/JP)後對 SQL propagate 需要對齊 BOM `source_org_id` mapping 流程 | §3.4 |
| 15 | 跨 project 共用同一組 MVA(集團統一)還是每 project 獨立?(spec 沒明說) | §2.3 |

---

— End of factory-matrix-schema-sd v0.1 —

Cortex 規劃小組 · 2026-05-30 · 對齊 spec v0.5 §11.3.8 + bom-collection-sd v0.3 §16
