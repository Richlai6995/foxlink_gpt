'use strict';
/**
 * Backfill:把背景長音檔轉錄 job 漏記的 token 補進 token_usage。
 *
 * 背景:transcribeJobService 原本只把 token 存在 transcribe_jobs.in/out_tokens_total,
 *      沒寫 dashboard 讀的 token_usage → 長音檔轉錄不計費(已於 forward commit 修正)。
 *      此 script 補「forward 修正前完成」的既有 job。
 *
 * 防重複計:只處理 tokens_billed=0/NULL 的 job,補完設 tokens_billed=1。
 *   - forward 路徑完成時會設 tokens_billed=1 → 新 job 不會被這支重複計。
 *   - script 本身可安全重跑(只碰 tokens_billed=0 的)。
 *
 * model 假設:job 列沒存每段是 Pro/Flash(舊 segments_json 無 model)→ 預設全算 Pro
 *   (略高估,因部分段可能 retry 到 Flash)。可用 --model=<key> 覆寫(如 flash)。
 * 計費日期:用 completed_at(無則 created_at),非今天。
 *
 * 跑法(K8s pod 內):
 *   kubectl exec -n foxlink <pod> -- node /app/scripts/backfill-transcribe-token-usage.js --dry-run
 *   確認 sample OK 後拿掉 --dry-run 再跑一次(LIVE)。
 *   選配:--model=flash / --user=<id>(只補某 user)
 */

try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); }
catch (_) { /* K8s pod 沒 dotenv,跳過 */ }

let db;
try { db = require('../database-oracle').db; }
catch (_) { db = require('/app/database-oracle').db; }

let upsertTokenUsage;
try { ({ upsertTokenUsage } = require('../services/tokenService')); }
catch (_) { ({ upsertTokenUsage } = require('/app/services/tokenService')); }
if (typeof upsertTokenUsage !== 'function') {
  console.error('FATAL: upsertTokenUsage 沒從 tokenService exports 出來');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const modelArg = (process.argv.find(a => a.startsWith('--model=')) || '').split('=')[1] || 'pro';
const userArg = (process.argv.find(a => a.startsWith('--user=')) || '').split('=')[1] || null;

(async () => {
  console.log(`Backfill transcribe token_usage  model=${modelArg}${userArg ? ` user=${userArg}` : ''}  ${dryRun ? '(DRY-RUN)' : '(LIVE)'}`);
  console.log('---');

  const params = [];
  let userFilter = '';
  if (userArg) { userFilter = ' AND user_id = ?'; params.push(parseInt(userArg)); }

  const rows = await db.prepare(`
    SELECT id, user_id,
           COALESCE(in_tokens_total,0)  AS in_tok,
           COALESCE(out_tokens_total,0) AS out_tok,
           TO_CHAR(COALESCE(completed_at, created_at, SYSTIMESTAMP), 'YYYY-MM-DD') AS billed_date,
           audio_filename
    FROM transcribe_jobs
    WHERE status IN ('done','failed')
      AND COALESCE(tokens_billed,0) = 0
      AND (COALESCE(in_tokens_total,0) > 0 OR COALESCE(out_tokens_total,0) > 0)${userFilter}
    ORDER BY completed_at
  `).all(...params);

  console.log(`Loaded ${rows.length} unbilled job(s)`);

  let billed = 0, totalIn = 0, totalOut = 0, failed = 0;
  for (const r of rows) {
    const id = r.id || r.ID;
    const userId = r.user_id ?? r.USER_ID;
    const inTok = Number(r.in_tok ?? r.IN_TOK) || 0;
    const outTok = Number(r.out_tok ?? r.OUT_TOK) || 0;
    const date = r.billed_date || r.BILLED_DATE;
    const fname = r.audio_filename || r.AUDIO_FILENAME || '';
    console.log(`  job=${String(id).slice(0, 8)} user=${userId} ${date} in=${inTok} out=${outTok}  ${fname}`);
    if (dryRun) { totalIn += inTok; totalOut += outTok; billed++; continue; }
    try {
      await upsertTokenUsage(db, userId, date, modelArg, inTok, outTok, 0);
      await db.prepare(`UPDATE transcribe_jobs SET tokens_billed=1, updated_at=SYSTIMESTAMP WHERE id=?`).run(id);
      billed++; totalIn += inTok; totalOut += outTok;
    } catch (e) {
      failed++;
      console.warn(`    ! job ${id} failed: ${e.message}`);
    }
  }

  console.log('---');
  console.log(`Result: ${billed} job(s) ${dryRun ? 'would be' : 'were'} billed, ${failed} failed.`);
  console.log(`Total tokens: in=${totalIn.toLocaleString()} out=${totalOut.toLocaleString()} (model=${modelArg})`);
  if (dryRun) console.log('\n*** DRY-RUN — 沒實際寫入。確認 sample OK 後拿掉 --dry-run 再跑一次 ***');
  process.exit(0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
});
