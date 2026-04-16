/**
 * Feedback Redactor — LLM-based 個資脫敏
 *
 * 策略：結案時跑一次 Gemini Flash redaction pass
 * - 只替換：人名 / 工號 / email
 * - 保留：技術內容、部門代號、機台 SN、錯誤訊息等所有其他字元
 * - LLM 失敗時 fallback 到 regex（原有邏輯）
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash';

let _client = null;
function _getClient() {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return _client;
}

const SYSTEM_PROMPT = `You are a PII redaction engine for IT support ticket archives.

TASK: Replace personal identifiers in the input text with bracketed placeholders. DO NOT change any other content.

REPLACE:
- Personal names (both Chinese 中文姓名 and English/Vietnamese) → [使用者]
- Employee IDs (格式如 8793, 5634, 12345, 英數字組合如 A12345) → [工號]
- Email addresses (任何 @ 樣式) → [email]

KEEP UNCHANGED:
- Department codes / 部門代號 (e.g., FEC01, PCB3)
- Machine serial numbers / 機台 SN (e.g., SN12345, M001)
- Error codes, URLs, IP addresses, paths, SQL, code snippets
- Dates, times, amounts, technical terms
- All other text verbatim — do not paraphrase, summarize, or reword

RULES:
- Output MUST have same structure/formatting (newlines, punctuation, markdown)
- Do NOT add explanations, notes, or commentary
- Do NOT translate
- If you are unsure whether a token is PII, leave it unchanged
- Output ONLY the redacted text, nothing else`;

/**
 * LLM 脫敏。失敗會 throw（caller 需自行 fallback）。
 * @param {string} text
 * @param {object} opts - { model?: string, timeoutMs?: number }
 * @returns {Promise<string>}
 */
async function redactText(text, opts = {}) {
  if (!text || typeof text !== 'string') return text || '';
  if (text.length < 5) return text; // 太短不值得 LLM

  const model = opts.model || MODEL_FLASH;
  const client = _getClient();
  const gm = client.getGenerativeModel({
    model,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0,
      topP: 1,
    },
  });

  const timeoutMs = opts.timeoutMs || 30000;
  const result = await Promise.race([
    gm.generateContent({ contents: [{ role: 'user', parts: [{ text }] }] }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('redact timeout')), timeoutMs)),
  ]);

  const out = result.response?.text?.() || '';
  if (!out.trim()) throw new Error('redact returned empty');
  return out;
}

/**
 * Regex fallback — 用已知欄位 + email pattern 做保守替換
 */
function fallbackRegexRedact(text, ticket) {
  if (!text) return '';
  let out = text;
  const replacements = [
    [ticket?.applicant_name, '[使用者]'],
    [ticket?.applicant_employee_id, '[工號]'],
    [ticket?.applicant_email, '[email]'],
  ];
  for (const [from, to] of replacements) {
    if (from && typeof from === 'string') out = out.split(from).join(to);
  }
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]');
  return out;
}

/**
 * 完整脫敏：先試 LLM，失敗 fallback regex
 */
async function redactSafe(text, ticket, opts = {}) {
  if (!text) return { text: '', source: 'empty' };
  try {
    const out = await redactText(text, opts);
    return { text: out, source: 'llm' };
  } catch (e) {
    console.warn('[FeedbackRedactor] LLM failed, fallback regex:', e.message);
    return { text: fallbackRegexRedact(text, ticket), source: 'regex' };
  }
}

module.exports = {
  redactText,
  fallbackRegexRedact,
  redactSafe,
  MODEL_FLASH,
};
