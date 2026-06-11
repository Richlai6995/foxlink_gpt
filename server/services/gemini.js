require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { classifyUpload } = require('../utils/uploadFileTypes');
const { getGenerativeModel, extractText, extractUsage } = require('./geminiClient');

const MODEL_PRO = process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview';
const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';

/**
 * Parse uploaded file into Gemini Part
 */
async function fileToGeminiPart(filePath, mimeType) {
  const data = fs.readFileSync(filePath);
  return {
    inlineData: {
      data: data.toString('base64'),
      mimeType,
    },
  };
}

// Max characters per extracted file (~25k tokens); larger content is truncated
const MAX_EXTRACTED_CHARS = 100000;
// Max rows per sheet when reading Excel (xlsx sheetRows option)
const MAX_EXCEL_ROWS_PER_SHEET = 2000;
// Max pages to parse from PDF (prevent OOM on large files)
const MAX_PDF_PAGES = 80;

function truncate(text, label) {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return text.slice(0, MAX_EXTRACTED_CHARS) + `\n\n[⚠️ ${label} 內容過長，已截斷顯示前 ${MAX_EXTRACTED_CHARS} 字元]`;
}

/**
 * Extract text from Office/PDF files
 */
async function extractTextFromFile(filePath, mimeType, originalName) {
  try {
    console.log(`[Gemini] extractTextFromFile: "${originalName}" (${mimeType})`);
    if (mimeType === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const fileSize = fs.statSync(filePath).size;
      console.log(`[Gemini] PDF size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
      const dataBuffer = fs.readFileSync(filePath);
      // Limit pages to prevent OOM; wrap with 30s timeout to avoid hanging
      const parseTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PDF 解析超時 (30s)')), 30000)
      );
      const data = await Promise.race([
        pdfParse(dataBuffer, { max: MAX_PDF_PAGES }),
        parseTimeout,
      ]);
      const pages = data.numpages || '?';
      console.log(`[Gemini] PDF parsed: ${pages} pages, ${data.text.length} chars`);
      const note = pages > MAX_PDF_PAGES
        ? `\n\n[⚠️ PDF 共 ${pages} 頁，僅解析前 ${MAX_PDF_PAGES} 頁]`
        : '';
      return truncate(`[PDF: ${originalName}]\n${data.text}`, originalName) + note;
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return truncate(`[Word: ${originalName}]\n${result.value}`, originalName);
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      const XLSX = require('xlsx');
      // Limit rows per sheet to avoid memory explosion on large files
      const workbook = XLSX.readFile(filePath, { sheetRows: MAX_EXCEL_ROWS_PER_SHEET });
      const sheetNames = workbook.SheetNames;
      let text = `[Excel: ${originalName}]\n`;
      for (const name of sheetNames) {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
        if (csv.replace(/,/g, '').trim().length === 0) continue; // skip blank sheets
        text += `\nSheet: ${name}\n${csv}\n`;
        if (text.length > MAX_EXTRACTED_CHARS) {
          text = text.slice(0, MAX_EXTRACTED_CHARS);
          text += `\n\n[⚠️ Excel 內容過長，已截斷（共 ${sheetNames.length} 個工作表，僅顯示部分）]`;
          break;
        }
      }
      return text;
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-powerpoint'
    ) {
      const JSZip = require('jszip');
      const data = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(data);
      let text = `[PowerPoint: ${originalName}]\n`;
      const slideFiles = Object.keys(zip.files)
        .filter((f) => f.match(/ppt\/slides\/slide\d+\.xml/))
        .sort();
      for (const sf of slideFiles) {
        const content = await zip.files[sf].async('string');
        const plainText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        text += plainText + '\n';
        if (text.length > MAX_EXTRACTED_CHARS) {
          text = text.slice(0, MAX_EXTRACTED_CHARS) + '\n\n[⚠️ PPT 內容過長，已截斷]';
          break;
        }
      }
      return text;
    }

    // text/* or code/config/log files (extension-based fallback for empty/octet-stream mimes)
    const c = classifyUpload(originalName, mimeType);
    if (c.ok && c.kind === 'text') {
      // .eml — RFC 5322 email. 直接 readFileSync 會把 base64 附件 + encoded-word
      // headers 塞給 LLM,品質爛。用 mailparser 抽乾淨的 headers + body + attachment list。
      if (c.ext === '.eml') {
        try {
          const { parseEml } = require('./emlParser');
          const { text } = await parseEml(filePath);
          return truncate(`[Email: ${originalName}]\n${text}`, originalName);
        } catch (err) {
          console.warn(`[Gemini] .eml parse failed for "${originalName}": ${err.message} — falling back to raw text`);
        }
      }
      // Jupyter notebook: extract only cell sources, skip base64 outputs
      if (c.ext === '.ipynb') {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const nb = JSON.parse(raw);
          const cells = Array.isArray(nb.cells) ? nb.cells : [];
          const lang = (nb.metadata && nb.metadata.kernelspec && nb.metadata.kernelspec.language) || 'python';
          let out = `[Jupyter: ${originalName}] (language=${lang}, cells=${cells.length})\n`;
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const src = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
            if (!src.trim()) continue;
            out += `\n# Cell ${i + 1} [${cell.cell_type || 'unknown'}]\n${src}\n`;
            if (out.length > MAX_EXTRACTED_CHARS) break;
          }
          return truncate(out, originalName);
        } catch (err) {
          console.warn(`[Gemini] .ipynb parse failed for "${originalName}": ${err.message} — falling back to raw text`);
        }
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const tagMap = { code: 'Code', config: 'Config', log: 'Log', special: 'Config', doc: 'Text' };
      const tag = tagMap[c.subtype] || 'Text';
      const header = c.ext ? `[${tag}: ${originalName}${c.ext ? ` (${c.ext})` : ''}]` : `[${tag}: ${originalName}]`;
      return truncate(`${header}\n${raw}`, originalName);
    }
  } catch (e) {
    console.error(`[Gemini] extractTextFromFile FAILED for "${originalName}":`, e.message);
    console.error(`[Gemini] Stack:`, e.stack);
  }
  return null;
}

/**
 * Transcribe audio file using Gemini
 * @param {string} filePath
 * @param {string} mimeType
 * @param {string|number} [langOrTimeout] - language code ('zh-TW' | 'en' | 'vi') OR legacy timeoutMs (number)
 * @param {number} [timeoutMs] - max wait time
 * @param {object} [opts]
 * @param {boolean} [opts.useProModel] - use MODEL_PRO instead of MODEL_FLASH (long audio benefits from Pro)
 * @param {boolean} [opts.verbatim] - use verbatim prompt (forbid summarization, keep filler words)
 */
// ── 偵測 Gemini 轉錄「跑掉」(repetition loop / 脫稿幻覺)──────────────────────
// 失效模式:靜音、低訊噪、或口語贅字(「那…那…」)的段落,greedy decoding 卡進「重複同一
// token」迴圈(那那那…幾百次),無隨機性可逃脫;吐到 context 飄移後語言先驗接管 → 生出流暢
// 但與音訊無關的內容(常見簡體散文/小說)。重複迴圈是脫稿的橋 → 截在重複起點同時砍掉幻覺。
// 回傳 { degenerate, reason, cleanText },cleanText = 最佳可救前綴(無乾淨切點時 = 全文,僅標記)。
function _detectDegenerate(text, lang) {
  if (!text || text.length < 40) return { degenerate: false };

  // 1) 連續同字 ≥ DEGEN_CHAR_RUN_MIN(那那那… / 。。。…):repetition loop 最典型,截在起點
  const run = text.match(new RegExp(`(.)\\1{${DEGEN_CHAR_RUN_MIN - 1},}`, 'u'));
  if (run) {
    return { degenerate: true, reason: `char-run "${run[1]}"×${run[0].length}`, cleanText: text.slice(0, run.index).trim() };
  }

  // 2) 短語/句子重複迴圈:8~60 字片段連續重複 ≥ DEGEN_PHRASE_REPEAT_MIN 次,截在起點
  const phrase = text.match(new RegExp(`(.{8,60}?)\\1{${DEGEN_PHRASE_REPEAT_MIN - 1},}`, 'su'));
  if (phrase) {
    return { degenerate: true, reason: `phrase-loop ×${Math.floor(phrase[0].length / phrase[1].length)}`, cleanText: text.slice(0, phrase.index).trim() };
  }

  // 3) zh-TW 任務卻大量簡體字 → 脫稿自由生成(無重複橋可乾淨截斷,整段重試;保留全文僅標記)。
  //    prompt 已強制繁體,正常輸出應幾乎 0 個簡體獨有字,出現一堆即模型脫稿的可靠訊號。
  if (lang === 'zh-TW') {
    const simp = (text.match(/[们这边东车专门类资过还进运际质达员见观图实发务团队样阳树叶恋绝经历应个为觉间长现开关难让离时会单脑铭]/gu) || []).length;
    const cjk = (text.match(/[一-鿿]/gu) || []).length || 1;
    if (simp >= DEGEN_SIMPLIFIED_MIN && simp / cjk >= DEGEN_SIMPLIFIED_RATIO) {
      return { degenerate: true, reason: `simplified-hallucination simp=${simp}/${cjk}`, cleanText: text };
    }
  }

  return { degenerate: false };
}

async function transcribeAudio(filePath, mimeType, langOrTimeout, timeoutMs = 25 * 60 * 1000, opts = {}) {
  // Backward-compat: old callers pass (filePath, mimeType, timeoutMs:number)
  let lang;
  if (typeof langOrTimeout === 'number') {
    timeoutMs = langOrTimeout;
    lang = undefined;
  } else {
    lang = langOrTimeout;
  }

  const useProModel = opts.useProModel === true;
  const verbatim = opts.verbatim === true;
  // 預設 greedy(0);_transcribeWithRetry 在偵測到脫稿/重複時會用後段 attempt 加溫(0.4)逃脫迴圈
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0;

  const PROMPTS_NORMAL = {
    'zh-TW': '請完整轉錄這段音訊，使用繁體中文，只回傳轉錄文字，不要加任何說明。',
    'en':    'Please transcribe this audio completely in English. Return only the transcription, no explanations.',
    'vi':    'Vui lòng phiên âm hoàn chỉnh đoạn âm thanh này bằng tiếng Việt. Chỉ trả lời nội dung phiên âm, không thêm giải thích.',
  };
  // Verbatim prompt 對 Gemini 偷懶問題的反制:明確禁止省略/摘要/合併,要求保留口語贅詞
  const PROMPTS_VERBATIM = {
    'zh-TW': '請逐字完整轉錄這段音訊，使用繁體中文。絕對不可以省略、摘要、合併或重組內容。每位發言者每一句話都要保留，包含「嗯」「對」「然後」「就是」等口語贅詞和填充詞、重複詞。換人講話時換行。只回傳逐字稿，不要加任何說明、標題、摘要、整理。',
    'en':    'Please verbatim transcribe this audio in English. Do NOT summarize, omit, merge, or reorganize any content. Keep every utterance from every speaker including filler words like "uh", "um", "you know", and repetitions. Use line breaks when speaker changes. Return ONLY the verbatim transcript, no explanations, headings, or summaries.',
    'vi':    'Vui lòng phiên âm nguyên văn đoạn âm thanh này bằng tiếng Việt. KHÔNG được tóm tắt, bỏ sót, gộp hoặc sắp xếp lại nội dung. Giữ lại mọi câu nói của mọi người phát biểu, bao gồm cả các từ đệm. Xuống dòng khi đổi người nói. Chỉ trả lời phiên âm nguyên văn, không thêm giải thích, tiêu đề hay tóm tắt.',
  };
  const PROMPTS = verbatim ? PROMPTS_VERBATIM : PROMPTS_NORMAL;
  const prompt = PROMPTS[lang] || PROMPTS['zh-TW'];

  // 取檔案 size 給 log 用 (用來判斷是不是因為太大 inline 失敗)
  let fileSizeMB = -1;
  try { fileSizeMB = +(fs.statSync(filePath).size / 1024 / 1024).toFixed(2); } catch {}
  const tagId = `${path.basename(filePath)}|${fileSizeMB}MB`;
  console.log(`[Transcribe] start ${tagId} mime=${mimeType} lang=${lang || 'auto'} timeout=${timeoutMs}ms model=${useProModel ? 'pro' : 'flash'} verbatim=${verbatim}`);

  // 音訊轉錄走 Vertex global REST(2026-05-08 起):
  //   舊版寫死 Studio 是因為 Vertex gRPC 4MB inline 上限,但 new SDK + GCP_LOCATION=global
  //   走 REST endpoint,inline 容量寬鬆。Vertex 比 Studio 優勢:
  //     1. Quota 寬(default 1500-3000 RPM vs Studio Tier1 1000)
  //     2. 沒 Studio Pro 20 分鐘 silent deadline(可以跑 30+ 分鐘音訊)
  //     3. capacity pool 跟 Studio 不同,Studio 滿載時 Vertex 通常還活著
  //   實測若 Vertex inline 失敗,改回 'studio' fallback 即可。
  // maxOutputTokens 防呆:Pro 上限 65536、Flash 上限 8192。Gemini 預設值較保守,長音訊會被截斷。
  // thinkingBudget:轉錄是 perception 任務不是 reasoning 任務,Pro 預設 dynamic thinking
  // 會浪費 30-50% 時間在無謂思考。設 low(Pro=2048 / Flash=512)讓 SDK 直接轉錄。
  const modelName = useProModel ? MODEL_PRO : MODEL_FLASH;
  const maxOut = useProModel ? 65536 : 8192;
  const thinkingBudget = useProModel ? 2048 : 512;

  const tRead0 = Date.now();
  const audioPart = await fileToGeminiPart(filePath, mimeType);
  const base64MB = +(audioPart.inlineData.data.length / 1024 / 1024).toFixed(2);
  console.log(`[Transcribe] ${tagId} read+base64 done in ${Date.now() - tRead0}ms, base64=${base64MB}MB`);

  // 單次嘗試:給 provider 跑一次,回 { text, inputTokens, outputTokens, finishReason }
  // 失敗(timeout / SDK 5xx / empty text)會 throw,讓 caller 決定要不要 fallback
  const attempt = async (provider) => {
    const genConfig = {
      maxOutputTokens: maxOut,
      temperature,
      thinkingConfig: { thinkingBudget },
    };
    // frequencyPenalty:對「已出現過的 token」按次數懲罰 logit,是壓制「那那那…」重複迴圈的關鍵
    // knob(greedy 下也有效,會把重複字 logit 壓到讓別的 token 勝出 → 打斷迴圈、連帶避免脫稿)。
    // ★ 只在 vertex 開:實測 Vertex global 接受,但 Studio 端對 gemini-3.x 回
    //   400 "Penalty is not enabled for this model"。Studio 是 transient fallback 路徑,
    //   若帶 penalty 會讓「vertex 撞 503 → studio 兜底」整段 400 死掉。常數設 0 = 完全關閉。
    if (provider === 'vertex') {
      if (TRANSCRIBE_FREQUENCY_PENALTY > 0) genConfig.frequencyPenalty = TRANSCRIBE_FREQUENCY_PENALTY;
      if (TRANSCRIBE_PRESENCE_PENALTY > 0) genConfig.presencePenalty = TRANSCRIBE_PRESENCE_PENALTY;
    }
    const model = getGenerativeModel({
      model: modelName,
      provider,
      generationConfig: genConfig,
    });
    const tCall0 = Date.now();
    console.log(`[Transcribe] ${tagId} calling SDK (model=${modelName}, provider=${provider}, concurrency=${LONG_AUDIO_CONCURRENCY})...`);
    const callPromise = model.generateContent([audioPart, { text: prompt }]);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Audio transcription timeout (${(timeoutMs/60000).toFixed(1)} min)`)), timeoutMs)
    );
    let result;
    try {
      result = await Promise.race([callPromise, timeoutPromise]);
      console.log(`[Transcribe] ${tagId} ${provider} SDK responded in ${Date.now() - tCall0}ms`);
    } catch (e) {
      const elapsed = Date.now() - tCall0;
      console.error(
        `[Transcribe] ${tagId} ${provider} SDK FAILED after ${elapsed}ms\n` +
        `  message: ${e.message}\n` +
        `  name:    ${e.name}\n` +
        `  code:    ${e.code || 'n/a'}\n` +
        `  status:  ${e.status || e.statusCode || 'n/a'}\n` +
        `  cause:   ${e.cause?.message || e.cause?.code || 'n/a'}\n` +
        `  errorDetails: ${e.errorDetails ? JSON.stringify(e.errorDetails).slice(0, 500) : 'n/a'}\n` +
        `  response.data: ${e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : 'n/a'}`
      );
      throw e;
    }
    const usage = extractUsage(result);
    const text = extractText(result);
    const finishReason =
      result?.response?.candidates?.[0]?.finishReason ??
      result?.candidates?.[0]?.finishReason ?? 'unknown';
    console.log(`[Transcribe] ${tagId} ${provider} done text=${text.length}chars in=${usage.inputTokens} out=${usage.outputTokens} finish=${finishReason}`);
    if (!text || text.trim().length === 0) {
      const err = new Error(`Empty text (finishReason=${finishReason}, in=${usage.inputTokens}, out=${usage.outputTokens})`);
      err.code = 'TRANSCRIBE_EMPTY';
      throw err;
    }
    // 偵測「跑掉」:重複迴圈(那那那…)或脫稿幻覺(簡體小說)。當成可重試錯誤丟出,
    // 讓 _transcribeWithRetry 換模型 / 加溫重打;partialText 帶可救前綴給最終搶救用。
    const deg = _detectDegenerate(text, lang);
    if (deg.degenerate) {
      console.warn(`[Transcribe] ${tagId} ${provider} DEGENERATE (${deg.reason}) text=${text.length}chars salvage=${deg.cleanText.length}chars`);
      const err = new Error(`Degenerate output: ${deg.reason}`);
      err.code = 'TRANSCRIBE_DEGENERATE';
      err.degenerateReason = deg.reason;
      err.partialText = deg.cleanText;
      throw err;
    }
    return { text, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  };

  // 2026-05-13:Vertex flash 對某些 mp3 偶爾回 empty text(finishReason=STOP 但內容全在 thought
  // 被 filter)。對齊上面 line 210-216 註解「實測若 Vertex inline 失敗,改回 studio fallback」,
  // vertex 失敗 → 自動 retry studio 一次。兩者都失敗才 throw 給 chat handler。
  try {
    return await attempt('vertex');
  } catch (e1) {
    // 脫稿/重複是「內容問題」不是 provider 問題 — studio 八成一樣 loop,且 loop 會吐滿
    // maxOutputTokens(~6-13 分鐘/段)。別在這再跑一次 full degenerate,直接丟給上層
    // _transcribeWithRetry 用「加溫 + 換模型」escape(那才是打斷 loop 的有效手段)。
    if (e1.code === 'TRANSCRIBE_DEGENERATE') throw e1;
    console.warn(`[Transcribe] ${tagId} vertex FAILED (${e1.code || e1.message}), retrying with studio fallback...`);
    return await attempt('studio');
  }
}

// ── Long-audio transcription (ffmpeg split + parallel Pro) ────────────────────
// 為什麼要切片:Gemini 對 >30 分鐘音訊會自動「壓縮輸出」(即使指令說逐字),
// 表現為 finishReason=STOP 但 output 只有幾百 token。3.5 小時會議只回 2k token 就是這狀況。
// 切成 30 分鐘/段、每段獨立用 Pro 轉錄,attention 集中度大幅提升,單段就能吐滿 maxOutputTokens。

// 30 分鐘/段:Pro 對長段 verbatim 服從度高,內容更完整(Flash 即使 15 分鐘段仍偷懶)
const LONG_AUDIO_SEGMENT_SEC = 30 * 60;
// concurrency=7:全並發(2026-05-08 切 Vertex 後)。Vertex quota 寬(1500+ RPM)、
// 沒 Studio Pro 20 分鐘 deadline,可以全段同時送 SDK。
// 7 段 × 7-8 分鐘 / 7 並發 = 8-12 分鐘 total(對比 sequential ~50 分鐘)。
// 撞 503/quota 還有 retry+Flash fallback 兜底。
const LONG_AUDIO_CONCURRENCY = 7;
// per-seg 35 分鐘:Vertex 沒 Studio 20 分鐘 silent deadline,可以拉長給長 outlier 段
// (實測正常 part 3-9 分鐘,35 分鐘只是極端 fallback 上限)
const LONG_AUDIO_PER_SEG_TIMEOUT_MS = 35 * 60 * 1000;
const LONG_AUDIO_RETRY_BACKOFF_MS = [10000, 30000, 60000]; // 3 次 retry,10s/30s/60s

// ── Degenerate(重複迴圈/脫稿幻覺)防護 — 可調超參數 ───────────────────────────
// 改這裡就能調,不用動 transcribeAudio / _detectDegenerate / _transcribeWithRetry 內文。
const TRANSCRIBE_FREQUENCY_PENALTY = 0.5;  // 壓「已出現 token」logit,打斷「那那那…」重複迴圈(僅 vertex,Studio 不支援會 400)
const TRANSCRIBE_PRESENCE_PENALTY  = 0.3;  // 輕度鼓勵換新詞,進一步降 degenerate 機率(僅 vertex;設 0 完全關閉)
const TRANSCRIBE_RETRY_TEMPERATURE = 0.4;  // (transient retry 的後段 attempt 加溫)
const DEGEN_RETRY_TEMPERATURE = 0.7;  // degenerate 第 1 次 retry 溫度(第 2 次升到 1.0);皆保持 Pro
const DEGEN_MAX_ATTEMPTS = 3;         // degenerate 最多打幾次:Pro temp 0→0.7→1.0(實證 Pro+加溫才救得回)
const DEGEN_CHAR_RUN_MIN     = 20;    // 連續同字 ≥ N → 判定重複迴圈,截在起點
const DEGEN_PHRASE_REPEAT_MIN = 4;    // 8~60 字片段連續重複 ≥ N 次 → 判定 phrase loop
const DEGEN_SIMPLIFIED_MIN    = 20;   // zh-TW 出現 ≥ N 個簡體獨有字 → 判定脫稿幻覺
const DEGEN_SIMPLIFIED_RATIO  = 0.008; // 且簡體字 / CJK 字數 ≥ 此比例(避免零星簡體誤判)

function _runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function _probeAudioDuration(filePath) {
  try {
    const { stdout } = await _runCmd('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      filePath,
    ]);
    const sec = parseFloat(stdout.trim());
    return Number.isFinite(sec) ? sec : 0;
  } catch (e) {
    console.warn(`[ffprobe] duration probe failed: ${e.message}`);
    return 0;
  }
}

async function _splitAudio(filePath, segmentSec, outDir) {
  const ext = path.extname(filePath) || '.m4a';
  // -c copy 不重編碼(30 秒切完 185MB);-reset_timestamps 1 讓每段時間從 0 開始
  await _runCmd('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', filePath,
    '-f', 'segment',
    '-segment_time', String(segmentSec),
    '-c', 'copy',
    '-reset_timestamps', '1',
    '-y',
    path.join(outDir, `part_%03d${ext}`),
  ]);
  return fs.readdirSync(outDir)
    .filter((n) => n.startsWith('part_'))
    .sort()
    .map((n) => path.join(outDir, n));
}

function _fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// 判斷是不是值得 retry 的 transient error
function _isTransientGeminiErr(e) {
  const status = e?.status || e?.statusCode;
  if (status === 503 || status === 429 || status === 500) return true;
  const msg = (e?.message || '').toLowerCase();
  if (/unavailable|high demand|rate.?limit|resource.?exhausted|deadline|timeout|econnreset|socket hang up/i.test(msg)) return true;
  return false;
}

// 單段轉錄 + retry + 模型切換策略
// 策略:Pro 為主 + Flash 快速 fallback(第 2 次就 Flash,不浪費 2 次 Pro timeout)
//   attempt 0: Pro + verbatim    ← 主路徑,長段 verbatim 最完整
//   attempt 1: Flash + verbatim  ← 10s backoff,Pro 撞 deadline/503 直接 Flash 救
//                                  (實測 attempt 1 Pro 通常還是慢,不如直接 Flash)
//   attempt 2: Pro + verbatim    ← 30s backoff,給 Pro 一次恢復機會
//   attempt 3: Flash + verbatim  ← 60s backoff,最後保險
async function _transcribeWithRetry(partPath, mimeType, lang, segIdx, segTotal, tagId) {
  // 後兩次 attempt 加溫(temperature 0.4):degenerate(重複/脫稿)時 greedy 沒隨機性可逃,
  // 加溫 + 換模型給逃脫機會。frequencyPenalty 在 transcribeAudio 僅對 vertex 開(Studio 不支援)。
  const ATTEMPT_PLAN = [
    { useProModel: true,  temperature: 0,                          label: 'Pro' },
    { useProModel: false, temperature: 0,                          label: 'Flash' },
    { useProModel: true,  temperature: TRANSCRIBE_RETRY_TEMPERATURE, label: 'Pro+T' },
    { useProModel: false, temperature: TRANSCRIBE_RETRY_TEMPERATURE, label: 'Flash+T' },
  ];
  const maxAttempts = ATTEMPT_PLAN.length;
  let lastErr;
  let attemptsRun = 0;  // 實際跑了幾次(非 transient 會提早 break,別誤報 maxAttempts)
  let degenSeen = 0;    // 看過幾次 degenerate(脫稿/重複)
  // degenerate 專用 override:實證(2026-06-11)脫稿段唯一救得回的是「Pro + 加溫」,
  // 換 Flash 反而 loop 更嚴重(temp0:Pro ×654 vs Flash ×1326)。degenerate 是 greedy
  // decoding 問題不是模型能力問題 → 保持 Pro、純逐級加溫逃脫,不降級。
  let forceTemp = 0;    // >0 = 下一輪強制此溫度(plan 的 temp 太低,temp0 再跑只會再 loop)
  let forcePro = false; // true = 下一輪強制 Pro(degenerate 時別降 Flash)
  let bestSalvage = ''; // 跨 attempt 保留最長的「可救前綴」(degenerate 截斷前的正常內容)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attemptsRun = attempt + 1;
    const plan = ATTEMPT_PLAN[attempt];
    const opts = {
      useProModel: forcePro || plan.useProModel,
      verbatim: true,
      temperature: Math.max(plan.temperature, forceTemp),
    };
    forceTemp = 0;
    forcePro = false;
    try {
      const r = await transcribeAudio(partPath, mimeType, lang, LONG_AUDIO_PER_SEG_TIMEOUT_MS, opts);
      return {
        ok: true,
        text: r.text,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        attempts: attempt + 1,
      };
    } catch (e) {
      lastErr = e;
      const degenerate = e.code === 'TRANSCRIBE_DEGENERATE';
      if (degenerate) {
        degenSeen++;
        if ((e.partialText || '').length > bestSalvage.length) bestSalvage = e.partialText;
        // 逐級加溫:第 1 次 retry 0.7、第 2 次 1.0(都保持 Pro)
        forceTemp = degenSeen === 1 ? DEGEN_RETRY_TEMPERATURE : 1.0;
        forcePro = true;
      }
      // degenerate 最多打 DEGEN_MAX_ATTEMPTS 次(Pro temp 0→0.7→1.0):loop 一次跑滿
      // maxOutputTokens(~6-13 分鐘),逐級加溫逃脫;全沒救才 salvage(loop 前正常前綴)。
      const retriable = _isTransientGeminiErr(e) || (degenerate && degenSeen < DEGEN_MAX_ATTEMPTS);
      if (!retriable || attempt >= maxAttempts - 1) break;
      const wait = degenerate ? 2000 : LONG_AUDIO_RETRY_BACKOFF_MS[attempt];
      const nextTemp = degenSeen === 1 ? DEGEN_RETRY_TEMPERATURE : 1.0;
      const status = degenerate ? `DEGENERATE(${e.degenerateReason})` : (e?.status || e?.statusCode || 'UNKNOWN');
      const nextLabel = degenerate ? `Pro+T${nextTemp}` : (ATTEMPT_PLAN[attempt + 1]?.label || '?');
      console.warn(`[TranscribeLong] ${tagId} part ${segIdx}/${segTotal} attempt ${attempt + 1}/${maxAttempts} (${plan.label}) got ${status},等 ${wait}ms 後 retry (next=${nextLabel})`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  // 全打完仍 degenerate:有可救前綴(重複前的正常段)就回它 + 警示,別把整段丟掉或塞幻覺進 .txt
  if (bestSalvage && bestSalvage.length > 20) {
    console.warn(`[TranscribeLong] ${tagId} part ${segIdx}/${segTotal} 全 attempt degenerate,搶救前綴 ${bestSalvage.length}chars`);
    return {
      ok: true,
      text: `${bestSalvage}\n[⚠ 此段後半偵測到異常重複/脫稿幻覺,已自動截斷。原因: ${lastErr?.degenerateReason || 'degenerate'}]`,
      inputTokens: 0,
      outputTokens: 0,
      attempts: attemptsRun,
      degenerated: true,
    };
  }
  return {
    ok: false,
    text: `[此段轉錄失敗 (${attemptsRun} 次嘗試後仍失敗): ${lastErr?.message || 'unknown error'}]`,
    inputTokens: 0,
    outputTokens: 0,
    attempts: attemptsRun,
    error: lastErr?.message || 'unknown error',
  };
}

/**
 * Long-audio transcription: ffmpeg split → sequential Pro transcribe (with retry+fallback) → concat with time markers.
 * Use for files >50MB or >30 min where single-shot Gemini under-produces output.
 */
async function transcribeLongAudio(filePath, mimeType, lang) {
  const fileSizeMB = +(fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
  const tagId = `${path.basename(filePath)}|${fileSizeMB}MB`;
  const tStart = Date.now();
  console.log(`[TranscribeLong] start ${tagId} mime=${mimeType} lang=${lang || 'auto'}`);

  const tmpRoot = path.join(os.tmpdir(), `transcribe_${crypto.randomUUID()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const totalDuration = await _probeAudioDuration(filePath);
    console.log(`[TranscribeLong] ${tagId} duration=${_fmtTime(totalDuration)} (${totalDuration.toFixed(0)}s)`);

    const tSplit = Date.now();
    const parts = await _splitAudio(filePath, LONG_AUDIO_SEGMENT_SEC, tmpRoot);
    console.log(`[TranscribeLong] ${tagId} split into ${parts.length} parts in ${Date.now() - tSplit}ms`);

    if (parts.length === 0) {
      throw new Error('ffmpeg produced no segments');
    }

    // Sequential(concurrency=1)+ retry-with-backoff + Pro→Flash fallback
    // 每段最多 4 次嘗試(原始 + 3 retry):
    //   attempt 0/1/2 = Pro + verbatim,503/429 時 backoff 5s/15s/30s 後重打
    //   attempt 3 = Flash + verbatim(Pro 滿載時的最後逃生門)
    const results = new Array(parts.length);
    for (let i = 0; i < parts.length; i += LONG_AUDIO_CONCURRENCY) {
      const batch = parts.slice(i, i + LONG_AUDIO_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async (partPath, j) => {
        const idx = i + j;
        const tPart = Date.now();
        const r = await _transcribeWithRetry(partPath, mimeType, lang, idx + 1, parts.length, tagId);
        if (r.ok) {
          console.log(`[TranscribeLong] ${tagId} part ${idx + 1}/${parts.length} ok in ${Date.now() - tPart}ms text=${r.text.length}chars in=${r.inputTokens} out=${r.outputTokens} attempts=${r.attempts}`);
        } else {
          console.error(`[TranscribeLong] ${tagId} part ${idx + 1}/${parts.length} FAILED after ${Date.now() - tPart}ms attempts=${r.attempts}: ${r.error}`);
        }
        return r;
      }));
      batchResults.forEach((r, j) => { results[i + j] = r; });
    }

    let totalIn = 0;
    let totalOut = 0;
    const segments = results.map((r, idx) => {
      const startSec = idx * LONG_AUDIO_SEGMENT_SEC;
      const endSec = totalDuration > 0
        ? Math.min((idx + 1) * LONG_AUDIO_SEGMENT_SEC, totalDuration)
        : (idx + 1) * LONG_AUDIO_SEGMENT_SEC;
      const marker = `[${_fmtTime(startSec)}–${_fmtTime(endSec)}]`;
      totalIn += r.inputTokens;
      totalOut += r.outputTokens;
      return `${marker}\n${r.text}`;
    });
    const merged = segments.join('\n\n');

    console.log(`[TranscribeLong] ${tagId} ALL done in ${Date.now() - tStart}ms total=${merged.length}chars in=${totalIn} out=${totalOut} segs=${parts.length}`);
    return { text: merged, inputTokens: totalIn, outputTokens: totalOut };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {
      console.warn(`[TranscribeLong] tmp cleanup failed (${tmpRoot}): ${e.message}`);
    }
  }
}

/**
 * Build Gemini history from DB messages
 */
function buildHistory(messages) {
  return messages.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content || '' }],
  }));
}

/**
 * Stream chat response
 * @param {string} modelName - model identifier
 * @param {Array} history - previous messages [{role, parts}]
 * @param {Array} userParts - current user message parts
 * @param {Function} onChunk - callback(text)
 * @returns {Promise<{text: string, inputTokens: number, outputTokens: number}>}
 */
function buildSearchNotice(queries, sources) {
  let notice = '\n\n---\n🔍 **已使用 Google 搜尋取得最新資料**';
  if (queries.length) {
    notice += `\n搜尋關鍵字：${queries.map(q => `\`${q}\``).join('、')}`;
  }
  if (sources.length) {
    const unique = [...new Set(sources)].slice(0, 5);
    notice += '\n參考來源：\n' + unique.map(u => `- ${u}`).join('\n');
  }
  return notice;
}

/**
 * chat / tool-loop 路徑把 reasoning_effort("low"/"medium"/"high")+ apiModel 對應到
 * Gemini 的 thinkingBudget。與 OpenAI GPT-5.x reasoning_effort 語意對齊。
 *
 *   level       Flash    Pro
 *   low         512      2048
 *   medium      2048     8192
 *   high        8192     24576
 *   (未設)       512     undefined(=dynamic)
 *
 * 優先序:explicit_budget > reasoning_effort > chat 專用 default。
 * Flash default=512 是為避免 gemini-3-flash-preview 在 user-facing chat 中
 * dynamic thinking 吃 90+ 秒(2026-04-21 實測)。
 * Pro 沒 default 是因為選 Pro 的人本就要深度推理,讓 SDK 自己決定。
 *
 * **只在 chat 路徑用**(streamChat / generateWithToolsStream)。
 * dashboardService / researchService / kbDocParser 等 batch 服務不套這個 default,
 * 保留各自原有(dynamic)行為,避免意外限縮品質。
 */
/**
 * Gemini 只認 OpenAPI 3.0 子集,JSON Schema 2020-12 / OpenAPI 3.1 的部分 keyword
 * (例如 contentMediaType / contentEncoding / $schema / patternProperties / dependencies)
 * 會被 Vertex / AI Studio API 直接 400 INVALID_ARGUMENT 拒絕,且整批 tools[] 連帶炸掉。
 *
 * 這個函式遞迴清除這些不允許的欄位,讓任何 MCP server / Skill 作者上傳的 tool_schema
 * 都能餵進 Gemini,不會因為一個工具的 schema 誤用就讓整個 chat 路徑掛掉。
 *
 * 採 denylist 而非 allowlist:保守處理,不誤砍合法欄位(items.example 等)。
 * 若日後 Gemini 又改規則,新增名稱進 DISALLOWED_KEYS 即可。
 */
const DISALLOWED_SCHEMA_KEYS = new Set([
  // JSON Schema content/encoding(2019-09+)
  'contentMediaType', 'contentEncoding', 'contentSchema',
  // JSON Schema metadata
  '$schema', '$id', '$comment', '$anchor', '$dynamicAnchor', '$dynamicRef', '$vocabulary',
  // 條件 / 依賴 (Gemini 不支援)
  'if', 'then', 'else', 'dependentSchemas', 'dependentRequired', 'dependencies',
  // 進階
  'patternProperties', 'unevaluatedProperties', 'unevaluatedItems',
  'prefixItems', 'contains', 'minContains', 'maxContains',
  'definitions', '$defs',
  // OpenAPI 3.1 specific 但 Gemini 不認
  'readOnly', 'writeOnly', 'deprecated', 'externalDocs', 'xml',
]);

function sanitizeGeminiSchema(node, droppedRef) {
  if (Array.isArray(node)) return node.map(n => sanitizeGeminiSchema(n, droppedRef));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (DISALLOWED_SCHEMA_KEYS.has(k)) {
      if (droppedRef) droppedRef.add(k);
      continue;
    }
    out[k] = sanitizeGeminiSchema(v, droppedRef);
  }
  return out;
}

function sanitizeFunctionDeclarations(decls) {
  if (!Array.isArray(decls)) return decls;
  return decls.map((d, idx) => {
    const dropped = new Set();
    const safe = {
      ...d,
      parameters: d.parameters ? sanitizeGeminiSchema(d.parameters, dropped) : d.parameters,
      response:   d.response   ? sanitizeGeminiSchema(d.response,   dropped) : d.response,
    };
    if (dropped.size > 0) {
      console.warn(
        `[GeminiSchema] sanitized tool[${idx}] "${d.name || 'unknown'}" — dropped: ${[...dropped].join(', ')}`
      );
    }
    return safe;
  });
}

function _resolveThinkingBudget(apiModel, reasoningEffort, explicitBudget) {
  if (explicitBudget != null) return Number(explicitBudget);
  const isFlash = /flash/i.test(apiModel || '');
  if (reasoningEffort) {
    const LEVELS = {
      low:    isFlash ? 512  : 2048,
      medium: isFlash ? 2048 : 8192,
      high:   isFlash ? 8192 : 24576,
    };
    return LEVELS[reasoningEffort];
  }
  // chat 路徑 Flash default:避免 dynamic thinking 爆 ttft
  if (/gemini-3/i.test(apiModel || '') && isFlash) return 512;
  return undefined;
}

async function streamChat(apiModel, history, userParts, onChunk, extraSystemInstruction = '', disableSearch = false, genConfig = null, _retryDepth = 0) {
  // apiModel is the resolved API model string (e.g. 'gemini-3-pro-preview')
  console.log(`[Gemini] streamChat model=${apiModel} history=${history.length} userParts=${userParts.length} genConfig=${JSON.stringify(genConfig)}${_retryDepth ? ` retry=${_retryDepth}` : ''}`);

  // Disable Google Search grounding when inline file data is present
  // (Gemini API does not allow mixing googleSearch tool with inlineData parts)
  // Also disable when caller explicitly requests it (e.g. inject skill already provides data)
  const hasInlineData = userParts.some((p) => p.inlineData);
  const enableSearch = genConfig?.enable_search !== undefined ? genConfig.enable_search : true;
  const useSearch = !hasInlineData && !disableSearch && enableSearch;
  console.log(`[Gemini] hasInlineData=${hasInlineData}, googleSearch=${useSearch}`);

  const fullInstruction = extraSystemInstruction
    ? getSystemInstruction() + '\n\n---\n' + extraSystemInstruction
    : getSystemInstruction();

  // Build generationConfig from DB settings + defaults
  const thinkingBudget = _resolveThinkingBudget(apiModel, genConfig?.reasoning_effort, genConfig?.thinking_budget);
  const generationConfig = {
    maxOutputTokens: genConfig?.max_output_tokens || 65536,
    ...(genConfig?.temperature != null ? { temperature: genConfig.temperature } : {}),
    ...(genConfig?.top_p != null ? { topP: genConfig.top_p } : {}),
    ...(thinkingBudget != null ? { thinkingConfig: { thinkingBudget } } : {}),
  };

  // 帶 inlineData(圖片/大檔)自動降級走 Studio,避 Vertex gRPC 4MB payload 上限。
  // 純文字走 default(= GENERATE_PROVIDER,通常是 Vertex,速度快、有 googleSearch)。
  const model = getGenerativeModel({
    model: apiModel,
    systemInstruction: fullInstruction,
    generationConfig,
    tools: useSearch ? [{ googleSearch: {} }] : undefined,
    ...(hasInlineData ? { provider: 'studio' } : {}),
  });

  const chat = model.startChat({ history });
  console.log(`[Gemini] Sending message stream...`);
  const result = await chat.sendMessageStream(userParts);

  let fullText = '';
  let searchUsed = false;
  let finishedEarly = false;
  for await (const chunk of result.stream) {
    // extractText 統一處理兩個 SDK（AI Studio .text() / Vertex AI candidates.parts）；
    // 若完全無 text，檢查 finishReason 判斷是否異常終止。
    const chunkText = extractText(chunk);
    const fr = chunk.candidates?.[0]?.finishReason;
    if (!chunkText && fr && fr !== 'STOP') {
      if (fr === 'MAX_TOKENS') {
        console.warn(`[Gemini] 已達 maxOutputTokens 上限，輸出被截斷`);
        fullText += '\n\n[⚠️ 回應已達最大 Token 上限，內容可能不完整]';
        onChunk('\n\n[⚠️ 回應已達最大 Token 上限，內容可能不完整]');
        finishedEarly = true;
        break;
      }
      if (fr === 'UNEXPECTED_TOOL_CALL') {
        // Gemini 3 新增的 finishReason:model 試圖 call tool 但 declared tools 不含它。
        // 常見誘因:finalInstruction / history 裡暗示有 KB / function tool,但當輪 tools
        // 只有 googleSearch。Gemini 2.5 不會 surface 此 signal(靜默 fallback 純文字),
        // 3.x 變嚴格 → 整個 stream 被攔截。容錯處理:若已有 text 接受 partial,
        // 否則回一句提示,不炸整個 request。
        console.warn(`[Gemini] UNEXPECTED_TOOL_CALL — acceptingPartial fullLen=${fullText.length}`);
        if (!fullText) {
          const msg = '抱歉,模型嘗試呼叫未開放的工具,請換個問法或停用本次的知識庫 / 工具再試。';
          fullText = msg;
          onChunk(msg);
        }
        finishedEarly = true;
        break;
      }
      if (fr === 'RECITATION') {
        // Gemini safety filter:判定回應大量引述受保護/版權內容。常見於「最新法規 / 新聞 /
        // 產品規格」query 且 googleSearch grounding 回來的來源被視為原文 verbatim 引用。
        // 不是 bug — 是 Google 側 policy 攔截。容錯:接受已累積的 partial text,
        // 否則提示使用者換個問法(如加「請用自己的話摘要」、縮小 query 範圍)。
        console.warn(`[Gemini] RECITATION — acceptingPartial fullLen=${fullText.length}`);
        if (!fullText) {
          const msg = '抱歉,本次回應因引用內容過於接近原文被安全機制攔截。請嘗試:加註「用自己的話摘要」、縮小查詢範圍、或關閉網路搜尋再重問。';
          fullText = msg;
          onChunk(msg);
        } else {
          const notice = '\n\n[⚠️ 回應被引用保護機制攔截,以上為部分內容]';
          fullText += notice;
          onChunk(notice);
        }
        finishedEarly = true;
        break;
      }
      if (fr === 'MALFORMED_FUNCTION_CALL') {
        // Gemini 3 在 tool call args 生壞時(JSON 截斷 / 型別不對 / nested schema 太複雜)
        // 會丟整個 stream 並回 MALFORMED_FUNCTION_CALL。常見誘因:
        //   1) prompt 強制要求 call 某 tool 但 tools[] 沒掛該 tool(skill runner 死掉時最常見)
        //   2) tool schema 太複雜 / nested 太深(MCP 上來的 schema)
        //   3) 多 tool catalogs 同時出現,模型混淆
        // 容錯策略:
        //   a) 還沒 fullText 且未重試過 → 重跑一次(non-deterministic,常常第二次就過)
        //   b) 已重試 / 有 partial → 接受 partial 或回提示,不炸 request
        console.warn(`[Gemini] MALFORMED_FUNCTION_CALL — fullLen=${fullText.length} retryDepth=${_retryDepth}`);
        if (!fullText && _retryDepth === 0) {
          console.warn(`[Gemini] MALFORMED_FUNCTION_CALL — retrying once`);
          return await streamChat(apiModel, history, userParts, onChunk, extraSystemInstruction, disableSearch, genConfig, 1);
        }
        if (!fullText) {
          const msg = '抱歉,模型生成的工具呼叫格式錯誤(可能是工具未啟動或 schema 過於複雜)。請換個問法、減少附檔、或聯絡管理員確認相關工具狀態。';
          fullText = msg;
          onChunk(msg);
        } else {
          const notice = '\n\n[⚠️ 後續工具呼叫格式錯誤,以上為部分內容]';
          fullText += notice;
          onChunk(notice);
        }
        finishedEarly = true;
        break;
      }
      console.warn(`[Gemini] chunk 異常 finishReason=${fr}`);
      throw new Error(`Gemini 回應被攔截 (finishReason: ${fr})`);
    }
    if (chunkText) {
      fullText += chunkText;
      onChunk(chunkText);
    }
    // Check if search grounding was used
    const meta = chunk.candidates?.[0]?.groundingMetadata;
    if (meta?.webSearchQueries?.length) searchUsed = true;
  }

  const response = await result.response;
  const usage = extractUsage(response);

  // Append search notice if grounding was triggered
  if (searchUsed) {
    const groundingMeta = response.candidates?.[0]?.groundingMetadata;
    const queries = groundingMeta?.webSearchQueries || [];
    const sources = groundingMeta?.groundingChunks
      ?.map(c => c.web?.uri)
      .filter(Boolean) || [];
    if (queries.length || sources.length) {
      const notice = buildSearchNotice(queries, sources);
      fullText += notice;
      onChunk(notice);
    }
  }

  // 若完全無 text 產出且沒有異常，最後 fallback 從 response 抽一次（偶爾 stream chunk 全空）
  if (!fullText && !finishedEarly) {
    const finalText = extractText(response);
    if (finalText) {
      fullText = finalText;
      onChunk(finalText);
    } else {
      const fr = response.candidates?.[0]?.finishReason;
      console.warn(`[Gemini] stream 結束但 fullText 為空，finishReason=${fr}`);
    }
  }

  return {
    text: fullText,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

function getSystemInstruction() {
  return `# 檔案生成規則（最高優先級，必須嚴格遵守）

⚠️ **禁止自動生成檔案**：除非使用者在本次訊息中明確要求輸出/下載/生成/匯出特定格式的檔案（如 Word、PDF、Excel、PPT、TXT），否則**絕對不可**輸出任何 generate_xxx 代碼區塊。純文字分析、比較、建議、摘要等回應一律不得附帶檔案生成。

當使用者**明確**要求生成/匯出/下載/轉換/輸出特定格式的檔案時，你**必須**在回覆中直接寫出下方的程式碼區塊格式，並填入完整內容。
- 絕對不能只說「已生成」「系統會自動處理」「點擊下方連結」——這些說法無效，不會產生任何檔案。
- 必須實際把內容寫進代碼區塊中，系統才能偵測並生成可下載的檔案。
- 如果使用者要求 PDF 和 Word，就必須同時輸出兩個代碼區塊。

\`\`\`generate_xlsx:filename.xlsx
[{"sheetName":"Sheet1","data":[["欄位1","欄位2"],["值1","值2"]]}]
\`\`\`

\`\`\`generate_docx:filename.docx
[完整 Markdown 文件內容]
\`\`\`

\`\`\`generate_pdf:filename.pdf
[完整 Markdown 文件內容]
\`\`\`

\`\`\`generate_txt:filename.txt
[純文字內容]
\`\`\`

# 角色與基本設定

你是 Cortex，正崴精密工業的企業內部 AI 助理。
請以繁體中文回覆（除非使用者明確要求其他語言）。
回答要準確、專業、有條理。支援 Markdown 格式輸出。

**生成 PPT:**

【重要】使用者請求生成 PPT 時，必須先詢問以下偏好（除非使用者已明確說明）：
1. 簡報風格主題：
   - 深色系：企業藍(corporate)、現代深色(dark)、清新綠(green)、活力橙(orange)、典雅紫(purple)
   - 淺色系/白底：白色專業(white)、淺灰(light)、淡綠(light_green)、淡紫(light_purple)
2. 是否要在投影片加入 Emoji 圖示以增加視覺效果？（如 📊 📈 ✅ 💡 🎯 等）
3. 是否需要封面頁、議程頁、結語頁等完整架構？

確認偏好後再使用以下格式生成：
\`\`\`generate_pptx:filename.pptx
{
  "global_theme": "corporate|dark|green|orange|purple",
  "slides": [
    {
      "type": "title",
      "title": "主標題",
      "subtitle": "副標題或日期/部門",
      "icon": "🏢"
    },
    {
      "type": "agenda",
      "title": "議程",
      "items": ["第一點", "第二點", "第三點"],
      "icon": "📋"
    },
    {
      "type": "content",
      "title": "投影片標題",
      "bullets": ["重點一", "重點二", "重點三"],
      "icon": "💡",
      "highlight": "可選：強調文字"
    },
    {
      "type": "two_col",
      "title": "雙欄比較",
      "left_title": "左欄標題", "left_bullets": ["..."],
      "right_title": "右欄標題", "right_bullets": ["..."],
      "icon": "⚖️"
    },
    {
      "type": "section",
      "title": "章節標題",
      "subtitle": "章節說明",
      "icon": "📌"
    },
    {
      "type": "quote",
      "quote": "引言或重點結論文字",
      "author": "來源或作者"
    },
    {
      "type": "closing",
      "title": "感謝聆聽",
      "subtitle": "聯絡資訊或下一步行動",
      "icon": "🙏"
    }
  ]
}
\`\`\`

**生成 TXT:**
\`\`\`generate_txt:filename.txt
[純文字內容]
\`\`\`

系統將自動偵測並生成下載連結。

# 知識庫工具使用規則（dify_kb_* 系列工具）

呼叫 dify_kb_* 工具時，必須遵守：

1. **精確意圖匹配**（最重要）：使用者問題的**核心意圖**必須與知識庫範疇完全吻合，「包含相同關鍵字」不代表「意圖相符」。
   - 判斷標準：知識庫能直接回答這個問題嗎？還是只是主題有交集？
   - ✅ 應呼叫：問題的目的就是要從該知識庫獲取資訊（例：查負責人聯絡窗口、查公司政策規定）
   - ❌ 不應呼叫：問題雖提到相同主題，但目的是技術操作、資料查詢、程式分析等（例：查誰開發某程式、查某資料庫資料、分析某系統邏輯）

2. 若不確定，**預設不呼叫**，直接以自身知識回答或表示無法取得。

3. 每個知識庫在同一次回覆中只能呼叫一次。`;
}

/**
 * Generate image(s) via Imagen-capable model (e.g. gemini-3-pro-image-preview).
 * Non-streaming; returns text + array of { data: base64, mimeType }.
 * @param {string} apiModel
 * @param {Array} history  [{role, parts}]
 * @param {Array} userParts
 * @returns {Promise<{text: string, images: Array<{data: string, mimeType: string}>, inputTokens: number, outputTokens: number}>}
 */
async function generateWithImage(apiModel, history, userParts, extraInstruction) {
  // 圖片生成強制走 AI Studio (Gemini API key) — Vertex AI 上的 image model 名稱
  // 與 AI Studio 不同且 region 限制較多,維持原本作法穩定。
  // 如要改回 Vertex,設 IMAGE_PROVIDER=vertex。
  const imgProvider = process.env.IMAGE_PROVIDER === 'vertex' ? 'vertex' : 'studio';
  console.log(`[Gemini] generateWithImage model=${apiModel} provider=${imgProvider} hasExtraInst=${!!extraInstruction}`);
  const model = getGenerativeModel({
    model: apiModel,
    provider: imgProvider,
    systemInstruction: extraInstruction ? { role: 'system', parts: [{ text: extraInstruction }] } : undefined,
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  // Flatten history + current message into a single content array
  const contents = [
    ...history,
    { role: 'user', parts: userParts },
  ];

  const result = await model.generateContent({ contents });
  const response = result.response || result;
  const usage = extractUsage(result);

  let text = '';
  const images = [];
  const rawParts = [];
  for (const part of (response.candidates?.[0]?.content?.parts || [])) {
    if (part.thought) continue;
    if (part.text) {
      text += part.text;
      rawParts.push({ _type: 'text', text: part.text, thoughtSignature: part.thoughtSignature || null });
    } else if (part.inlineData) {
      const imageIdx = images.length;
      images.push({ data: part.inlineData.data, mimeType: part.inlineData.mimeType, thoughtSignature: part.thoughtSignature || null });
      rawParts.push({ _type: 'image', imageIdx, mimeType: part.inlineData.mimeType, thoughtSignature: part.thoughtSignature || null });
    }
  }

  return {
    text,
    images,
    rawParts,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

/**
 * Generate a short semantic title for a chat session
 */
async function generateTitle(userMessage, aiResponse) {
  const fallback = userMessage.trim().slice(0, 30);
  try {
    const model = getGenerativeModel({ model: MODEL_FLASH });
    const prompt =
      `Based on the conversation below, generate a concise title in THREE languages.\n` +
      `Reply ONLY with valid JSON — no markdown, no extra text:\n` +
      `{"zh":"繁體中文標題（10字以內）","en":"English title (max 8 words)","vi":"tiêu đề tiếng Việt (tối đa 10 từ)"}\n\n` +
      `User: ${userMessage.slice(0, 300)}\nAI: ${aiResponse.slice(0, 300)}`;
    const result = await model.generateContent(prompt);
    const raw = extractText(result).trim();
    const usage = extractUsage(result);
    // Parse JSON — strip any accidental markdown fences
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch (_) { parsed = {}; }
    const clean = (s) => (s || '').replace(/^["「『]|["」』]$/g, '').slice(0, 50) || fallback;
    const title_zh = clean(parsed.zh);
    const title_en = clean(parsed.en);
    const title_vi = clean(parsed.vi);
    // Detect content language for the primary `title` field (used as fallback)
    const isZh = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(userMessage);
    const isVi = !isZh && /[àáâãèéêìíòóôõùúýăđơư]/i.test(userMessage);
    const title = isZh ? title_zh : isVi ? title_vi : title_en;
    return {
      title, title_zh, title_en, title_vi,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: MODEL_FLASH,
    };
  } catch (e) {
    return { title: fallback, title_zh: fallback, title_en: fallback, title_vi: fallback,
             inputTokens: 0, outputTokens: 0, model: MODEL_FLASH };
  }
}

/**
 * Non-streaming text generation for scheduled tasks.
 * Supports full history + system instruction.
 * @param {string} apiModel
 * @param {Array}  history   - [{role, parts}]
 * @param {string} prompt    - user prompt text (already variable-substituted)
 * @returns {Promise<{text, inputTokens, outputTokens}>}
 */
async function generateTextSync(apiModel, history, prompt, opts = {}) {
  const resolvedModel = apiModel || process.env.GEMINI_MODEL_PRO || MODEL_PRO;
  if (!resolvedModel) throw new Error('generateTextSync: model parameter 為空（未設定 apiModel 也無 env fallback）');
  // opts.tools — built-in grounding tools 透傳(urlContext / googleSearch),
  // 用於 PM 抓新聞之類需要 LLM 真的 fetch URL 而非憑記憶幻覺的 task。
  // 只在 SDK_MODE='new' 且 GENERATE_PROVIDER='vertex' / 'studio' 且 model 支援(2.5+/3.x)時生效;
  // 舊 SDK 對 grounding tool 的命名不同,呼叫者請自己判斷別亂塞。
  // opts.fallbackOnEmpty=true:回空時自動不掛 tools 重跑一次(2026-05-01 加,擋 Flash + grounding 回空 bug)
  return _generateTextSyncOnce(resolvedModel, history, prompt, opts).then(async (r) => {
    if (opts.fallbackOnEmpty && (!r.text || r.text.trim().length === 0) && Array.isArray(opts.tools) && opts.tools.length) {
      console.warn(`[generateTextSync] grounding tools 回空 (${resolvedModel}, in=${r.inputTokens} out=${r.outputTokens}, finishReason=${r._finishReason || '?'}),fallback 不掛 tools 重跑`);
      const fb = await _generateTextSyncOnce(resolvedModel, history, prompt, { ...opts, tools: undefined });
      // 標記給 caller 知道用了 fallback
      return { ...fb, _fallbackUsed: true, _originalEmpty: true };
    }
    return r;
  });
}

async function _generateTextSyncOnce(resolvedModel, history, prompt, opts) {
  const modelOpts = {
    model: resolvedModel,
    systemInstruction: getSystemInstruction(),
  };
  if (Array.isArray(opts.tools) && opts.tools.length) modelOpts.tools = opts.tools;
  const model = getGenerativeModel(modelOpts);
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: prompt }] },
  ];
  const result = await model.generateContent({ contents });
  const usage = extractUsage(result);
  const text = extractText(result);
  // 詳細診斷 log:tools 開了或回空時必印,debug grounding 行為
  const target = result.response || result;
  const cand = target.candidates?.[0];
  const finishReason = cand?.finishReason;
  const parts = cand?.content?.parts || [];
  const textPartCount = parts.filter((p) => typeof p.text === 'string' && !p.thought).length;
  const thoughtPartCount = parts.filter((p) => p.thought).length;
  const hasTools = Array.isArray(opts.tools) && opts.tools.length;
  if (hasTools || !text || text.trim().length === 0) {
    console.log(`[generateTextSync] model=${resolvedModel} finishReason=${finishReason} parts=${parts.length}(text=${textPartCount}, thought=${thoughtPartCount}) text.len=${text.length} tokens.in=${usage.inputTokens} tokens.out=${usage.outputTokens} tools=${hasTools ? opts.tools.map(t => Object.keys(t)[0]).join(',') : 'none'}`);
  }
  // grounding metadata(urlContext fetch 結果)— debug 用,印 fetched URLs 看 LLM 真的有去抓哪些
  if (opts.logGrounding) {
    try {
      const meta = cand?.groundingMetadata;
      if (meta) {
        const urls = (meta.groundingChunks || meta.groundingSupports || meta.urlContextMetadata?.urlMetadata || [])
          .map((c) => c.web?.uri || c.uri || c.retrievedUrl || c.url)
          .filter(Boolean);
        if (urls.length) console.log(`[generateTextSync] grounding fetched ${urls.length} url(s):`, urls.slice(0, 20));
        else console.log(`[generateTextSync] groundingMetadata 存在但抽不到 URL,keys=${Object.keys(meta).join(',')}`);
      } else {
        console.log(`[generateTextSync] 沒有 groundingMetadata(LLM 沒呼叫 grounding tool 或 model 不支援)`);
      }
    } catch (_) { /* metadata shape 跨 model/SDK 變動,失敗不擋主流程 */ }
  }
  return {
    text,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    _finishReason: finishReason,
  };
}

/**
 * Non-streaming generation with MCP function calling loop.
 * Keeps calling tools until Gemini produces a final text response.
 * @param {string} apiModel
 * @param {Array}  history              - [{role, parts}]
 * @param {Array}  userParts            - Gemini content parts for the user message
 * @param {Array}  functionDeclarations - Gemini-format tool definitions
 * @param {Function} toolHandler        - async (toolName, args) => string result
 * @returns {Promise<{text, inputTokens, outputTokens, toolCallCount}>}
 */
async function generateWithTools(apiModel, history, userParts, functionDeclarations, toolHandler, extraSystemInstruction = '', opts = {}) {
  const fullInstruction = extraSystemInstruction
    ? getSystemInstruction() + '\n\n---\n' + extraSystemInstruction
    : getSystemInstruction();
  const safeDecls = sanitizeFunctionDeclarations(functionDeclarations);
  const model = getGenerativeModel({
    model: apiModel,
    systemInstruction: fullInstruction,
    tools: safeDecls.length > 0 ? [{ functionDeclarations: safeDecls }] : [],
  });

  // ⭐ 自管 contents — 不用 chat.startChat()，因為舊 SDK 會洗掉 thoughtSignature
  // 導致 Gemini 3 thinking model 多輪 tool call 失敗
  const contents = [...history, { role: 'user', parts: userParts }];
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  const MAX_TOOL_ROUNDS = 10;
  let lastResponse = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await model.generateContent({ contents });
    const response = result.response || result;
    lastResponse = response;
    const usage = extractUsage(result);
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;

    // ⭐ 從 candidates 取原始 parts (保留 thoughtSignature)
    const modelParts = response.candidates?.[0]?.content?.parts || [];
    if (modelParts.length > 0) {
      contents.push({ role: 'model', parts: modelParts });
    }

    const fnCalls = modelParts
      .filter(p => p.functionCall)
      .map(p => p.functionCall);

    if (fnCalls.length === 0) {
      return {
        text: extractText(response),
        inputTokens,
        outputTokens,
        toolCallCount,
      };
    }

    // Call each tool and collect responses
    const fnResponses = [];
    let directAnswerText = null;
    for (const call of fnCalls) {
      toolCallCount++;
      let toolResult;
      try {
        toolResult = await toolHandler(call.name, call.args || {});
      } catch (e) {
        toolResult = `[Tool error: ${e.message}]`;
      }
      // Check if this tool is configured for direct-answer mode
      if (opts.directAnswerTools?.has(call.name)) {
        directAnswerText = String(toolResult);
      }
      fnResponses.push({
        functionResponse: {
          name: call.name,
          response: { content: String(toolResult) },
        },
      });
    }
    // Direct answer: return raw tool result without feeding back to LLM
    if (directAnswerText !== null) {
      return { text: directAnswerText, inputTokens, outputTokens, toolCallCount, isDirectAnswer: true };
    }

    contents.push({ role: 'user', parts: fnResponses });
  }

  // 達 MAX_TOOL_ROUNDS 仍未產生最終回答 — 回傳最後一個 response 中的文字（若有）
  const lastText = extractText(lastResponse) || '';
  return {
    text: lastText || '[達到工具呼叫上限，未取得最終回答]',
    inputTokens,
    outputTokens,
    toolCallCount,
  };
}

/**
 * Streaming version of generateWithTools — streams the final LLM response
 * while still handling multi-round tool calls.
 *
 * Tool-call rounds: Gemini returns function calls (no text) → execute tools → send responses.
 * Final round: Gemini streams the text answer → onChunk called per chunk.
 *
 * @param {string}   apiModel
 * @param {Array}    history
 * @param {Array}    userParts
 * @param {Array}    functionDeclarations
 * @param {Function} toolHandler    - async (name, args) => string
 * @param {Function} onChunk        - (chunkText) => void
 * @param {Function} onToolStatus   - (statusMsg) => void  — optional, notifies caller about tool activity
 * @param {string}   extraSystemInstruction
 * @param {object}   opts           - { directAnswerTools: Set }
 */
async function generateWithToolsStream(
  apiModel, history, userParts, functionDeclarations, toolHandler,
  onChunk, onToolStatus, extraSystemInstruction = '', opts = {}, genConfig = null
) {
  const fullInstruction = extraSystemInstruction
    ? getSystemInstruction() + '\n\n---\n' + extraSystemInstruction
    : getSystemInstruction();

  const thinkingBudget = _resolveThinkingBudget(apiModel, genConfig?.reasoning_effort, genConfig?.thinking_budget);
  const generationConfig = {
    maxOutputTokens: genConfig?.max_output_tokens || 65536,
    ...(genConfig?.temperature != null ? { temperature: genConfig.temperature } : {}),
    ...(genConfig?.top_p != null ? { topP: genConfig.top_p } : {}),
    ...(thinkingBudget != null ? { thinkingConfig: { thinkingBudget } } : {}),
  };

  const safeDecls = sanitizeFunctionDeclarations(functionDeclarations);
  const model = getGenerativeModel({
    model: apiModel,
    systemInstruction: fullInstruction,
    generationConfig,
    tools: safeDecls.length > 0 ? [{ functionDeclarations: safeDecls }] : [],
  });

  // ⭐ 自管 contents — 不用 chat.startChat()，因為舊 SDK 會洗掉 thoughtSignature
  // 導致 Gemini 3 thinking model 多輪 tool call 失敗
  const contents = [...history, { role: 'user', parts: userParts }];
  const baselineLen = contents.length; // 之後新增的都是本輪 tool 對話,要回傳給 caller 持久化
  let inputTokens = 0, outputTokens = 0;
  let toolCallCount = 0;
  let fullText = '';
  const MAX_TOOL_ROUNDS = 10;

  // ── 擷取本輪新增的 tool 對話(functionCall / functionResponse)回傳給 caller 持久化。
  //    讓多輪 tool workflow(如 MCP 引導式問答)能跨「聊天訊息」保留已選參數,
  //    解決使用者第 2 輪輸入「3 / 直方圖」時 LLM 忘記前一步的問題。
  //    text 不收(已在 fullText / m.content);thoughtSignature 刻意不收 —
  //    跨「聊天訊息」重播一個已完結的 function call 不需要 continue,帶舊 sig 反而
  //    可能讓 Gemini 3 回 400(stale signature)炸掉整個對話。
  //    必須在 functionResponse 已 push 進 contents 後才呼叫,否則會留下 orphan functionCall。
  const REPLAY_FR_MAX = 8000;
  const captureToolTurns = () => {
    const turns = [];
    for (let i = baselineLen; i < contents.length; i++) {
      const turn = contents[i];
      if (turn.role === 'model') {
        const fcParts = (turn.parts || [])
          .filter((p) => p.functionCall)
          .map((p) => ({ functionCall: p.functionCall }));
        if (fcParts.length) turns.push({ role: 'model', parts: fcParts });
      } else {
        // functionResponse 可能很大 — 持久化重播時截斷,避免 DB / 後續每輪 token 膨脹
        const frParts = (turn.parts || [])
          .filter((p) => p.functionResponse)
          .map((p) => {
            const fr = p.functionResponse;
            const c = fr?.response?.content;
            if (typeof c === 'string' && c.length > REPLAY_FR_MAX) {
              return { functionResponse: { name: fr.name, response: { content: c.slice(0, REPLAY_FR_MAX) + '\n…[truncated]' } } };
            }
            return { functionResponse: fr };
          });
        if (frParts.length) turns.push({ role: 'user', parts: frParts });
      }
    }
    return turns;
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await model.generateContentStream({ contents });

    // ⭐ 模仿 SDK aggregateResponses 邏輯:每個 chunk 把所有 parts 合併成一個 newPart 然後 push,
    // 但保留 SDK 會丟掉的 thought / thoughtSignature 欄位(這就是原本 bug 根源)。
    const allParts = [];
    let finishReason = null;

    for await (const chunk of result.stream) {
      const cand = chunk.candidates?.[0];
      if (!cand) continue;
      if (cand.finishReason) finishReason = cand.finishReason;

      const chunkParts = cand.content?.parts || [];
      if (chunkParts.length === 0) continue;

      // 把這個 chunk 的所有 parts 合併成一個 newPart(同 SDK 行為)
      const newPart = {};
      for (const p of chunkParts) {
        if (p.text != null) {
          newPart.text = p.text;
          if (p.thought) newPart.thought = true;
        }
        if (p.functionCall) newPart.functionCall = p.functionCall;
        if (p.inlineData) newPart.inlineData = p.inlineData;
        if (p.executableCode) newPart.executableCode = p.executableCode;
        if (p.codeExecutionResult) newPart.codeExecutionResult = p.codeExecutionResult;
        // ⭐ SDK 會丟掉的欄位 — 必須保留
        if (p.thoughtSignature) newPart.thoughtSignature = p.thoughtSignature;
      }

      if (Object.keys(newPart).length === 0) continue;
      allParts.push(newPart);

      // 串流非 thought 文字給使用者
      if (newPart.text != null && !newPart.thought) {
        fullText += newPart.text;
        onChunk(newPart.text);
      }
    }

    // Debug: log model turn 結構,方便排查 functionCall 為什麼沒被偵測到
    console.log(`[Gemini][round=${round}] parts=${allParts.length} structure=${
      allParts.map((p, i) => {
        const tags = [];
        if (p.text != null) tags.push(`text(${p.text.length})`);
        if (p.thought) tags.push('thought');
        if (p.functionCall) tags.push(`fnCall:${p.functionCall.name}`);
        if (p.thoughtSignature) tags.push('sig');
        return `[${i}:${tags.join('+') || 'empty'}]`;
      }).join(' ')
    } finishReason=${finishReason}`);

    if (finishReason === 'MAX_TOKENS') {
      const msg = '\n\n[⚠️ 回應已達最大 Token 上限，內容可能不完整]';
      fullText += msg;
      onChunk(msg);
    } else if (finishReason && finishReason !== 'STOP' && finishReason !== 'TOOL_USE' && finishReason !== 'TOOL_CALLS') {
      // 其他異常 finishReason（SAFETY、RECITATION、OTHER 等）
      console.warn(`[Gemini] Unexpected finishReason: ${finishReason}`);
    }

    const response = await result.response;
    const usage = extractUsage(response);
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;

    // ⭐ 關鍵:原樣 append 回 contents,thoughtSignature 還在
    if (allParts.length > 0) {
      contents.push({ role: 'model', parts: allParts });
    }

    // 從 allParts 抓 functionCall(不用 response.functionCalls(),那個會掉 signature)
    const fnCalls = allParts
      .filter(p => p.functionCall)
      .map(p => p.functionCall);

    if (fnCalls.length === 0) break; // No more tool calls — done

    // Execute tools
    const fnResponses = [];
    let directAnswerText = null;
    for (const call of fnCalls) {
      toolCallCount++;
      if (onToolStatus) onToolStatus(`呼叫工具：${call.name}`);
      let toolResult;
      try {
        toolResult = await toolHandler(call.name, call.args || {});
      } catch (e) {
        toolResult = `[Tool error: ${e.message}]`;
      }
      if (opts.directAnswerTools?.has(call.name)) {
        directAnswerText = String(toolResult);
      }
      fnResponses.push({
        functionResponse: {
          name: call.name,
          response: { content: String(toolResult) },
        },
      });
    }

    // direct-answer:先把本輪 fnResponses push 進 contents(完成 functionCall/Response 配對),
    // 再 capture,避免留下 orphan functionCall 破壞重播
    contents.push({ role: 'user', parts: fnResponses });

    if (directAnswerText !== null) {
      return { text: directAnswerText, inputTokens, outputTokens, toolCallCount, isDirectAnswer: true, toolTurns: captureToolTurns() };
    }
  }

  return { text: fullText, inputTokens, outputTokens, toolCallCount, toolTurns: captureToolTurns() };
}

module.exports = {
  streamChat, generateWithImage, generateTextSync, generateWithTools, generateWithToolsStream,
  transcribeAudio, transcribeLongAudio, extractTextFromFile, fileToGeminiPart, generateTitle,
  MODEL_PRO, MODEL_FLASH,
  // 給 transcribeJobService.js 用(背景 job 重用同一套 ffmpeg + retry + Pro→Flash fallback)
  _probeAudioDuration, _splitAudio, _fmtTime, _transcribeWithRetry,
  LONG_AUDIO_SEGMENT_SEC, LONG_AUDIO_CONCURRENCY, LONG_AUDIO_PER_SEG_TIMEOUT_MS,
};
