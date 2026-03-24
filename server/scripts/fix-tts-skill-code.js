'use strict';
/**
 * One-time script: update ALL TTS skill code_snippet in DB from disk file
 * Run: node scripts/fix-tts-skill-code.js   (from server/ directory)
 *
 * This ensures the DB code_snippet matches the latest user_code.js on disk,
 * so autoRestoreRunners will deploy the correct version to all K8s pods.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
  const dbModule = require('../database-oracle');
  const db = await dbModule.init();
  const fs = require('fs');

  // Read the latest TTS code from scripts/tts-skill-code.js (reference copy)
  // NOTE: skill_runners/ is NFS-mounted in K8s and may have stale code,
  // so we keep a reference copy in scripts/ which is always from the Docker image
  const codePath = path.join(__dirname, 'tts-skill-code.js');
  if (!fs.existsSync(codePath)) {
    console.error('user_code.js not found at', codePath);
    process.exit(1);
  }
  const newCode = fs.readFileSync(codePath, 'utf8');

  // Find all TTS-related skills
  const rows = await db.prepare(
    `SELECT id, name FROM skills WHERE (UPPER(name) LIKE '%TTS%') OR (UPPER(name) LIKE '%轉聲音%') OR (UPPER(name) LIKE '%語音%')`
  ).all();
  console.log('Matched skills:', rows.map(r => `${r.id}:${r.name}`).join(', '));

  if (!rows.length) { console.error('No matching skill'); process.exit(1); }

  for (const row of rows) {
    await db.prepare(`UPDATE skills SET code_snippet=:1 WHERE id=:2`).run(newCode, row.id);
    console.log(`Updated code_snippet for skill ID=${row.id} (${row.name})`);
  }
  console.log(`\nDone! ${rows.length} skill(s) updated. Pods will auto-sync on next restart via autoRestoreRunners.`);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
