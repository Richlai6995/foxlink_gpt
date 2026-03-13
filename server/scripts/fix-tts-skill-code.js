'use strict';
/**
 * One-time script: update skill "文字轉聲音" code_snippet in DB from disk file
 * Run: node scripts/fix-tts-skill-code.js   (from server/ directory)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
  const dbModule = require('../database-oracle');
  const db = await dbModule.init();

  // Read the new code from the already-edited disk file
  const fs = require('fs');
  const codePath = path.join(__dirname, '../skill_runners/5/user_code.js');
  if (!fs.existsSync(codePath)) {
    console.error('user_code.js not found at', codePath);
    process.exit(1);
  }
  const newCode = fs.readFileSync(codePath, 'utf8');

  const rows = await db.prepare(
    `SELECT id, name FROM skills WHERE id=5 OR (UPPER(name) LIKE '%TTS%') OR (UPPER(name) LIKE '%轉聲音%') FETCH FIRST 5 ROWS ONLY`
  ).all();
  console.log('Matched skills:', rows.map(r => `${r.id}:${r.name}`).join(', '));

  if (!rows.length) { console.error('No matching skill'); process.exit(1); }

  const targetId = rows[0].id;
  await db.prepare(`UPDATE skills SET code_snippet=:1 WHERE id=:2`).run(newCode, targetId);
  console.log(`✅ Updated code_snippet for skill ID=${targetId} — restart skill from admin to apply`);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
