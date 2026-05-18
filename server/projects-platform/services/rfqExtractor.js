/**
 * RFQ Extractor — AI #1(spec §F.1)
 *
 * 從客戶 RFQ 來信(PDF/email/圖)用 Gemini Vision 抽出 Wizard Step 3-5 欄位:
 *   - customer 客戶名稱
 *   - part_no 料號
 *   - quantity 數量(int)
 *   - due_date 交期(ISO date)
 *   - specs 規格摘要(纜線長度 / 電壓 / 認證等)
 *   - notes 額外備註
 *
 * 每欄位帶 confidence(0-100)+ 整體 confidence
 *
 * Gemini Flash 預設;失敗回 stub mock(demo 不炸)。
 */

const path = require('path');
const fs = require('fs');
const { makeLogger } = require('./logger');
const log = makeLogger('rfqExtractor');

const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true'; // 預設 OFF(省 token,設 true 才跑真 Gemini)

const EXTRACT_PROMPT = `
你是一個 RFQ(報價詢問單)結構化助手。輸入是客戶寄來的 PDF/email/圖。
請抽以下欄位,**只回 JSON**(不要 markdown / 不要解釋),格式如下:

{
  "customer": "客戶公司名(中或英)",
  "part_no": "料號 / part number(若多個取最主要)",
  "quantity": 數字(若是範圍給中位數),
  "due_date": "YYYY-MM-DD"(客戶要求交期,推算或取最早),
  "specs": "規格摘要 < 200 字(電壓 / 長度 / 顏色 / 認證 / 接頭型式 / 材質)",
  "notes": "額外備註 < 200 字(包裝 / 認證 / 出貨地點 / 其他要求)",
  "confidence": {
    "customer": 0-100,
    "part_no": 0-100,
    "quantity": 0-100,
    "due_date": 0-100,
    "specs": 0-100,
    "notes": 0-100,
    "overall": 0-100
  },
  "missing": ["未在文件中找到的欄位 key 列表"],
  "warnings": ["e.g. '未指明 RoHS 認證'、'電壓欄位含糊'"]
}

規則:
- 找不到的欄位設 null,加進 missing,confidence 設 0
- 數字一律 number(quantity 是 int,date 是 ISO 字串)
- 多語言 OK(zh-TW/en/混)
- 不要捏造未在文件中的內容
`;

/**
 * 從檔案抽 RFQ 欄位
 * @param {string} filePath - PDF / 圖檔絕對路徑
 * @param {string} mimeType - 'application/pdf' | 'image/jpeg' | 'image/png' | ...
 * @returns {Promise<object>} 抽取結果(永遠回 JSON,失敗回 stub mock)
 */
async function extract(filePath, mimeType) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }

  if (!USE_LLM) {
    log.log(`PROJECTS_PLATFORM_USE_LLM=false → return stub mock`);
    return _stubMock(filePath);
  }

  try {
    return await _extractWithGemini(filePath, mimeType);
  } catch (e) {
    log.warn(`Gemini extract failed: ${e.message} → fallback stub mock`);
    const stub = _stubMock(filePath);
    stub._fallback_reason = e.message;
    return stub;
  }
}

async function _extractWithGemini(filePath, mimeType) {
  const { getGenerativeModel, extractText } = require('../../services/geminiClient');
  const llmQueue = require('./llmQueue');

  const model = getGenerativeModel({
    model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash',
    // 抽結構化欄位用低 temperature
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    // 大檔走 Studio(避 Vertex gRPC 4MB inline 上限)
    provider: 'studio',
  });

  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const mime = mimeType || _guessMime(filePath);

  // projects-platform 的 token bucket 限速
  const result = await llmQueue.withLLM(async () => {
    return await model.generateContent([
      { inlineData: { data: b64, mimeType: mime } },
      { text: EXTRACT_PROMPT },
    ]);
  }, { label: 'rfq_extract', timeoutMs: 60_000 });

  const text = extractText(result).trim();
  let parsed;
  try {
    // 容錯:有時 LLM 還是會包 ```json ... ``` markdown
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Gemini response not valid JSON: ${text.slice(0, 200)}`);
  }

  return _normalize(parsed);
}

function _normalize(raw) {
  const out = {
    customer:  raw?.customer  || null,
    part_no:   raw?.part_no   || raw?.partNo || null,
    quantity:  raw?.quantity != null ? Number(raw.quantity) : null,
    due_date:  raw?.due_date  || raw?.dueDate || null,
    specs:     raw?.specs     || null,
    notes:     raw?.notes     || null,
    confidence: {
      customer:  _clampConfidence(raw?.confidence?.customer),
      part_no:   _clampConfidence(raw?.confidence?.part_no),
      quantity:  _clampConfidence(raw?.confidence?.quantity),
      due_date:  _clampConfidence(raw?.confidence?.due_date),
      specs:     _clampConfidence(raw?.confidence?.specs),
      notes:     _clampConfidence(raw?.confidence?.notes),
      overall:   _clampConfidence(raw?.confidence?.overall),
    },
    missing:   Array.isArray(raw?.missing)  ? raw.missing.slice(0, 10)  : [],
    warnings:  Array.isArray(raw?.warnings) ? raw.warnings.slice(0, 10) : [],
    _ai_extracted: true,
  };
  if (Number.isNaN(out.quantity)) out.quantity = null;
  // 整體 confidence fallback:取已填欄位 confidence 平均
  if (!out.confidence.overall) {
    const vals = Object.values(out.confidence).filter((v) => typeof v === 'number' && v > 0);
    out.confidence.overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }
  return out;
}

function _clampConfidence(n) {
  if (n == null) return 0;
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function _guessMime(filePath) {
  const ext = String(path.extname(filePath)).toLowerCase();
  if (ext === '.pdf')   return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png')   return 'image/png';
  if (ext === '.gif')   return 'image/gif';
  if (ext === '.webp')  return 'image/webp';
  if (ext === '.eml')   return 'message/rfc822';
  return 'application/octet-stream';
}

/**
 * Stub mock — demo 用,LLM 不可用時的固定 mock 資料
 */
function _stubMock(filePath) {
  const fname = path.basename(filePath);
  return {
    customer:  'Apple Inc.',
    part_no:   fname.includes('USB') ? 'USB-C-2M-MFi' : 'PART-001',
    quantity:  10000,
    due_date:  _addDays(new Date(), 30).toISOString().slice(0, 10),
    specs:     '2 米長 USB-C to Lightning,MFi 認證,黑色,符合 RoHS 標準',
    notes:     'AppleCare 包裝 · FOB 上海 · 客戶要求單一料號',
    confidence: {
      customer:  88,
      part_no:   72,
      quantity:  95,
      due_date:  85,
      specs:     65,
      notes:     58,
      overall:   77,
    },
    missing:   [],
    warnings:  ['電壓 / 接頭規格未明確標示', 'RoHS 認證需確認版本'],
    _ai_extracted: true,
    _stub: true,
  };
}

function _addDays(d, n) {
  const dd = new Date(d);
  dd.setDate(dd.getDate() + n);
  return dd;
}

module.exports = {
  extract,
};
