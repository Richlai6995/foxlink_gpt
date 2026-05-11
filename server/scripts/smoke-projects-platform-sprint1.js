/**
 * Smoke Test — Sprint 1
 *
 * 驗證:
 *   1. Migration 001-005 跑得起來(idempotent)
 *   2. plugin registry boot OK(QUOTE + GENERAL 都載入)
 *   3. projectsService.create() 建出 project + 預設 channels + stages + member
 *   4. projectsService.list() / get() 回正確結果
 *   5. updateLifecycle DRAFT→ACTIVE→PAUSED→ACTIVE→CLOSED OK
 *   6. 跨步驟資料清理(test project 用 _SMOKE 前綴 → 結尾刪)
 *
 * 跑法:
 *   ENABLE_PROJECTS_PLATFORM=true node server/scripts/smoke-projects-platform-sprint1.js
 */

process.env.ENABLE_PROJECTS_PLATFORM = 'true';

(async () => {
  let exitCode = 0;
  let db;
  try {
    const oracleDb = require('../database-oracle');
    db = await oracleDb.init();
    console.log('✓ DB init OK');

    const projectsPlatform = require('../projects-platform');
    console.log('  ENABLED =', projectsPlatform.ENABLED);

    // 1. Build router 驗證 mount
    const router = projectsPlatform.buildRouter();
    if (!router) throw new Error('buildRouter returned null but ENABLED=true');
    console.log('✓ Router built');

    // 2. Plugin registry
    const registry = require('../projects-platform/plugins/registry');
    const codes = registry.list();
    if (!codes.includes('QUOTE') || !codes.includes('GENERAL')) {
      throw new Error('expected QUOTE+GENERAL in registry, got: ' + codes.join(','));
    }
    console.log('✓ Plugins registered:', codes.join(', '));

    // 3. 驗 project_types 已 seed
    const typeQuote = await db.prepare(`SELECT id, default_workflow_template_id FROM project_types WHERE type_code=?`).get('QUOTE');
    if (!typeQuote) throw new Error('project_types QUOTE not seeded');
    if (!typeQuote.default_workflow_template_id) throw new Error('QUOTE has no default_workflow_template_id');
    console.log(`✓ project_types QUOTE id=${typeQuote.id} template=${typeQuote.default_workflow_template_id}`);

    // 4. 驗 workflow_template_stages(QUOTE 應有 8 stages)
    const quoteStages = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM workflow_template_stages WHERE template_id=?`,
    ).get(typeQuote.default_workflow_template_id);
    if (Number(quoteStages.cnt) !== 8) {
      throw new Error(`expected 8 QUOTE stages, got ${quoteStages.cnt}`);
    }
    console.log(`✓ QUOTE workflow has ${quoteStages.cnt} stages`);

    // 5. Find a real user for creator_id(優先抓 admin)
    const adminRow = await db.prepare(
      `SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`,
    ).get();
    if (!adminRow) throw new Error('no active admin user found for smoke test');
    const creatorId = Number(adminRow.id);
    console.log(`✓ Using creator_id=${creatorId}`);

    // 6. 清理舊 smoke project(若有)
    await _cleanupSmoke(db);

    // 7. projectsService.create — QUOTE 應建 7 channels + 8 stages
    const projectsService = require('../projects-platform/services/projectsService');
    const code = '_SMOKE_QUOTE_' + Date.now();
    const projectId = await projectsService.create(db, {
      project_code: code,
      type_code: 'QUOTE',
      title: 'Smoke test 報價案',
      bu_id: 1,
      creator_id: creatorId,
      importance: 'HIGH',
    });
    console.log(`✓ QUOTE project created id=${projectId} code=${code}`);

    // 8. 驗 channels 數量(QUOTE = 7)
    const chnRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM project_channels WHERE project_id=?`,
    ).get(projectId);
    if (Number(chnRow.cnt) !== 7) {
      throw new Error(`expected 7 channels, got ${chnRow.cnt}`);
    }
    console.log(`✓ ${chnRow.cnt} channels auto-created`);

    // 9. 驗 stages 數量(QUOTE = 8)
    const stRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM project_stages WHERE project_id=?`,
    ).get(projectId);
    if (Number(stRow.cnt) !== 8) {
      throw new Error(`expected 8 stages, got ${stRow.cnt}`);
    }
    console.log(`✓ ${stRow.cnt} stages auto-created`);

    // 10. 驗 PM member
    const memRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM project_members WHERE project_id=? AND user_id=?`,
    ).get(projectId, creatorId);
    if (Number(memRow.cnt) !== 1) {
      throw new Error(`expected creator as member, got ${memRow.cnt}`);
    }
    console.log(`✓ creator added as PM member`);

    // 11. list()
    const fakeUser = { id: creatorId, role: 'admin' };
    const list = await projectsService.list(db, fakeUser, { limit: 10 });
    if (!list.find((p) => Number(p.id) === projectId)) {
      throw new Error('created project not in list');
    }
    console.log(`✓ list() returned project (total=${list.length})`);

    // 12. get() 詳細
    const detail = await projectsService.get(db, projectId, fakeUser);
    if (!detail || detail._forbidden) throw new Error('get() failed');
    if (detail.channels.length !== 7) throw new Error('detail.channels wrong count');
    if (detail.stages.length !== 8) throw new Error('detail.stages wrong count');
    console.log(`✓ get() returned full detail (channels=${detail.channels.length}, stages=${detail.stages.length}, members=${detail.members.length})`);

    // 13. Lifecycle: DRAFT → ACTIVE → PAUSED → ACTIVE → CLOSED
    await projectsService.updateLifecycle(db, projectId, 'ACTIVE', fakeUser);
    await projectsService.updateLifecycle(db, projectId, 'PAUSED', fakeUser, { reason: 'smoke test pause' });
    await projectsService.updateLifecycle(db, projectId, 'ACTIVE', fakeUser);
    await projectsService.updateLifecycle(db, projectId, 'CLOSED', fakeUser);
    const closed = await db.prepare(`SELECT lifecycle_status, closed_at FROM projects WHERE id=?`).get(projectId);
    if (closed.lifecycle_status !== 'CLOSED') throw new Error('lifecycle not CLOSED');
    if (!closed.closed_at) throw new Error('closed_at not set');
    console.log(`✓ Lifecycle transitions: DRAFT→ACTIVE→PAUSED→ACTIVE→CLOSED`);

    // 14. 非法轉移應該擋
    try {
      await projectsService.updateLifecycle(db, projectId, 'ACTIVE', fakeUser);
      throw new Error('expected lifecycle CLOSED→ACTIVE to fail');
    } catch (e) {
      if (!/invalid lifecycle transition/.test(e.message)) throw e;
      console.log(`✓ Invalid transition CLOSED→ACTIVE rejected`);
    }

    // 15. REOPENED OK
    await projectsService.updateLifecycle(db, projectId, 'REOPENED', fakeUser, { reason: 'smoke' });
    await projectsService.updateLifecycle(db, projectId, 'ACTIVE', fakeUser);
    console.log(`✓ Lifecycle REOPENED → ACTIVE OK`);

    // 16. GENERAL project(2 channels + 4 stages)
    const codeG = '_SMOKE_GENERAL_' + Date.now();
    const gid = await projectsService.create(db, {
      project_code: codeG, type_code: 'GENERAL', title: 'Smoke 一般專案',
      bu_id: 1, creator_id: creatorId,
    });
    const gChn = await db.prepare(`SELECT COUNT(*) AS cnt FROM project_channels WHERE project_id=?`).get(gid);
    const gSt = await db.prepare(`SELECT COUNT(*) AS cnt FROM project_stages WHERE project_id=?`).get(gid);
    if (Number(gChn.cnt) !== 2) throw new Error(`GENERAL channels wrong: ${gChn.cnt}`);
    if (Number(gSt.cnt) !== 4) throw new Error(`GENERAL stages wrong: ${gSt.cnt}`);
    console.log(`✓ GENERAL project ok (channels=${gChn.cnt}, stages=${gSt.cnt})`);

    // 17. Cleanup
    await _cleanupSmoke(db);
    console.log('✓ Cleanup smoke projects');

    console.log('\n=== Sprint 1 smoke test PASSED ===');
  } catch (e) {
    console.error('\n✗ FAILED:', e.message);
    console.error(e.stack);
    exitCode = 1;
  } finally {
    try {
      if (db) await require('../database-oracle').close();
    } catch {}
    process.exit(exitCode);
  }
})();

async function _cleanupSmoke(db) {
  const rows = await db.prepare(
    `SELECT id FROM projects WHERE project_code LIKE '_SMOKE_%'`,
  ).all();
  for (const r of rows) {
    const id = Number(r.id);
    await db.prepare(`DELETE FROM channel_participants WHERE channel_id IN (SELECT id FROM project_channels WHERE project_id=?)`).run(id);
    await db.prepare(`DELETE FROM project_channels WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM project_stages WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM project_members WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM project_tasks WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM projects WHERE id=?`).run(id);
  }
}
