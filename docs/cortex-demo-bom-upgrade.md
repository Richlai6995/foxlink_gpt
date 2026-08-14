# Cortex 互動 Demo — BOM Section 升級建議

> **對象**:demo 設計者 + USER stakeholder review
> **版本**:v1.0 / 2026-06-01
> **目的**:對齊 `bom-architecture-report.md` + `bom-collection-sd.md` v0.3 的新架構,評估 `Cortex_互動Demo_v0.5.html` 內 BOM section 需要哪些修正,讓 demo 看起來能講出真實的 BOM 收集流程,而不是現在那種「Excel 翻拍版」。
> **修改範圍**:純前端展示層(HTML / JS),不動 DB / API,主要是給 USER 看 mockup 用。

---

## 1. 現狀盤點

### 1.1 目前 demo 怎麼呈現 BOM

從 `Cortex_互動Demo_v0.5.html` 拆解:

| 位置 | 行號 | 內容 | 對齊度 |
|---|---|---|---|
| Schema 宣告 | L6690 | `bom` section,12 個 field 包含 `bom_table` 5 欄 sub-schema | ❌ 扁平 |
| `renderFormBOM()` | L9843 | UI 渲染:主料號 / ECN / 規格 / 5 列子料表格 | ❌ 扁平 |
| Stage flow | L5743 | Stage 4 `BOM_PROVIDE`、Stage 6 `BOM_COST_REVIEW` | ✅ 概念對 |
| 任務模板 | L6814 | `epic-bom` 4 個 subtask | ⚠️ 需擴 |
| 聊天討論 | L5982~6053 | 多處提到 EE BOM 共用 / ME BOM 分黑白 / 三廠 MVA / 16 PKG | ✅ 文字對 |
| Variants section | L10482 | ✅ 新增 v0.5(per-variant 表) | ✅ 對齊 |
| Packaging section | L10578 | ✅ 新增 v0.5(16 項 child-table) | ✅ 對齊 |
| NRE section | L10696 | ✅ 新增 v0.5(11 項雙欄) | ✅ 對齊 |
| Factory Matrix section | — | ❓ 尚未在 form switcher 內,有 `factory_matrix_summary` 在 state | ⚠️ 缺 UI |

### 1.2 目前 BOM section 的 5 欄

```js
{ id:'bom_table', label:'BOM 明細表', type:'table', hint:'5 欄 sub-schema' }
```

5 欄是:**子料號/名稱 · 單位 · 數量 · 來源(外購/自製) · 備註**

對比 SD v0.3 的真實架構(`bom_section → bom_category → bom_item → bom_item_flk / bom_item_mfg / bom_item_price_snapshot`),只有最表層的「子料」一層,後面三層(FLK 對齊 / 製造商選項 / 報價快照)全部缺。

### 1.3 落差總結

| 概念 | demo 現狀 | SD v0.3 預期 | 落差等級 |
|---|---|---|---|
| 階層結構 | 扁平表格 | section → category → item → flk/mfg/price | 🔴 高 |
| ERP 料號對齊 | 文字欄位 | AI 候選 + 點採用 | 🔴 高 |
| 製造商選項(多家) | 無 | 子料下可有多個 mfg | 🔴 高 |
| 報價快照(版本/有效期) | 無 | 每個 mfg 下可有多份快照 | 🔴 高 |
| 採購策略選定 | 無 | 子料指定一個 mfg + 一份快照 | 🔴 高 |
| AI 建議按鈕 | 無 | 每列「找 ERP 料號 / 找上次價」 | 🟡 中 |
| DPM Lock 動作 | 無(僅靜態 ✓ DONE) | Lock 按鈕 + audit + propagate 預覽 | 🔴 高 |
| Factory Matrix UI(Excel-style:3 廠 × 2 variants,單一 packaging) | 概念在 state 但 form 內無 section | 完整矩陣 6 個 prime cost + 共用 MVA/SG&A 列 | 🔴 高 |
| Variant 整合(共用 vs per_variant) | 有 variants section 但 BOM 沒標欄位 | BOM 每列標 scope | 🟡 中 |
| Heartbeat 編輯鎖 | 無 | 5 分鐘 heartbeat | 🟢 低(demo 可省) |
| Audit log | 無 | 7 種 event_type | 🟢 低(demo 可省) |

> **📌 重要決策(2026-06-01 USER 確認)**:Packaging **只有一種版本**(對應 §packaging 16 items),三廠共用。原 SD 草稿中的「PKG-A/B/C 三套選項」概念取消,Factory Matrix 維度從 `factory × pkg × variant 三維 = 18 cells` 簡化為 `factory × variant 二維 = 6 prime cost cells`。Excel 中「Option A/B/C」實際上是工廠代號(CN=A / VN=B / TW=C),不是包裝選項。

---

## 2. 修正建議(分三梯次)

### 2.1 梯次一:必改(否則 USER review 看不懂新架構)

| # | 修正項 | 動哪裡 | 工時(demo) |
|---|---|---|---|
| **A1** | BOM section schema 從 5 欄改成「層級化展示」 | L6690~6705 + L9843 | 2h |
| **A2** | 新增「ERP 對齊」欄(顯示 ERP 料號 + 相似度) | L9887 BOM 表 | 1h |
| **A3** | 子料 row 點開展開「製造商選項 + 報價快照」抽屜 | L9896~9935 | 3h |
| **A4** | 新增「採購策略」面板(每子料選定 mfg + 價) | L9843 函式末段 | 2h |
| **A5** | 新增 Factory Matrix section UI | 新增 `renderFormFactoryMatrix()` | 4h |
| **A6** | 「Lock BOM」按鈕(DPM 角色才顯示) + propagate 預覽 modal | section footer | 2h |
| | **小計** | | **14h(2 天)** |

### 2.2 梯次二:建議改(讓 demo 更接近真實流程)

| # | 修正項 | 動哪裡 | 工時(demo) |
|---|---|---|---|
| **B1** | AI 「找 ERP 料號」按鈕 + 候選 modal(3 個假候選) | BOM 表每列 | 2h |
| **B2** | AI 「找上次採購價」按鈕 + 歷史 PO modal | BOM 表每列 | 1h |
| **B3** | Variant scope chip(共用 / Black 專用 / White 專用) | BOM 表每列 | 1h |
| **B4** | BOM 子料對 ERP 失敗的「待建檔」狀態 + DPM 鎖時 flag | BOM 表 | 1h |
| **B5** | Stage 5 `epic-bom` 任務模板擴充(原 4 個 → 8 個) | L6818~6823 | 0.5h |
| | **小計** | | **5.5h(0.7 天)** |

### 2.3 梯次三:可選改(後續迭代)

| # | 修正項 | 工時 |
|---|---|---|
| C1 | ECN(工程變更通知)流程示意 | 1h |
| C2 | BOM 跨案 reuse(同款子料在多案間 share)示意 | 1h |
| C3 | Audit log 抽屜(顯示誰改了什麼) | 1h |
| C4 | Heartbeat 編輯鎖(同時兩人開 BOM 衝突警示) | 1h |
| | **小計** | **4h(0.5 天)** |

---

## 3. 詳細 mockup 規格(梯次一)

### 3.1 A1 — BOM section schema 階層化

#### 改前(L6690)

```js
{
  id: 'bom', name: 'BOM 結構', icon: '📦', order: 2,
  fields: [
    { id:'bom_part_no',  label:'BOM 主料號', type:'text', mono:true },
    { id:'bom_table',    label:'BOM 明細表', type:'table', hint:'5 欄 sub-schema' },
    // ... 其他扁平 fields
  ]
}
```

#### 改後

```js
{
  id: 'bom', name: 'BOM 結構', icon: '📦', order: 2,
  fields: [
    // 案級基本
    { id:'bom_part_no',  label:'BOM 主料號',     type:'text', required:true, mono:true },
    { id:'ecn_version',  label:'ECN 版本',       type:'text', mono:true },
    { id:'spec_desc',    label:'規格說明',       type:'textarea', required:true },
    { id:'bom_lock_state', label:'BOM 狀態',     type:'computed', linked:true,
      hint:'draft / under_review / locked / ecn_pending' },

    // 階層化結構(關鍵改動)
    { id:'bom_sections', label:'BOM 結構樹',     type:'tree', required:true,
      hint:'section → category → item → mfg → price_snapshot 五層',
      ai:true, conf:true },

    // 採購策略(Stage 5 開始填)
    { id:'sourcing_strategy', label:'採購策略總覽', type:'table', required:false,
      hint:'每子料一列:選定 mfg + 報價快照 + 採購決策' },

    // 既有
    { id:'has_consign',  label:'有無客供料',     type:'select', required:true },
    { id:'consign_list', label:'客供料明細',     type:'textarea', cond:true },
    { id:'bom_files',    label:'BOM 附件',       type:'file' },
  ]
}
```

### 3.2 A1 + A3 — `renderFormBOM()` 改寫示意

> 完整實作不在這份 demo 改太細,只給結構性 mockup 讓 USER review 看得懂。

```js
function renderFormBOM(p, editable) {
  const isLocked = p.bom_lock_state === 'locked';
  const isDpm = ['u-mike', 'u-mike-dpm'].includes(state.user.id);

  return `
    ${formSectionHead('BOM 結構', '📦',
      `階層化 · ${p.bom_sections?.length || 3} sections · ${countItems(p)} items · v3 ${isLocked ? '已鎖定' : 'draft'}`,
      isLocked
        ? '<span class="badge-mini badge-green">🔒 LOCKED · DPM Mike · 5/14</span>'
        : '<span class="badge-mini badge-amber">⚠ Draft</span>',
      `
        <button class="btn btn-ghost">📥 匯入 BOM CSV</button>
        <button class="btn btn-ghost">🔍 AI 比對上代案</button>
        ${isDpm && !isLocked
          ? '<button class="btn btn-primary" onclick="openLockModal()">🔒 鎖定 BOM</button>'
          : ''}
      `
    )}

    <!-- 案級基本欄位 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      ${renderField({ label:'BOM 主料號', input:'<input ...>', ... })}
      ${renderField({ label:'ECN 版本',   input:'<input ...>', ... })}
    </div>

    <!-- 階層樹(新) -->
    ${renderBOMTree(p, editable, isLocked)}

    <!-- 採購策略總覽(新) -->
    ${renderSourcingStrategyTable(p, editable, isLocked)}

    ${formFoot()}
  `;
}

// 新函式 1:階層樹
function renderBOMTree(p, editable, isLocked) {
  // SteelSeries 真實 BOM 為例(節選)
  const tree = [
    { type:'section', id:'sec-ee', name:'EE BOM(共用)', scope:'shared', open:true,
      categories: [
        { type:'category', id:'cat-pcb', name:'PCB 主板組', open:true,
          items: [
            { type:'item', id:'itm-001', desc:'Main Board 4L FR4',
              erp_match:{ id:'PCB-MB-4L-FR4-001', score:0.92, source:'mtl_system_items_b' },
              qty:1, unit:'PCS',
              mfgs:[
                { id:'mfg-1', name:'嘉聯益', selected:true, snapshots:[
                  { rfq:'RFQ-2026-0412-A', price:0.85, currency:'USD', valid_until:'2026-08-31', is_chosen:true },
                  { rfq:'RFQ-2025-1108', price:0.92, currency:'USD', valid_until:'2026-01-31', is_chosen:false },
                ]},
                { id:'mfg-2', name:'臻鼎', selected:false, snapshots:[
                  { rfq:'RFQ-2026-0412-B', price:0.79, currency:'USD', valid_until:'2026-09-15', is_chosen:false },
                ]},
              ]},
            { type:'item', id:'itm-002', desc:'USB-C 連接器 24P male',
              erp_match:{ id:'CONN-USB-C-M-AA01', score:0.88 },
              qty:1, unit:'PCS', mfgs:[ /* ... */ ]},
          ]},
        { type:'category', id:'cat-ic', name:'IC 模組', /* ... */ },
      ]},
    { type:'section', id:'sec-me', name:'ME BOM', scope:'per_variant', open:true,
      categories: [
        { type:'category', id:'cat-shell', name:'外殼模組',
          items: [
            { type:'item', desc:'上殼塑膠件',
              variant_scope:'per_variant',
              per_variant:[
                { variant:'black', erp_match:{ id:'SHELL-MS-RIVAL-B-01' }, mfgs:[ ... ]},
                { variant:'white', erp_match:{ id:'SHELL-MS-RIVAL-W-01' }, mfgs:[ ... ]},
              ]},
          ]},
      ]},
    { type:'section', id:'sec-pkg', name:'PKG BOM(共用)', scope:'shared',
      link_to_section:'packaging' /* 跳轉到 §Packaging */ },
  ];

  return `
    <div style="margin-bottom:14px;">
      <div class="ff-label-row">
        <span class="ff-label">BOM 階層結構樹</span>
        <span class="ff-req">*</span>
        <span class="ff-tag-mono">TREE · ${countSections(tree)} sections / ${countItems(tree)} items</span>
      </div>
      <div class="bom-tree">
        ${tree.map(sec => renderTreeSection(sec, editable, isLocked)).join('')}
        ${!isLocked && editable ? '<button class="ff-grid-add">+ 新增 section</button>' : ''}
      </div>
    </div>
  `;
}

// 新函式 2:單一 item 展開時的 mfg + price snapshot 抽屜
function renderItemDetail(item, isLocked) {
  return `
    <div class="bom-item-detail" style="background:#FAFBFC;border-left:3px solid var(--cyan);padding:12px;margin:8px 0 8px 24px;">
      <!-- ERP 對齊狀態 -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        ${item.erp_match
          ? `<span class="badge-mini badge-green">🔗 ERP ${item.erp_match.id} · 相似度 ${(item.erp_match.score*100).toFixed(0)}%</span>
             <button class="btn btn-ghost">查看 ERP 規格</button>`
          : `<span class="badge-mini badge-amber">⚠ 未對齊 ERP</span>
             <button class="btn btn-secondary">🔍 AI 找 ERP 料號</button>`}
      </div>

      <!-- 製造商選項(可多家) -->
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600;">製造商選項(${item.mfgs.length} 家)</div>
      ${item.mfgs.map(mfg => `
        <div class="mfg-row ${mfg.selected ? 'selected' : ''}" style="...">
          <div>
            <span class="mfg-name">${mfg.name}</span>
            ${mfg.selected ? '<span class="badge-mini badge-cyan">採購選定</span>' : ''}
          </div>
          <!-- 報價快照(可多版) -->
          <div class="snapshots">
            ${mfg.snapshots.map(s => `
              <div class="snap-row ${s.is_chosen ? 'chosen' : ''}">
                <span class="mono">${s.rfq}</span>
                <span class="price mono">$${s.price.toFixed(2)} ${s.currency}</span>
                <span class="valid">有效至 ${s.valid_until}</span>
                ${isExpired(s.valid_until) ? '<span class="badge-mini badge-amber">⚠ 已過期</span>' : ''}
                ${s.is_chosen ? '<span class="badge-mini badge-green">✓ 採購選定</span>' : ''}
              </div>
            `).join('')}
            ${!isLocked ? '<button class="btn btn-ghost">+ 新增報價快照</button>' : ''}
          </div>
        </div>
      `).join('')}

      <!-- Variant scope -->
      ${item.variant_scope === 'per_variant' ? `
        <div style="margin-top:8px;font-size:11px;color:var(--muted);">
          ⚙️ Per-Variant: Black 用 ${item.per_variant[0].erp_match?.id} / White 用 ${item.per_variant[1].erp_match?.id}
        </div>
      ` : ''}
    </div>
  `;
}
```

### 3.3 A4 — 採購策略總覽表

```js
function renderSourcingStrategyTable(p, editable, isLocked) {
  // 把所有 item 的 selected mfg + chosen snapshot 撈出來,給採購一覽
  const strategy = flattenSourcingDecisions(p.bom_sections);

  return `
    <div style="margin-bottom:14px;">
      <div class="ff-label-row">
        <span class="ff-label">採購策略總覽</span>
        <span class="ff-help">每子料目前選定的 mfg + 報價</span>
        <span class="ff-tag-mono">${strategy.length} items · ${strategy.filter(s => s.chosen).length} 已決</span>
        ${isLocked ? '<span class="badge-mini badge-green">🔒 已鎖</span>' : ''}
      </div>
      <div class="ff-grid-table" style="grid-template-columns: 2fr 1.2fr 0.8fr 0.8fr 0.8fr 1.5fr;">
        <div class="ff-grid-head">
          <div>子料 / 描述</div>
          <div>選定 Mfg</div>
          <div>單價</div>
          <div>幣別</div>
          <div>有效期</div>
          <div>採購備註</div>
        </div>
        ${strategy.map(s => `
          <div class="ff-grid-row">
            <div class="v-name">${s.desc}</div>
            <div>${s.mfg_name || '<span class="ff-warn">未選定</span>'}</div>
            <div class="v-price mono">${s.price ? '$' + s.price.toFixed(3) : '—'}</div>
            <div>${s.currency || '—'}</div>
            <div class="v-meta">${s.valid_until || '—'} ${isExpired(s.valid_until) ? '⚠' : ''}</div>
            <div class="v-meta">${s.note || ''}</div>
          </div>
        `).join('')}
      </div>
      <div class="ff-meta-row">
        <span class="ff-meta-item">👤 David Chang(採購) · 5/12</span>
        ${!isLocked ? '<button class="btn btn-ghost">📋 AI 推薦最佳策略</button>' : ''}
      </div>
    </div>
  `;
}
```

### 3.4 A5 — Factory Matrix section UI(Excel-style)

新增 `renderFormFactoryMatrix(p, editable)`,加入 form switcher(L9745 附近):

```js
if (section.id === 'factory_matrix') return renderFormFactoryMatrix(p, editable);
```

且需在 `schemas.QUOTE.sections` 加 section 宣告(在 `inquiry` 跟 `cost` 之間):

```js
{
  id: 'factory_matrix', name: '多廠成本矩陣', icon: '🏭', order: 4, conf:true,
  fields: [
    { id:'fm_factories',     label:'參與工廠',          type:'chip',     required:true, hint:'CN/VN/TW · 對應 Excel Option A/B/C' },
    { id:'fm_packaging_ref', label:'Packaging 版本',    type:'text',     required:true, linked:true,
      hint:'§packaging 單一版本 · 跨三廠共用' },
    { id:'fm_mva',           label:'MVA (per factory)', type:'currency', required:true, conf:true },
    { id:'fm_prime_cost',    label:'PRIME COST',        type:'matrix',   required:true, conf:true, ai:true,
      hint:'factory × variant 二維 · 6 個 prime cost · BOM lock 後 Material 自動 propagate' },
    { id:'fm_sga',           label:'SG&A + Profit',     type:'currency', required:true, conf:true, hint:'三廠統一' },
    { id:'fm_total',         label:'Total Cost',        type:'matrix',   conf:true, linked:true, hint:'PRIME + SG&A · 自動計算' },
    { id:'fm_recommended',   label:'AI 推薦組合',        type:'computed', linked:true, ai:true },
  ]
}
```

UI 結構(對齊客戶 RFQ_Cost.xlsx Excel 版面):

```
┌──────────────────────────────┬──────────────┬──────────────┬──────────────┐
│ Retail Packaging             │ Made In CN   │ Made In VN   │ Made In TW   │
│ (單一版本 16 items)          │              │              │              │
│                              │ Option A     │ Option B     │ Option C     │
├──────────────────────────────┼──────────────┼──────────────┼──────────────┤
│ MVA                          │ US$ 1.8558   │ US$ 1.430    │ US$ 3.207    │
│ PRIME COST (Matl+Labor) Black│ US$ 10.373   │ US$ 10.356 ⭐│ US$ 11.840   │
│ PRIME COST (Matl+Labor) White│ US$ 10.588   │ US$ 10.579 ⭐│ US$ 12.055   │
│ SG&A + Profit                │ US$ 0.7500   │ US$ 0.750    │ US$ 0.750    │
├──────────────────────────────┼──────────────┼──────────────┼──────────────┤
│ Total Cost (Ex-Factory) Black│ US$ 11.123   │ US$ 11.106 ⭐│ US$ 12.590   │
│ Total Cost (Ex-Factory) White│ US$ 11.338   │ US$ 11.329 ⭐│ US$ 12.750   │
└──────────────────────────────┴──────────────┴──────────────┴──────────────┘
   ⭐ = 此 variant 最便宜的工廠
```

```js
function renderFormFactoryMatrix(p, editable) {
  const fm = STEELSERIES_FM;
  const factories = fm.factories;       // ['CN', 'VN', 'TW']
  const variantKeys = fm.variant_keys;  // ['black', 'white']

  // 6 個 total · 找最便宜 (cross factory × variant)
  const allCells = factories.flatMap(f => variantKeys.map(v => ({
    factory:f, variant:v, total: fm.byFactory[f][`total_${v}`],
  })));
  const cheapest = [...allCells].sort((a,b) => a.total - b.total)[0];

  // 每 variant 最便宜的工廠 → 整列標 ⭐
  const cheapestByVariant = {};
  variantKeys.forEach(v => {
    cheapestByVariant[v] = factories.reduce((min, f) =>
      fm.byFactory[f][`total_${v}`] < fm.byFactory[min][`total_${v}`] ? f : min, factories[0]);
  });

  // Excel-style rows
  const rows = [
    { label:'MVA', getValue: f => fm.byFactory[f].mva, shared:true, decimals:4 },
    ...variantKeys.map(v => ({
      label: `PRIME COST (Matl + Labor): ${fm.variant_labels[v]}`,
      getValue: f => fm.byFactory[f][`prime_${v}`], variant:v, decimals:3,
    })),
    { label:'SG&A + Profit', getValue: f => fm.byFactory[f].sga, shared:true, decimals:4 },
    ...variantKeys.map(v => ({
      label: `Total Cost (Ex-Factory): ${fm.variant_labels[v]}`,
      getValue: f => fm.byFactory[f][`total_${v}`], variant:v, isTotal:true, decimals:3,
    })),
  ];

  return `
    ${formSectionHead('多廠成本矩陣', '🏭',
      `${factories.length} factories × ${variantKeys.length} variants = ${factories.length*variantKeys.length} prime cost cells · 單一 packaging`,
      '<span class="badge-mini badge-green">✓ 三廠 Cleansheet 已收齊</span>'
    )}

    <!-- Roll-up KPI 卡 (3 個):最便宜組合 / MVA spread / 年量影響 -->
    ...

    <!-- 主矩陣表(Excel 版面)-->
    <table class="matrix-table excel-style">
      <thead>
        <tr>
          <th rowspan="2">Retail Packaging<br>(單一版本)</th>
          ${factories.map(f => `<th>${fm.factory_meta[f].full}</th>`).join('')}
        </tr>
        <tr>
          ${factories.map(f => `<th>Option ${fm.factory_meta[f].option}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr class="${row.isTotal ? 'mt-row-total' : ''}">
            <th>${row.label}</th>
            ${factories.map(f => {
              const val = row.getValue(f);
              const isCheapest = row.isTotal && cheapestByVariant[row.variant] === f;
              return `<td class="${isCheapest ? 'cheapest' : ''}">US$ ${val.toFixed(row.decimals)} ${isCheapest ? '⭐' : ''}</td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
```

點任一 cell → drill-down modal 顯示該 cell 完整 cost breakdown(MVA Labor/OH/Yield 比例 + 11 NRE 攤提 + 採購策略對應 Material 細項)。

### 3.5 A6 — DPM Lock 按鈕 + propagate 預覽

```js
function openLockModal() {
  const propagate = computePropagatePreview(state.project);

  showModal({
    title: '🔒 鎖定 BOM v3.0',
    body: `
      <p>鎖定後,以下變更會自動 propagate:</p>
      <table>
        <thead><tr><th>變更</th><th>受影響 cells</th></tr></thead>
        <tbody>
          <tr><td>Material cost 更新到工廠矩陣</td><td>${propagate.matrix_cells} cells</td></tr>
          <tr><td>採購策略寫入 sourcing_strategy</td><td>${propagate.items} items</td></tr>
          <tr><td>BOM 進唯讀</td><td>所有人(除 admin/DPM)</td></tr>
        </tbody>
      </table>
      <textarea placeholder="鎖定原因 / 簽核版本說明..." required></textarea>
      <div class="warn">⚠ 解鎖會通知 BPM + 業務</div>
    `,
    footer: `
      <button onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="confirmLock()">🔒 確認鎖定</button>
    `
  });
}
```

---

## 4. 不需要動的部份(已經對齊)

| Section | 狀態 |
|---|---|
| `renderFormVariants()` (L10482) | ✅ 已完整,demo 流程 OK |
| `renderFormPackaging()` (L10578) | ✅ 已完整,16 項 child-table 對 |
| `renderFormNRE()` (L10696) | ✅ 已完整,11 項雙欄對 |
| Stage 4 / Stage 6 流程 banner | ✅ 概念對 |
| `factory_matrix_summary` 在 state(L5735) | ✅ 數據在,只缺 form section UI |

---

## 5. 建議 demo 升級路徑

考量這份 demo 是給 USER review 用,**不需要做全部**,給 USER 看完整概念即可:

### 5.1 推薦範圍:**梯次一全做 + 梯次二的 B1/B3**

| 項 | 工時 |
|---|---|
| A1~A6(階層樹 + ERP 對齊 + mfg/snapshot + 採購策略 + Factory Matrix + Lock) | 14h |
| B1(AI 找 ERP 料號) | 2h |
| B3(Variant scope chip) | 1h |
| **小計** | **17h(2.1 天)** |

### 5.2 為什麼不全做

- B2 上次採購價:demo 假資料可塞在 B1 的 modal 內,不單獨開
- B4 待建檔狀態:用顏色標即可,不需獨立流程
- C1~C4:後續迭代,USER review 時不影響核心概念傳達

---

## 6. 假資料準備(沿用 SteelSeries 案)

demo 已有 SteelSeries Rival 3+ 的 variant / factory_matrix / NRE / PKG 假資料,只需:

### 6.1 補一份 BOM 階層樹假資料

```js
// 新增到 state.bom_demo (或某 project 內)
const STEELSERIES_BOM_TREE = [
  {
    section: 'EE BOM(共用)', scope:'shared',
    categories: [
      { name:'PCB 主板組', items: [
        { desc:'Main Board 4L FR4', erp:'PCB-MB-4L-FR4-001', qty:1,
          mfgs:[
            { name:'嘉聯益', selected:true, price:0.85, valid:'2026-08-31', rfq:'RFQ-2026-0412-A' },
            { name:'臻鼎',   selected:false, price:0.79, valid:'2026-09-15', rfq:'RFQ-2026-0412-B' },
          ]},
        { desc:'Touch Board 2L', erp:'PCB-TB-2L-FR4-002', qty:1, mfgs:[ /* ... */ ]},
      ]},
      { name:'IC 模組', items: [
        { desc:'MCU PMW3320', erp:'IC-MCU-PMW3320', qty:1, mfgs:[ /* ... */ ]},
        { desc:'Sensor 16K DPI', erp:'IC-SENS-16K', qty:1, mfgs:[ /* ... */ ]},
      ]},
      { name:'Connector', items: [
        { desc:'USB-C male 24P', erp:'CONN-USB-C-M-AA01', qty:1, mfgs:[ /* ... */ ]},
      ]},
    ],
  },
  {
    section: 'ME BOM', scope:'per_variant',
    categories: [
      { name:'外殼模組', items: [
        { desc:'上殼塑膠', variant_scope:'per_variant',
          per_variant:{
            black: { erp:'SHELL-MS-RIVAL-B-01', mfgs:[/*...*/]},
            white: { erp:'SHELL-MS-RIVAL-W-01', mfgs:[/*...*/]},
          }},
        { desc:'下殼塑膠', variant_scope:'per_variant', /* ... */ },
      ]},
      { name:'按鍵組', items: [
        { desc:'Switch L/R', variant_scope:'shared', erp:'SWT-OMR-D2FC-F-7N(20M)', qty:2, mfgs:[/*...*/]},
        { desc:'Wheel Encoder', variant_scope:'shared', /* ... */ },
      ]},
    ],
  },
  {
    section: 'PKG BOM(共用)', scope:'shared',
    link_to_section:'packaging',  // 跳到既有 §Packaging
  },
];
```

### 6.2 補一份 factory_matrix 假資料(Excel-style byFactory)

> **數值嚴格對齊客戶 RFQ_Cost.xlsx 螢幕截圖**(2026-06-01 USER 確認)。

```js
const STEELSERIES_FM = {
  factories: ['CN', 'VN', 'TW'],
  factory_meta: {
    CN: { full:'Made In China',   option:'A', city:'蘇州廠 · Andy' },
    VN: { full:'Made In Vietnam', option:'B', city:'河內廠 · Long' },
    TW: { full:'Made In Taiwan',  option:'C', city:'新北廠 · Ken'  },
  },
  variant_keys: ['black', 'white'],
  variant_labels: { black:'Black ver.', white:'White ver.' },
  packaging: { version:'Retail Packaging V1', items:16, note:'單一版本 · 三廠共用' },
  byFactory: {
    CN: {
      mva: 1.8558, sga: 0.7500,
      prime_black: 10.373, prime_white: 10.588,
      total_black: 11.123, total_white: 11.338,
      yield: 0.978, lead_time_wk: 6,
    },
    VN: {
      mva: 1.4300, sga: 0.7500,
      prime_black: 10.356, prime_white: 10.579,
      total_black: 11.106, total_white: 11.329,
      yield: 0.954, lead_time_wk: 7,
    },
    TW: {
      mva: 3.2070, sga: 0.7500,
      prime_black: 11.840, prime_white: 12.055,
      total_black: 12.590, total_white: 12.750,
      yield: 0.986, lead_time_wk: 5,
    },
  },
};
```

**結構說明**:

- `factories`:三廠 ID(Excel 中對應 Option A/B/C)
- `variant_keys`:variant 軸(從 §variants 帶入)
- `packaging`:單一 packaging 版本 metadata(對應 §packaging 16 items)
- `byFactory.<f>.mva`:每廠單一 MVA 值(包含 Labor + OH + Yield loss)
- `byFactory.<f>.sga`:每廠 SG&A + Profit(三廠統一,集團政策)
- `byFactory.<f>.prime_<v>`:該廠該 variant 的 PRIME COST(= Matl + Labor)
- `byFactory.<f>.total_<v>`:該廠該 variant 的 Total = PRIME + SG&A

**Roll-up 計算**:

- 最便宜:`min(byFactory.<f>.total_<v>)` 跨 6 個 cell → 此 demo 為 **VN-Black $11.106**
- 三廠 MVA spread:TW $3.21 - VN $1.43 = **$1.78**
- 年量影響(最便宜 vs 最貴):($12.750 - $11.106) × 418K = **+$687K/yr**

---

## 7. USER review 時可以這樣展示

> **建議 demo flow**(讓 USER 5 分鐘看完核心):

1. **打開 SteelSeries 案 → 切到 BOM section**
2. **指出階層樹**:「以前一行字,現在五層 — section / category / item / mfg / snapshot」
3. **點開一個 item**(如 Main Board):「看,這顆零件兩家廠商(嘉聯益 / 臻鼎)各自有報價快照,採購選定嘉聯益的 $0.85 那版」
4. **指出 ERP badge**:「90% 子料系統自動對到 ERP 料號,RD 不用查」
5. **切到 Factory Matrix section**:「對齊客戶 RFQ Excel 版面 — 三廠 × Black/White = 6 個 prime cost,packaging 單一版本(16 項共用),AI 推薦 VN-Black 最便宜($11.106)」
6. **回 BOM → 按 Lock 按鈕**:「DPM 鎖定後,矩陣會自動帶採購選定價,後續變更走 ECN」
7. **指出 Variant tab**:「Black/White 同一份 BOM,共用零件不用維護兩遍」

---

## 8. 不需要 USER review 看到的細節

這些放 SD 即可,demo 上不展示避免複雜:

- DB schema 細節(10 表 + 4 表)
- 向量化 ETL pipeline
- 7-day cache TTL
- Heartbeat 編輯鎖機制
- Audit log 7 種 event_type
- API endpoint 規格
- 資料政策 4 層 filter SQL

---

## 9. 結論

**修正範圍**:純 HTML demo,2.1 工作天

**核心目標**:讓 USER review 時看到「BOM 從 Excel 翻拍 → 結構化系統」的差異,而不是討論技術細節

**不影響**:後端 SD / 真實開發排程,demo 修正獨立於主開發

**配套**:demo 修正完搭配 `bom-architecture-report.md` 一起拿給 USER 看,效果最佳

---

## Appendix — 修改文件清單

| 檔案 | 動哪 | 行數 |
|---|---|---|
| `docs/Cortex_互動Demo_v0.5.html` | schemas.QUOTE.sections.bom 改階層 | L6690~6705 |
| 同上 | schemas.QUOTE.sections 新增 factory_matrix | L6688 後插入 |
| 同上 | taskTemplates.QUOTE.epics.epic-bom subtasks 擴充 | L6818~6823 |
| 同上 | `renderFormBOM()` 改寫 | L9843~9942 |
| 同上 | `renderFormFactoryMatrix()` 新增 | 約 +200 行 |
| 同上 | renderForm switcher 加 factory_matrix | L9745 |
| 同上 | 樣式 `.bom-tree / .matrix-table / .matrix-cell / .mfg-row / .snap-row` 新增 | CSS 段 |
| 同上 | 假資料 STEELSERIES_BOM_TREE + STEELSERIES_FM_CELLS | state 區 |

完。
