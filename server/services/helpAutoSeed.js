/**
 * Auto-seed Help Sections on server startup.
 * Multi-book aware: each registered seed module belongs to a specific help book.
 *
 * Seed module shape:
 *   { bookCode, bookName?, bookIcon?, bookIsSpecial?, bookSortOrder?, sections: [...] }
 * 或舊 shape(向下相容,只給 cortex 用):
 *   { userSections: [...] }
 */

const SEED_MODULES = [
  // Cortex 主說明書(舊 helpSeedData.js,維持原 export shape)
  { path: '../data/helpSeedData', bookCode: 'cortex' },
  // 貴金屬分析平台說明書(新 seed)
  { path: '../data/pmHelpSeedData', bookCode: 'precious-metals' },
];

async function ensureBook(db, { code, name, description, icon, isSpecial, sortOrder, lastModified }) {
  const existing = await db.prepare(
    `SELECT id, last_modified FROM help_books WHERE code = ?`
  ).get(code);
  if (existing) {
    // 更新 metadata(seed 改 name/icon 時跟著更新),不動 last_modified 以免影響舊資料
    if (name || icon || description) {
      await db.prepare(`
        UPDATE help_books
        SET name = COALESCE(?, name),
            description = COALESCE(?, description),
            icon = COALESCE(?, icon),
            is_special = COALESCE(?, is_special),
            sort_order = COALESCE(?, sort_order)
        WHERE id = ?
      `).run(name ?? null, description ?? null, icon ?? null,
             isSpecial != null ? Number(isSpecial) : null,
             sortOrder != null ? Number(sortOrder) : null,
             existing.id);
    }
    return existing.id;
  }
  await db.prepare(`
    INSERT INTO help_books (code, name, description, icon, is_special, is_active, sort_order, last_modified)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(code, name || code, description || null, icon || 'book_open_text',
         Number(isSpecial || 0), Number(sortOrder || 0),
         lastModified || new Date().toISOString().slice(0, 10));
  const row = await db.prepare(`SELECT id FROM help_books WHERE code = ?`).get(code);
  console.log(`[HelpAutoSeed] Created book "${code}" (id=${row.id})`);

  // 新建 special book → 套用全域預設分享範本
  if (Number(isSpecial || 0) === 1 && row?.id) {
    try {
      const tpl = await db.prepare(
        `SELECT grantee_type, grantee_id FROM help_default_share`
      ).all();
      const list = Array.isArray(tpl) ? tpl : (tpl?.rows || []);
      let copied = 0;
      for (const t of list) {
        try {
          await db.prepare(`
            INSERT INTO help_book_shares (book_id, grantee_type, grantee_id, granted_by)
            VALUES (?, ?, ?, NULL)
          `).run(row.id, t.grantee_type, t.grantee_id);
          copied++;
        } catch { /* unique conflict — skip */ }
      }
      if (copied > 0) console.log(`[HelpAutoSeed] Applied default-share template (${copied} entries) to book "${code}"`);
    } catch (e) { console.warn('[HelpAutoSeed] default-share template apply error:', e.message); }
  }
  return row.id;
}

async function autoSeedHelp(db) {
  for (const mod of SEED_MODULES) {
    let seedExports;
    try {
      seedExports = require(mod.path);
    } catch (e) {
      // 缺檔不算錯,可能該 book seed 還沒寫
      console.log(`[HelpAutoSeed] ${mod.path} not found, skipping`);
      continue;
    }

    // 兩種 export shape:
    //   1. { userSections: [...] }(舊,僅 cortex)
    //   2. { bookCode, bookName, bookIcon, bookIsSpecial, bookSortOrder, sections: [...] }
    const userSections = seedExports.sections || seedExports.userSections;
    if (!Array.isArray(userSections) || userSections.length === 0) {
      console.log(`[HelpAutoSeed] ${mod.path} has no sections, skipping`);
      continue;
    }

    // 確保 book 存在(取得 book_id)
    let bookId;
    try {
      bookId = await ensureBook(db, {
        code: mod.bookCode,
        name: seedExports.bookName,
        description: seedExports.bookDescription,
        icon: seedExports.bookIcon,
        isSpecial: seedExports.bookIsSpecial,
        sortOrder: seedExports.bookSortOrder,
        lastModified: seedExports.bookLastModified,
      });
    } catch (err) {
      console.error(`[HelpAutoSeed] ensureBook error for ${mod.bookCode}:`, err.message);
      continue;
    }

    let upserted = 0;
    let skipped = 0;

    for (const section of userSections) {
      try {
        const existing = await db.prepare(
          'SELECT id, last_modified, book_id FROM help_sections WHERE id = ?'
        ).get(section.id);

        // last_modified 比對(該 book 的 sections 才比;不同 book 撞 id 會被視為錯誤,跳過)
        if (existing && existing.book_id != null && Number(existing.book_id) !== Number(bookId)) {
          console.warn(`[HelpAutoSeed] Section id "${section.id}" belongs to other book(${existing.book_id}), skipping`);
          continue;
        }
        if (existing && existing.last_modified >= section.last_modified) {
          skipped++;
          continue;
        }

        const sectionType = section.section_type || 'user';
        if (!existing) {
          await db.prepare(`
            INSERT INTO help_sections (id, section_type, sort_order, icon, icon_color, last_modified, book_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(section.id, sectionType, section.sort_order, section.icon, section.icon_color, section.last_modified, bookId);
        } else {
          await db.prepare(`
            UPDATE help_sections SET section_type=?, sort_order=?, icon=?, icon_color=?, last_modified=?, book_id=? WHERE id=?
          `).run(sectionType, section.sort_order, section.icon, section.icon_color, section.last_modified, bookId, section.id);
        }

        const blocksJson = JSON.stringify(section.blocks);
        const existingTrans = await db.prepare(
          'SELECT id FROM help_translations WHERE section_id = ? AND lang = ?'
        ).get(section.id, 'zh-TW');

        if (!existingTrans) {
          await db.prepare(`
            INSERT INTO help_translations (section_id, lang, title, sidebar_label, blocks_json, translated_at)
            VALUES (?, 'zh-TW', ?, ?, ?, ?)
          `).run(section.id, section.title, section.sidebar_label, blocksJson, section.last_modified);
        } else {
          await db.prepare(`
            UPDATE help_translations
            SET title=?, sidebar_label=?, blocks_json=?, translated_at=?, updated_at=SYSTIMESTAMP
            WHERE section_id=? AND lang='zh-TW'
          `).run(section.title, section.sidebar_label, blocksJson, section.last_modified, section.id);
        }

        upserted++;
      } catch (err) {
        console.error(`[HelpAutoSeed][${mod.bookCode}] Error seeding ${section.id}:`, err.message);
      }
    }

    // Cleanup: 移除 DB 中該 book 已不在 seed 的 sections(orphan)
    let removed = 0;
    try {
      const seedIds = userSections.map(s => s.id);
      const dbRows = await db.prepare(
        `SELECT id FROM help_sections WHERE book_id = ?`
      ).all(bookId);
      const dbSections = Array.isArray(dbRows) ? dbRows : (dbRows?.rows || []);
      for (const row of dbSections) {
        if (!seedIds.includes(row.id)) {
          await db.prepare('DELETE FROM help_translations WHERE section_id = ?').run(row.id);
          await db.prepare('DELETE FROM help_sections WHERE id = ?').run(row.id);
          removed++;
          console.log(`[HelpAutoSeed][${mod.bookCode}] Removed orphan section: ${row.id}`);
        }
      }
    } catch (err) {
      console.error(`[HelpAutoSeed][${mod.bookCode}] Cleanup error:`, err.message);
    }

    if (upserted > 0 || removed > 0) {
      console.log(`[HelpAutoSeed][${mod.bookCode}] Upserted ${upserted}, removed ${removed}, skipped ${skipped}`);
    } else {
      console.log(`[HelpAutoSeed][${mod.bookCode}] All ${skipped} sections up-to-date`);
    }
  }
}

module.exports = { autoSeedHelp };
