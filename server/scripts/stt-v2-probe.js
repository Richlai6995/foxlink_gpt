'use strict';
/**
 * STT v2 go/no-go probe — P1 驗證(chunked,chirp_3 BatchRecognize 有 20 分上限)
 *
 * 流程:ffprobe 量長度 → 切 ≤CHUNK 分鐘小段(必轉 FLAC,m4a auto-decode 會 empty)
 *      → 各段並行 BatchRecognize(chirp_3)→ word timestamp 加 chunk offset → concat
 *
 * 跑法:
 *   node scripts/stt-v2-probe.js <audio> --bucket=foxlink-stt-test --location=us --model=chirp_3 \
 *        --lang=cmn-Hant-TW [--minutes=5] [--chunk=15]
 *   --minutes=0 → 全長;--minutes=N → 只測前 N 分;--chunk=15 → 每段秒數上限(<20)
 *
 * 前置(P0):見前次說明(enable speech API + bucket + SA roles + npm i @google-cloud/speech storage)
 */

try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); } catch (_) {}

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function arg(name, def) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=').slice(1).join('=') : def;
}
const audioPath = process.argv[2];
const bucket = arg('bucket', process.env.STT_BUCKET);
const location = arg('location', 'us');
const model = arg('model', 'chirp_3');
const langCodes = arg('lang', 'cmn-Hant-TW').split(',');
const minutes = parseInt(arg('minutes', '5'), 10);
const CHUNK_SEC = parseInt(arg('chunk', '15'), 10) * 60;
const projectId = process.env.GCP_PROJECT_ID;
const CONCURRENCY = 4;

if (!audioPath || !bucket || !projectId) {
  console.error('用法: node stt-v2-probe.js <audio> --bucket=<gcs> [--location=us] [--model=chirp_3] [--lang=cmn-Hant-TW] [--minutes=0] [--chunk=15]');
  process.exit(1);
}
let speech, storage;
try { speech = require('@google-cloud/speech').v2; storage = require('@google-cloud/storage'); }
catch (e) { console.error('FATAL: npm i @google-cloud/speech @google-cloud/storage'); process.exit(1); }

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${code}: ${err.slice(0, 300)}`))));
  });
}
const fmt = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60; return (h ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; };
const offSec = (o) => (o ? Number(o.seconds || 0) + Number(o.nanos || 0) / 1e9 : 0);

async function probeDur(f) {
  try { const o = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]); return parseFloat(o.trim()) || 0; }
  catch { return 0; }
}

// 切一段 [start,start+dur] → 16kHz mono FLAC
async function clipFlac(start, dur) {
  const out = path.join(os.tmpdir(), `sttp_${start}_${Date.now()}.flac`);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(dur), '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'flac', '-y', out]);
  return out;
}

// 一段:upload → BatchRecognize → words(+startOffset)
async function recognizeChunk(client, gcs, recognizer, localFlac, startOffset, idx) {
  const obj = `stt-probe/${Date.now()}_${idx}.flac`;
  await gcs.bucket(bucket).upload(localFlac, { destination: obj });
  const uri = `gs://${bucket}/${obj}`;
  const isChirp = /chirp/i.test(model);
  const features = { enableWordTimeOffsets: true };
  if (!isChirp) { features.enableWordConfidence = true; features.diarizationConfig = { minSpeakerCount: 1, maxSpeakerCount: 6 }; }
  let words = [], text = '', err = null;
  try {
    const [op] = await client.batchRecognize({
      recognizer,
      config: { autoDecodingConfig: {}, model, languageCodes: langCodes, features },
      files: [{ uri }],
      recognitionOutputConfig: { inlineResponseConfig: {} },
    });
    const [resp] = await op.promise();
    const fr = (resp.results && resp.results[uri]) || {};
    if (fr.error) err = fr.error.message;
    const inner = (fr.transcript && fr.transcript.results) || [];
    for (const r of inner) {
      const alt = r.alternatives && r.alternatives[0]; if (!alt) continue;
      if (alt.transcript) text += alt.transcript;
      for (const w of (alt.words || [])) words.push({ word: w.word, start: offSec(w.startOffset) + startOffset, end: offSec(w.endOffset) + startOffset, conf: w.confidence, speaker: w.speakerLabel ?? w.speakerTag });
    }
  } catch (e) { err = e.message; }
  await gcs.bucket(bucket).file(obj).delete().catch(() => {});
  try { fs.unlinkSync(localFlac); } catch (_) {}
  return { idx, startOffset, words, text, err };
}

(async () => {
  const t0 = Date.now();
  console.log(`STT v2 probe — project=${projectId} location=${location} model=${model} lang=${langCodes.join(',')} minutes=${minutes || 'FULL'} chunk=${CHUNK_SEC / 60}min`);
  console.log('---');

  const totalDur = await probeDur(audioPath);
  const effDur = minutes > 0 ? Math.min(minutes * 60, totalDur || minutes * 60) : (totalDur || 0);
  if (!effDur) { console.error('ffprobe 量不到長度'); process.exit(1); }
  const nChunks = Math.ceil(effDur / CHUNK_SEC);
  console.log(`音長 ${fmt(totalDur)},測 ${fmt(effDur)} → 切 ${nChunks} 段(每段 ≤${CHUNK_SEC / 60}分)`);

  const apiEndpoint = location === 'global' ? 'speech.googleapis.com' : `${location}-speech.googleapis.com`;
  const client = new speech.SpeechClient({ apiEndpoint });
  const gcs = new storage.Storage();
  const recognizer = `projects/${projectId}/locations/${location}/recognizers/_`;

  // 並行(concurrency=CONCURRENCY)轉碼+辨識
  const chunkDefs = [];
  for (let i = 0; i < nChunks; i++) chunkDefs.push({ idx: i, start: i * CHUNK_SEC, dur: Math.min(CHUNK_SEC, effDur - i * CHUNK_SEC) });
  const results = new Array(nChunks);
  for (let i = 0; i < nChunks; i += CONCURRENCY) {
    const batch = chunkDefs.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (c) => {
      const tC = Date.now();
      const flac = await clipFlac(c.start, c.dur);
      const r = await recognizeChunk(client, gcs, recognizer, flac, c.start, c.idx);
      results[c.idx] = r;
      console.log(`  段 ${c.idx + 1}/${nChunks} [${fmt(c.start)}-${fmt(c.start + c.dur)}] ${r.err ? `❌ ${r.err}` : `✅ ${r.text.length}字`} (${((Date.now() - tC) / 1000).toFixed(0)}s)`);
    }));
  }

  const allWords = results.flatMap((r) => (r ? r.words : []));
  const fullText = results.map((r) => (r ? r.text : '')).join('');
  const speakers = [...new Set(allWords.map((w) => w.speaker).filter((s) => s != null && s !== ''))];
  const confs = allWords.map((w) => w.conf).filter((c) => typeof c === 'number');
  const errCount = results.filter((r) => r && r.err).length;

  // 寫完整逐字稿(每 60s 插時間戳)
  const outTxt = path.join(process.cwd(), `stt_probe_out_${model}_${Date.now()}.txt`);
  let body = '', lastMark = -60;
  for (const w of allWords) { if (w.start - lastMark >= 60) { body += `\n\n[${fmt(w.start)}]\n`; lastMark = w.start; } body += w.word; }
  fs.writeFileSync(outTxt, `STT ${model} | 測 ${fmt(effDur)} | ${fullText.length}字 | ${nChunks}段(${errCount}失敗)\n${'='.repeat(50)}\n${body}`, 'utf-8');

  // 報告
  console.log('\n========== go/no-go 報告 ==========');
  console.log(`① diarization: ${speakers.length ? `✅ ${speakers.length} speaker` : '❌ 無(chirp 不支援)'}`);
  console.log(`② word timestamp: ${allWords.length && allWords[0].end > 0 ? '✅' : '❌'}  confidence: ${confs.length ? `平均 ${(confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(2)}` : '❌ 無(chirp)'}`);
  console.log(`③ 測 ${fmt(effDur)} / ${fullText.length} 字 / ${allWords.length} word / ${nChunks} 段(${errCount} 失敗)`);
  const billMin = Math.ceil(effDur / 60);
  console.log(`   估算成本: ${billMin} 分 × $0.024 = $${(billMin * 0.024).toFixed(2)}  |  耗時 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`📄 完整逐字稿: ${outTxt}`);
  console.log('\n========== 開頭 1200 字預覽 ==========\n' + fullText.slice(0, 1200));
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });
