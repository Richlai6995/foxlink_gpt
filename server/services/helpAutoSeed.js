/**
 * Auto-seed Help Sections on server startup.
 * Compares last_modified in helpSeedData.js vs DB and upserts changed sections.
 */

async function autoSeedHelp(db) {
  let userSections;
  try {
    ({ userSections } = require('../data/helpSeedData'));
  } catch (e) {
    console.log('[HelpAutoSeed] helpSeedData.js not found, skipping');
    return;
  }

  if (!userSections || userSections.length === 0) {
    console.log('[HelpAutoSeed] No seed sections, skipping');
    return;
  }

  let upserted = 0;
  let skipped = 0;

  for (const section of userSections) {
    try {
      // Check if section exists and compare last_modified
      const existing = await db.prepare(
        'SELECT id, last_modified FROM help_sections WHERE id = ?'
      ).get(section.id);

      if (existing && existing.last_modified >= section.last_modified) {
        skipped++;
        continue; // DB is same or newer, skip
      }

      // Upsert section metadata
      if (!existing) {
        await db.prepare(`
          INSERT INTO help_sections (id, section_type, sort_order, icon, icon_color, last_modified)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(section.id, 'user', section.sort_order, section.icon, section.icon_color, section.last_modified);
      } else {
        await db.prepare(`
          UPDATE help_sections SET sort_order=?, icon=?, icon_color=?, last_modified=? WHERE id=?
        `).run(section.sort_order, section.icon, section.icon_color, section.last_modified, section.id);
      }

      // Upsert zh-TW translation
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
      console.error(`[HelpAutoSeed] Error seeding ${section.id}:`, err.message);
    }
  }

  if (upserted > 0) {
    console.log(`[HelpAutoSeed] Upserted ${upserted} sections, skipped ${skipped} (unchanged)`);
  } else {
    console.log(`[HelpAutoSeed] All ${skipped} sections up-to-date`);
  }
}

module.exports = { autoSeedHelp };
