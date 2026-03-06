require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const oracledb = require('oracledb');

async function main() {
  // Init Thick mode
  const libDir = process.env.ORACLE_HOME;
  if (libDir) {
    try {
      oracledb.initOracleClient({ libDir });
      console.log('[OK] Thick mode libDir:', libDir);
    } catch (e) {
      if (!e.message.includes('already been called')) throw e;
    }
  }

  const connectString =
    process.env.SYSTEM_DB_CONNECT_STRING ||
    `${process.env.SYSTEM_DB_HOST}:${process.env.SYSTEM_DB_PORT}/${process.env.SYSTEM_DB_SERVICE_NAME}`;

  console.log('[..] Connecting to', connectString, 'as', process.env.SYSTEM_DB_USER);

  let conn;
  try {
    conn = await oracledb.getConnection({
      user:          process.env.SYSTEM_DB_USER,
      password:      process.env.SYSTEM_DB_USER_PASSWORD,
      connectString,
    });
    console.log('[OK] Connected!');

    // 查 Oracle 版本
    const ver = await conn.execute(`SELECT BANNER FROM V$VERSION WHERE ROWNUM=1`);
    console.log('[OK] DB Version:', ver.rows[0][0]);

    // 查現有 table 清單
    const tables = await conn.execute(
      `SELECT TABLE_NAME FROM USER_TABLES ORDER BY TABLE_NAME`
    );
    if (tables.rows.length === 0) {
      console.log('[INFO] No tables found — schema not yet created');
    } else {
      console.log(`[OK] Tables (${tables.rows.length}):`);
      tables.rows.forEach(r => console.log('  -', r[0]));
    }

    // 查預設 tablespace
    const ts = await conn.execute(
      `SELECT DEFAULT_TABLESPACE, TEMPORARY_TABLESPACE FROM USER_USERS WHERE USERNAME=USER`
    );
    console.log('[OK] Default tablespace:', ts.rows[0][0], '/ Temp:', ts.rows[0][1]);

  } finally {
    if (conn) await conn.close();
    console.log('[OK] Connection closed');
  }
}

main().catch(e => {
  console.error('[FAIL]', e.message);
  process.exit(1);
});
