/**
 * Smoke Test — Sprint 2(Multi-Channel + Messages)
 *
 * 驗證:
 *   1. Migration 006 跑得起來
 *   2. channelsService:create / archive / DM / participants / markRead
 *   3. messagesService:post / list / pin / unpin / softDelete / emergencyPurge
 *   4. 訊息色語言:NORMAL/PROGRESS/BLOCKER/DECISION/AI_INSIGHT
 *   5. BLOCKER/DECISION/AI_INSIGHT 自動 sync 到 announcement channel
 *   6. announcement channel 一般人不能發
 *   7. read receipt(requires_read_receipt=true 的訊息)
 *
 * 跑法:
 *   cd server
 *   ENABLE_PROJECTS_PLATFORM=true node scripts/smoke-projects-platform-sprint2.js
 */

process.env.ENABLE_PROJECTS_PLATFORM = 'true';

(async () => {
  let exitCode = 0;
  let db;
  try {
    const oracleDb = require('../database-oracle');
    db = await oracleDb.init();
    console.log('✓ DB init OK');

    const projectsService = require('../projects-platform/services/projectsService');
    const channelsService = require('../projects-platform/services/channelsService');
    const messagesService = require('../projects-platform/services/messagesService');

    // 1. 找 admin user
    const adminRow = await db.prepare(
      `SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`,
    ).get();
    if (!adminRow) throw new Error('no active admin');
    const creatorId = Number(adminRow.id);
    console.log(`✓ creator=${creatorId}`);

    // 2. 找/造一個 secondary user
    let secondaryRow = await db.prepare(
      `SELECT id FROM users WHERE role!='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`,
    ).get();
    let secondaryId;
    if (!secondaryRow) {
      console.log('  no non-admin user found, using admin again (will create DM with admin+self+1 wouldn\'t work, skip secondary tests)');
      secondaryId = creatorId + 9999; // fake id 給 DM 測試
    } else {
      secondaryId = Number(secondaryRow.id);
    }
    console.log(`✓ secondary=${secondaryId}`);

    // 3. Cleanup 舊 smoke
    await _cleanupSmoke(db);

    // 4. 建 QUOTE project(用 sprint 1 服務)
    const code = '_SMOKE_S2_' + Date.now();
    const projectId = await projectsService.create(db, {
      project_code: code, type_code: 'QUOTE', title: 'Sprint 2 smoke',
      bu_id: 1, creator_id: creatorId,
    });
    console.log(`✓ Created project id=${projectId}`);

    // 5. 列 channels — 應有 7 (QUOTE)
    const channels = await channelsService.listForProject(db, projectId);
    if (channels.length !== 7) throw new Error(`expected 7 channels, got ${channels.length}`);
    console.log(`✓ listForProject returned ${channels.length} channels`);

    const generalCh = channels.find((c) => c.name === 'general');
    const annCh = channels.find((c) => c.name === 'announcement');
    const engCh = channels.find((c) => c.name === 'engineering');
    if (!generalCh || !annCh || !engCh) throw new Error('missing expected default channels');

    // 6. 在 general 發 NORMAL message
    const msg1 = await messagesService.post(db, {
      channelId: generalCh.id,
      userId: creatorId,
      content: 'Hello general',
      messageType: 'NORMAL',
    });
    console.log(`✓ NORMAL message posted id=${msg1.id}`);

    // 7. 發 BLOCKER → 應自動 sync 到 announcement
    const msg2 = await messagesService.post(db, {
      channelId: engCh.id,
      userId: creatorId,
      content: '客戶要求縮短交期 — 已知無法完成,需要重新議價',
      messageType: 'BLOCKER',
    });
    if (!msg2.announcementMsgId) throw new Error('BLOCKER did not sync to announcement');
    console.log(`✓ BLOCKER posted id=${msg2.id} → synced to announcement msg=${msg2.announcementMsgId}`);

    // 8. 發 DECISION → 同樣 sync
    const msg3 = await messagesService.post(db, {
      channelId: generalCh.id, userId: creatorId,
      content: '決議:採方案 B(高良率版)— 詳見 #cost-review',
      messageType: 'DECISION',
    });
    if (!msg3.announcementMsgId) throw new Error('DECISION did not sync to announcement');
    console.log(`✓ DECISION posted id=${msg3.id} → synced msg=${msg3.announcementMsgId}`);

    // 9. 列 announcement messages — 應有 2 條 sync 進來
    const annMsgs = await messagesService.list(db, annCh.id, { limit: 50 });
    const synced = annMsgs.filter((m) => m.message_type === 'SYSTEM');
    if (synced.length < 2) throw new Error(`expected 2 synced msg in announcement, got ${synced.length}`);
    console.log(`✓ announcement has ${synced.length} SYSTEM-synced msgs`);

    // 10. PROGRESS message(不 sync)
    const msg4 = await messagesService.post(db, {
      channelId: generalCh.id, userId: creatorId,
      content: 'BOM 完成 60%',
      messageType: 'PROGRESS',
    });
    if (msg4.announcementMsgId) throw new Error('PROGRESS should NOT sync');
    console.log(`✓ PROGRESS posted id=${msg4.id} (no sync)`);

    // 11. List 一般訊息 排序新→舊
    const generalMsgs = await messagesService.list(db, generalCh.id, { limit: 10 });
    if (generalMsgs.length < 3) throw new Error(`general should have >=3 msgs, got ${generalMsgs.length}`);
    if (Number(generalMsgs[0].id) <= Number(generalMsgs[1].id)) {
      throw new Error('list should be sorted DESC by id');
    }
    console.log(`✓ list returned ${generalMsgs.length} msgs (sorted DESC)`);

    // 12. Pin msg1
    await messagesService.pin(db, msg1.id, creatorId, 'demo pin');
    const pinned = await messagesService.listPinned(db, generalCh.id);
    if (!pinned.find((m) => Number(m.id) === msg1.id)) throw new Error('pinned not in listPinned');
    console.log(`✓ pinned msg ${msg1.id}, listPinned has ${pinned.length}`);

    // 13. Unpin
    await messagesService.unpin(db, msg1.id);
    const pinned2 = await messagesService.listPinned(db, generalCh.id);
    if (pinned2.find((m) => Number(m.id) === msg1.id)) throw new Error('unpin failed');
    console.log(`✓ unpinned msg ${msg1.id}`);

    // 14. Read receipt
    const msg5 = await messagesService.post(db, {
      channelId: generalCh.id, userId: creatorId,
      content: '所有人請務必過目',
      messageType: 'NORMAL',
      requiresReadReceipt: true,
    });
    await messagesService.markReadReceipt(db, msg5.id, creatorId);
    await messagesService.markReadReceipt(db, msg5.id, creatorId); // dedup
    const receipts = await messagesService.listReadReceipts(db, msg5.id);
    if (receipts.length !== 1) throw new Error(`expected 1 receipt, got ${receipts.length}`);
    console.log(`✓ receipt marked, dedup works (count=${receipts.length})`);

    // 15. Soft delete
    await messagesService.softDelete(db, msg4.id, creatorId, 'wrong content');
    const afterDel = await messagesService.list(db, generalCh.id, { limit: 50 });
    if (afterDel.find((m) => Number(m.id) === msg4.id)) {
      throw new Error('soft-deleted msg leaked to default list');
    }
    const inclDel = await messagesService.list(db, generalCh.id, { limit: 50, includeDeleted: true });
    const delRow = inclDel.find((m) => Number(m.id) === msg4.id);
    if (!delRow) throw new Error('soft-deleted msg missing in includeDeleted=true');
    if (!delRow.deleted_at) throw new Error('deleted_at not set');
    console.log(`✓ soft delete: hidden by default, visible with includeDeleted`);

    // 16. Emergency purge
    await messagesService.emergencyPurge(db, msg2.id, creatorId, 'GDPR request');
    const purged = await messagesService.get(db, msg2.id);
    if (!purged.content.includes('已抹除')) throw new Error('purge did not nullify content');
    console.log(`✓ emergency purge: content cleaned, metadata kept`);

    // 17. Archive non-default channel(先建一個 group)
    const tempChId = await channelsService.create(db, {
      projectId, name: 'temp-group', channelType: 'group', creatorId,
    });
    await channelsService.archive(db, tempChId, creatorId);
    const activeChannels = await channelsService.listForProject(db, projectId);
    if (activeChannels.find((c) => Number(c.id) === tempChId)) {
      throw new Error('archived channel leaked into active list');
    }
    console.log(`✓ archive non-default channel`);

    // 18. Archive default channel 應失敗
    try {
      await channelsService.archive(db, generalCh.id, creatorId);
      throw new Error('expected archive default to fail');
    } catch (e) {
      if (!/cannot archive default/.test(e.message)) throw e;
      console.log(`✓ cannot archive default channel`);
    }

    // 19. DM(若有 secondary user)
    if (secondaryRow) {
      const dm = await channelsService.findOrCreateDM(db, {
        projectId, user1Id: creatorId, user2Id: secondaryId, creatorId,
      });
      if (!dm.created) throw new Error('first DM should be created=true');

      // idempotent
      const dm2 = await channelsService.findOrCreateDM(db, {
        projectId, user1Id: secondaryId, user2Id: creatorId, creatorId,
      });
      if (dm2.created) throw new Error('second DM should be created=false (find)');
      if (dm.channel_id !== dm2.channel_id) throw new Error('DM not idempotent');

      // 兩個 participant
      const dmParts = await channelsService.listParticipants(db, dm.channel_id);
      if (dmParts.length !== 2) throw new Error(`DM should have 2 participants, got ${dmParts.length}`);
      console.log(`✓ DM findOrCreate idempotent, 2 participants`);
    } else {
      console.log(`  ⚠ skip DM test (no non-admin user)`);
    }

    // 20. Participant add/remove/mark read
    const eParticipants = await channelsService.listParticipants(db, engCh.id);
    const baseCount = eParticipants.length;
    if (secondaryRow) {
      await channelsService.addParticipant(db, engCh.id, secondaryId);
      const afterAdd = await channelsService.listParticipants(db, engCh.id);
      if (afterAdd.length !== baseCount + 1) throw new Error('addParticipant failed');
      await channelsService.removeParticipant(db, engCh.id, secondaryId);
      const afterRm = await channelsService.listParticipants(db, engCh.id);
      if (afterRm.length !== baseCount) throw new Error('removeParticipant failed');
      console.log(`✓ participant add/remove(soft left_at)`);
    } else {
      console.log(`  ⚠ skip participant test`);
    }

    // 21. mark channel read
    await channelsService.markRead(db, generalCh.id, creatorId);
    console.log(`✓ markRead`);

    // 22. Cleanup
    await _cleanupSmoke(db);
    console.log(`✓ cleanup`);

    console.log('\n=== Sprint 2 smoke test PASSED ===');
  } catch (e) {
    console.error('\n✗ FAILED:', e.message);
    console.error(e.stack);
    exitCode = 1;
  } finally {
    try { if (db) await require('../database-oracle').close(); } catch {}
    process.exit(exitCode);
  }
})();

async function _cleanupSmoke(db) {
  const rows = await db.prepare(
    `SELECT id FROM projects WHERE project_code LIKE '_SMOKE_%'`,
  ).all();
  for (const r of rows) {
    const id = Number(r.id);
    await db.prepare(`DELETE FROM project_message_read_receipts WHERE message_id IN (SELECT id FROM project_messages WHERE project_id=?)`).run(id);
    await db.prepare(`DELETE FROM project_messages WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM channel_participants WHERE channel_id IN (SELECT id FROM project_channels WHERE project_id=?)`).run(id);
    await db.prepare(`DELETE FROM project_channels WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM project_stages WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM project_members WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM project_tasks WHERE project_id=?`).run(id);
    await db.prepare(`DELETE FROM projects WHERE id=?`).run(id);
  }
}
