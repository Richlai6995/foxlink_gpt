/**
 * bomStageService.js — BOM 事件 → Stage Gate 自動推進(P1)
 *
 * QUOTE 8 階段(003_workflow seed):RECEIVE_RFQ → Q_AND_A_COLLECT → Q_AND_A_FEEDBACK →
 * BOM_PROVIDE → PARALLEL_COLLECT → BOM_COST_REVIEW → RFQ_COST_REVIEW → SUBMIT_QUOTE
 *
 * autoAdvanceTo:把 order ≤ 目標的階段依序標 DONE(遇 gate_required=1 未確認 → 停止,不繞 gate),
 * 目標後第一個 → ACTIVE。冪等(目標已 DONE → noop)。fire-and-forget(掛點 try/catch,不影響主流程)。
 * 不發訊息/通知(避免自動事件轟炸),只 WS broadcast 讓 StageRibbon 即時刷新。
 */

const { makeLogger } = require('./logger');
const log = makeLogger('bomStage');

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

async function autoAdvanceTo(db, projectId, stageCode, trigger = 'bom-event') {
  if (!projectId || !stageCode) return { advanced: 0 };
  const stages = await db.prepare(
    `SELECT id, stage_code, stage_order, status, gate_required, sla_hours FROM project_stages WHERE project_id = ? ORDER BY stage_order`,
  ).all(projectId).catch(() => []);
  if (!stages.length) return { advanced: 0 };
  const target = stages.find((s) => s.stage_code === stageCode);
  if (!target) return { advanced: 0 };
  if (target.status === 'DONE' || target.status === 'SKIPPED') return { advanced: 0 };   // 冪等

  let advanced = 0;
  for (const s of stages) {
    if (num(s.stage_order) > num(target.stage_order)) break;
    if (s.status === 'DONE' || s.status === 'SKIPPED') continue;
    if (num(s.gate_required) === 1) {   // 業務 gate 不自動繞 → 停在這,等人工 advance
      log.log(`autoAdvanceTo(${projectId},${stageCode}): 停在 gate ${s.stage_code}(需人工確認)`);
      break;
    }
    await db.prepare(
      `UPDATE project_stages SET status='DONE', completed_at=SYSTIMESTAMP, gate_notes=? WHERE id=?`,
    ).run(`auto: ${trigger}`, num(s.id));
    advanced += 1;
  }
  if (!advanced) return { advanced: 0 };

  // 目標後第一個未完成 → ACTIVE + current_stage_id;無(最後階完)→ current 指向最後階,lifecycle 不動(結案人工)
  const next = stages.find((s) => num(s.stage_order) > num(target.stage_order) && s.status !== 'DONE' && s.status !== 'SKIPPED');
  if (next) {
    const dueAt = next.sla_hours ? new Date(Date.now() + num(next.sla_hours) * 3600000) : null;
    await db.prepare(`UPDATE project_stages SET status='ACTIVE', entered_at=SYSTIMESTAMP, sla_due_at=? WHERE id=?`).run(dueAt, num(next.id));
    await db.prepare(`UPDATE projects SET current_stage_id=?, updated_at=SYSTIMESTAMP WHERE id=?`).run(num(next.id), projectId);
  } else {
    await db.prepare(`UPDATE projects SET current_stage_id=?, updated_at=SYSTIMESTAMP WHERE id=?`).run(num(target.id), projectId);
  }

  log.log(`autoAdvanceTo(${projectId} → ${stageCode}): ${advanced} 階完成(${trigger})`);
  try {
    const sock = require('../../services/socketService');
    sock.emitProjectStageAdvanced(projectId, { auto: true, to: stageCode, trigger });
  } catch (_) { /* ws optional */ }
  return { advanced, to: stageCode };
}

/** item → 所屬 instance 的待詢價數(0 = 詢價完成)*/
async function pendingCountByItem(db, itemId) {
  const r = await db.prepare(
    `SELECT sec.bom_instance_id AS inst, bi.project_id AS pid
       FROM bom_item i JOIN bom_category c ON c.id=i.bom_category_id
       JOIN bom_section sec ON sec.id=c.bom_section_id JOIN bom_instance bi ON bi.id=sec.bom_instance_id
      WHERE i.id=?`,
  ).get(itemId).catch(() => null);
  if (!r) return null;
  const inst = num(Object.values(r)[0]), pid = num(Object.values(r)[1]);
  const cnt = await db.prepare(
    `SELECT COUNT(*) AS n FROM bom_item i
       JOIN bom_category c ON c.id=i.bom_category_id JOIN bom_section sec ON sec.id=c.bom_section_id
       LEFT JOIN (SELECT bom_item_id, MAX(applied_price_usd) ap FROM bom_item_price_snapshot WHERE is_chosen=1 GROUP BY bom_item_id) ch ON ch.bom_item_id=i.id
      WHERE sec.bom_instance_id=? AND ch.ap IS NULL`,
  ).get(inst).catch(() => null);
  return { projectId: pid, pending: cnt ? num(Object.values(cnt)[0]) : null };
}

module.exports = { autoAdvanceTo, pendingCountByItem };
