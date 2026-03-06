require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');

async function main() {
  // Init Thick mode
  const libDir = process.env.ORACLE_HOME;
  if (libDir) {
    try { oracledb.initOracleClient({ libDir }); } catch (e) {
      if (!e.message.includes('already been called')) throw e;
    }
  }

  const connectString =
    process.env.SYSTEM_DB_CONNECT_STRING ||
    `${process.env.SYSTEM_DB_HOST}:${process.env.SYSTEM_DB_PORT}/${process.env.SYSTEM_DB_SERVICE_NAME}`;

  console.log('Connecting to', connectString, 'as', process.env.SYSTEM_DB_USER);
  const conn = await oracledb.getConnection({
    user:          process.env.SYSTEM_DB_USER,
    password:      process.env.SYSTEM_DB_USER_PASSWORD,
    connectString,
  });
  console.log('Connected.\n');

  const sql = fs.readFileSync(path.join(__dirname, 'create-schema.sql'), 'utf8');

  // Split by lines that are exactly '/' (SQL*Plus block terminator)
  const blocks = sql.split(/^\s*\/\s*$/m)
    .map(b => b.trim())
    .filter(b => {
      // Only skip blocks that have no actual SQL after stripping comments
      const code = b.replace(/--[^\n]*/g, '').trim();
      return code.length > 0;
    });

  let ok = 0, skip = 0, fail = 0;

  for (const block of blocks) {
    const code = block.replace(/--[^\n]*/g, '').trim();
    if (!code) continue;

    try {
      await conn.execute(block, [], { autoCommit: true });
      ok++;
      // Extract first meaningful line for display
      const firstLine = block.split('\n').find(l => l.trim() && !l.trim().startsWith('--')) || '';
      console.log(`[OK]   ${firstLine.slice(0, 80).trim()}`);
    } catch (e) {
      // ORA-00955 = already exists, ORA-01408 = index already exists → skip
      if (e.errorNum === 955 || e.errorNum === 1408) {
        skip++;
        const firstLine = block.split('\n').find(l => l.trim() && !l.trim().startsWith('--')) || '';
        console.log(`[SKIP] ${firstLine.slice(0, 80).trim()} (already exists)`);
      } else {
        fail++;
        console.error(`[FAIL] ${e.message}`);
        console.error('       Block:', block.slice(0, 200));
      }
    }
  }

  await conn.close();
  console.log(`\nDone. OK=${ok}  SKIP=${skip}  FAIL=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
