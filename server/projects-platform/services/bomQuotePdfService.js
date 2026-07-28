/**
 * bomQuotePdfService.js — 報價單 PDF(P1 · 官方版 → 客戶輸出)
 *
 * 全 quote 側(材料對客/MVA/SGA/Profit/NRE 攤提/Total + SEPARATE NRE 明細)· 天然不含 true/margin。
 * 非 APPROVED 版本蓋「草稿 DRAFT」浮水印。CJK 用 NotoSansTC(CLAUDE.md 注意 #6)。
 */

const path = require('path');
const PDFDocument = require('pdfkit');
const engine = require('./bomCostEngine');

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const pick = (row, name) => { if (!row) return undefined; const lc = String(name).toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };
const money = (v) => (v == null ? '—' : `$${num(v).toFixed(4)}`);
const money2 = (v) => (v == null ? '—' : `$${num(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const FONT = path.join(__dirname, '../../fonts/NotoSansTC-Regular.ttf');

/** 撈報價單完整資料(quote 側)*/
async function loadQuoteData(db, versionId) {
  const v = await db.prepare(
    `SELECT id, project_id, version_no, case_factory_id, factory_code, run_id, status,
            unit_quote_usd, nre_total_quote_usd, nre_mode, costing_model, note
       FROM bom_quote_version WHERE id=?`,
  ).get(versionId);
  if (!v) throw new Error('quote version not found');
  const projectId = num(pick(v, 'project_id'));

  const p = await db.prepare(`SELECT * FROM projects WHERE id=?`).get(projectId).catch(() => null);
  let title = pick(p, 'title') || null;
  if (!title) { try { title = JSON.parse(pick(p, 'data_payload') || '{}').title || null; } catch (_) { /* noop */ } }
  const projectCode = pick(p, 'project_code') || `#${projectId}`;

  const runId = num(pick(v, 'run_id'));
  const run = runId ? await engine.loadPersistedRun(db, runId) : null;

  // 產品配置(run 記的 valueIds → 維度=值)
  let configLabel = '';
  const sig = runId ? pick(await db.prepare(`SELECT variant_value_ids FROM bom_cs_run WHERE run_id=?`).get(runId).catch(() => null), 'variant_value_ids') : null;
  if (sig) {
    const ids = String(sig).split(',').map(Number).filter(Boolean);
    if (ids.length) {
      const rows = await db.prepare(
        `SELECT d.dim_code, vv.value_code FROM bom_variant_value vv JOIN bom_variant_dimension d ON d.id = vv.dimension_id WHERE vv.id IN (${ids.map(() => '?').join(',')})`,
      ).all(...ids).catch(() => []);
      configLabel = rows.map((r) => `${pick(r, 'dim_code')}=${pick(r, 'value_code')}`).join(' · ');
    }
  }

  const qty = await db.prepare(
    `SELECT target_qty FROM bom_cs_case_qty_scenario WHERE case_factory_id=? ORDER BY is_baseline DESC, scenario_id FETCH FIRST 1 ROWS ONLY`,
  ).get(num(pick(v, 'case_factory_id'))).catch(() => null);

  const nreItems = await db.prepare(
    `SELECT category, item_no, description, qty, unit_price_quote FROM bom_nre_item WHERE project_id=? ORDER BY sort_order, id`,
  ).all(projectId).catch(() => []);

  return { v, projectCode, title, run, configLabel, targetQty: qty ? num(pick(qty, 'target_qty')) : null, nreItems };
}

/** 產 PDF(回 PDFDocument · caller pipe 到 res)*/
async function renderQuotePdf(db, versionId) {
  const { v, projectCode, title, run, configLabel, targetQty, nreItems } = await loadQuoteData(db, versionId);
  const status = pick(v, 'status');
  const isOfficial = status === 'APPROVED';
  const versionNo = num(pick(v, 'version_no'));
  const cb = (run && run.costBreakdown) || {};
  const nreMode = pick(v, 'nre_mode') || 'SEPARATE';
  const nreTotal = num(pick(v, 'nre_total_quote_usd'));
  const today = new Date().toISOString().slice(0, 10);

  const doc = new PDFDocument({ size: 'A4', margins: { top: 46, bottom: 46, left: 50, right: 50 } });
  doc.registerFont('tc', FONT);
  doc.font('tc');
  const W = doc.page.width - 100;   // 內容寬
  const teal = '#0E7490', ink = '#0F172A', muted = '#64748B', line = '#E2E8F0';

  // 浮水印(非正式版)
  if (!isOfficial) {
    doc.save().rotate(-30, { origin: [300, 400] }).fontSize(90).fillColor('#FCA5A5').opacity(0.18)
      .text('草稿 DRAFT', 60, 360, { width: 500, align: 'center' }).opacity(1).restore();
  }

  // Header
  doc.fillColor(ink).fontSize(22).text('報 價 單', { align: 'left' });
  doc.fontSize(10).fillColor(muted).text('QUOTATION · 正崴精密 Foxlink', { align: 'left' });
  doc.moveUp(2.4).fontSize(10).fillColor(muted).text(`報價單號:${projectCode}-Q${versionNo}`, { align: 'right' })
    .text(`日期:${today}`, { align: 'right' })
    .text(isOfficial ? '狀態:正式(APPROVED)' : `狀態:${status}(非正式)`, { align: 'right' });
  doc.moveDown(0.6);
  doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor(teal).lineWidth(1.5).stroke();
  doc.moveDown(0.8);

  // 專案資訊
  const info = [
    ['專案', `${projectCode}${title ? ` — ${title}` : ''}`],
    ['生產廠別', `${pick(v, 'factory_code') || '—'}(${pick(v, 'costing_model') === 'FULL_MVA' ? 'FULL MVA' : 'SIMPLIFIED'})`],
    ['產品配置', configLabel || '(單一配置)'],
    ['報價基準年量', targetQty ? `${targetQty.toLocaleString('en-US')} pcs` : '—'],
  ];
  doc.fontSize(10);
  for (const [k, val] of info) {
    doc.fillColor(muted).text(`${k}:`, { continued: true, width: W }).fillColor(ink).text(` ${val}`);
  }
  doc.moveDown(0.8);

  // 單價表
  doc.fontSize(12).fillColor(teal).text('單價明細(USD / unit)');
  doc.moveDown(0.3);
  const rows = [
    ['材料(Material)', cb.material],
    ['製造加值(MVA)', cb.mva],
    ['管銷(SG&A)', cb.sga],
    ['利潤(Profit)', cb.profit],
  ];
  if (num(cb.nreAmort) > 0) rows.push([`NRE 攤提(AMORTIZED / ${targetQty ? targetQty.toLocaleString('en-US') : '—'} pcs)`, cb.nreAmort]);
  const rowH = 20; let y = doc.y;
  doc.fontSize(10);
  for (const [label, val] of rows) {
    doc.fillColor(ink).text(label, 60, y, { width: W - 160 });
    doc.text(money(val), 50 + W - 140, y, { width: 140, align: 'right' });
    y += rowH;
    doc.moveTo(55, y - 5).lineTo(50 + W - 5, y - 5).strokeColor(line).lineWidth(0.5).stroke();
  }
  const unitTotal = pick(v, 'unit_quote_usd') != null ? num(pick(v, 'unit_quote_usd')) : cb.total;
  doc.fontSize(12).fillColor(teal).text('報價單價 Total / unit', 60, y + 2, { width: W - 200 });
  doc.text(money(unitTotal), 50 + W - 180, y + 2, { width: 180, align: 'right' });
  doc.moveDown(1.6);
  doc.x = 50;

  // NRE(SEPARATE 列明細)
  if (nreMode === 'SEPARATE' && nreItems.length) {
    doc.fontSize(12).fillColor(teal).text('一次性工程費 NRE(另計 · USD)');
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor(muted);
    let yy = doc.y;
    doc.text('項目', 60, yy, { width: 90 }).text('說明', 150, yy, { width: W - 300 }).text('數量', 50 + W - 190, yy, { width: 50, align: 'right' }).text('金額', 50 + W - 130, yy, { width: 130, align: 'right' });
    yy += 16;
    doc.fontSize(9.5).fillColor(ink);
    let nreSum = 0;
    for (const it of nreItems) {
      const sub = num(pick(it, 'qty') || 1) * num(pick(it, 'unit_price_quote'));
      nreSum += sub;
      doc.text(String(pick(it, 'category') || ''), 60, yy, { width: 90 });
      doc.text(String(pick(it, 'description') || ''), 150, yy, { width: W - 300 });
      doc.text(String(num(pick(it, 'qty') || 1)), 50 + W - 190, yy, { width: 50, align: 'right' });
      doc.text(money2(sub), 50 + W - 130, yy, { width: 130, align: 'right' });
      yy += 15;
      if (yy > doc.page.height - 120) { doc.addPage(); doc.font('tc'); yy = 60; }
    }
    doc.moveTo(55, yy).lineTo(50 + W - 5, yy).strokeColor(line).lineWidth(0.5).stroke();
    doc.fontSize(11).fillColor(teal).text('NRE 合計', 60, yy + 4, { width: 200 });
    doc.text(money2(nreTotal || nreSum), 50 + W - 180, yy + 4, { width: 180, align: 'right' });
    doc.moveDown(1.4);
    doc.x = 50;
  } else if (nreMode === 'AMORTIZED') {
    doc.fontSize(9).fillColor(muted).text('註:一次性工程費(NRE)已按報價基準年量攤提計入上表單價。');
    doc.moveDown(0.8);
  }

  // 條款 + 簽章
  doc.fontSize(9).fillColor(muted);
  doc.text('條款:1) 本報價有效期 30 天。 2) 幣別 USD,未含稅。 3) 單價基於上列年量與產品配置;數量/規格變更需重新報價。 4) 正式訂單以雙方簽核為準。');
  doc.moveDown(2);
  const sy = doc.y;
  doc.fontSize(10).fillColor(ink);
  doc.text('報價人:________________', 60, sy);
  doc.text('核准:________________', 240, sy);
  doc.text('客戶確認:________________', 400, sy);
  doc.fontSize(8).fillColor(muted).text(`Generated by Cortex · ${today} · 本報價單僅含對客報價,不含內部成本資訊`, 50, doc.page.height - 60, { width: W, align: 'center' });

  return { doc, filename: `quotation-${projectCode}-Q${versionNo}.pdf` };
}

module.exports = { renderQuotePdf };
