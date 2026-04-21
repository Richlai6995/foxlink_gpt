'use strict';

/**
 * Webex Bot Webhook Handler
 *
 * POST /api/webex/webhook  — Webex 事件接收端點
 *
 * 流程:
 *  1. HMAC-SHA1 驗簽
 *  2. 取得完整訊息 (webhook 只傳 ID)
 *  3. 過濾 Bot 自己的訊息
 *  4. email 正規化 → 查 DB user
 *  5. 指令分派: ? / /new / /重置 / /help / 一般對話
 *  6. AI pipeline (generateWithTools, 非 SSE)
 *  7. 生成檔案回傳 Webex
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { getWebexService } = require('../services/webexService');
const { generateWithTools, extractTextFromFile, fileToGeminiPart, transcribeAudio, MODEL_PRO } = require('../services/gemini');
const { processGenerateBlocks } = require('../services/fileGenerator');
const { upsertTokenUsage, checkBudgetExceeded } = require('../services/tokenService');
const { notifyAdminSensitiveKeyword } = require('../services/mailService');
const { tryLock } = require('../services/redisClient');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const WEBEX_TMP_DIR = path.join(UPLOAD_DIR, 'webex_tmp');
if (!fs.existsSync(WEBEX_TMP_DIR)) fs.mkdirSync(WEBEX_TMP_DIR, { recursive: true });

const MAX_HISTORY_MESSAGES = 20;
const MAX_WEBEX_CHARS = 4000; // Webex 實際限制 ~7439 bytes，留餘裕

// ── i18n 訊息對照表 ─────────────────────────────────────────────────────────────
// user.preferred_language: 'zh-TW' | 'en' | 'vi'，fallback 'zh-TW'
const WEBEX_I18N = {
  // 帳號拒絕 — not_found（無 user，三語全發）
  not_found: (email) => [
    `⚠️ 無法串連 Cortex 帳號（${email}），以下為可能原因：`,
    `1. 尚未登入過網頁系統產生帳號，請先透過公司內網登入：https://flgpt.foxlink.com.tw:8443`,
    `2. 可能帳號無 email 資訊`,
    `3. 網路連線問題`,
    `請檢查以上原因或是洽廠區資訊處理`,
    ``,
    `⚠️ Unable to link Cortex account (${email}). Possible reasons:`,
    `1. You have not logged into the web system to create an account. Please log in via the company intranet first: https://flgpt.foxlink.com.tw:8443`,
    `2. Your account may not have email information.`,
    `3. Network connection issue.`,
    `Please check the above or contact your local IT department.`,
    ``,
    `⚠️ Không thể liên kết tài khoản Cortex (${email}). Nguyên nhân có thể:`,
    `1. Bạn chưa đăng nhập vào hệ thống web để tạo tài khoản. Vui lòng đăng nhập qua mạng nội bộ công ty trước: https://flgpt.foxlink.com.tw:8443`,
    `2. Tài khoản có thể không có thông tin email.`,
    `3. Sự cố kết nối mạng.`,
    `Vui lòng kiểm tra các nguyên nhân trên hoặc liên hệ bộ phận IT tại nhà máy.`,
  ].join('\n'),

  // 帳號拒絕 — disabled
  disabled: {
    'zh-TW': (email) => `⚠️ 您的帳號（${email}）目前已停用，請聯絡系統管理員。`,
    'en':    (email) => `⚠️ Your account (${email}) is currently disabled. Please contact the system administrator.`,
    'vi':    (email) => `⚠️ Tài khoản của bạn (${email}) hiện đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên hệ thống.`,
  },
  // 帳號拒絕 — bot_disabled
  bot_disabled: {
    'zh-TW': (email) => `⚠️ 您的帳號（${email}）目前未開啟 Webex Bot 功能，如需使用請聯絡系統管理員。`,
    'en':    (email) => `⚠️ Your account (${email}) does not have Webex Bot enabled. Please contact the system administrator to enable it.`,
    'vi':    (email) => `⚠️ Tài khoản của bạn (${email}) chưa được bật tính năng Webex Bot. Vui lòng liên hệ quản trị viên hệ thống để kích hoạt.`,
  },
  // 帳號拒絕 — domain_blocked（email domain 不在白名單；三語全發）
  domain_blocked: (email) => [
    `⚠️ 您的 email（${email}）不在允許的 domain 清單內，無法使用 Cortex Webex Bot。請使用公司 email 帳號，或聯絡廠區資訊處理。`,
    ``,
    `⚠️ Your email (${email}) is not in the allowed domain list. Please use your company email account or contact your local IT department.`,
    ``,
    `⚠️ Email của bạn (${email}) không nằm trong danh sách domain được phép. Vui lòng sử dụng email công ty hoặc liên hệ bộ phận IT tại nhà máy.`,
  ].join('\n'),
  // 影片拒絕
  video_reject: {
    'zh-TW': (f) => `❌ 不支援影片檔（${f}），請傳送音訊或文件。`,
    'en':    (f) => `❌ Video files are not supported (${f}). Please send audio or documents.`,
    'vi':    (f) => `❌ Không hỗ trợ tệp video (${f}). Vui lòng gửi âm thanh hoặc tài liệu.`,
  },
  // 音訊無權限
  audio_no_perm: {
    'zh-TW': (f) => `❌ 您的帳號無音訊上傳權限（${f}），請聯絡管理員。`,
    'en':    (f) => `❌ Your account does not have audio upload permission (${f}). Please contact the administrator.`,
    'vi':    (f) => `❌ Tài khoản của bạn không có quyền tải lên âm thanh (${f}). Vui lòng liên hệ quản trị viên.`,
  },
  // 音訊超過上限
  audio_too_large: {
    'zh-TW': (mb, f) => `❌ 音訊檔超過上限 ${mb}MB（${f}）。`,
    'en':    (mb, f) => `❌ Audio file exceeds the ${mb}MB limit (${f}).`,
    'vi':    (mb, f) => `❌ Tệp âm thanh vượt quá giới hạn ${mb}MB (${f}).`,
  },
  // 圖片無權限
  image_no_perm: {
    'zh-TW': (f) => `❌ 您的帳號無圖片上傳權限（${f}）。`,
    'en':    (f) => `❌ Your account does not have image upload permission (${f}).`,
    'vi':    (f) => `❌ Tài khoản của bạn không có quyền tải lên hình ảnh (${f}).`,
  },
  // 圖片超過上限
  image_too_large: {
    'zh-TW': (mb, f) => `❌ 圖片超過上限 ${mb}MB（${f}）。`,
    'en':    (mb, f) => `❌ Image exceeds the ${mb}MB limit (${f}).`,
    'vi':    (mb, f) => `❌ Hình ảnh vượt quá giới hạn ${mb}MB (${f}).`,
  },
  // 處理中
  typing: {
    'zh-TW': '⏳ 正在分析您的問題，請稍候...',
    'en':    '⏳ Analyzing your question, please wait...',
    'vi':    '⏳ Đang phân tích câu hỏi của bạn, vui lòng chờ...',
  },
  // AI 錯誤
  ai_error: {
    'zh-TW': (e) => `❌ AI 服務暫時發生錯誤，請稍後重試。\n（${e}）`,
    'en':    (e) => `❌ AI service encountered an error. Please try again later.\n(${e})`,
    'vi':    (e) => `❌ Dịch vụ AI tạm thời gặp lỗi. Vui lòng thử lại sau.\n(${e})`,
  },
  // 生成檔案
  file_generated: {
    'zh-TW': (f) => `📄 已生成：${f}`,
    'en':    (f) => `📄 Generated: ${f}`,
    'vi':    (f) => `📄 Đã tạo: ${f}`,
  },
  // /new 分隔線
  new_session: {
    'zh-TW': (t) => `━━━━━━━━━━━━━━━━━━━━━━━━\n🔄 新對話開始（${t}）\n━━━━━━━━━━━━━━━━━━━━━━━━\n請輸入您的問題。`,
    'en':    (t) => `━━━━━━━━━━━━━━━━━━━━━━━━\n🔄 New conversation started (${t})\n━━━━━━━━━━━━━━━━━━━━━━━━\nPlease enter your question.`,
    'vi':    (t) => `━━━━━━━━━━━━━━━━━━━━━━━━\n🔄 Cuộc trò chuyện mới bắt đầu (${t})\n━━━━━━━━━━━━━━━━━━━━━━━━\nVui lòng nhập câu hỏi của bạn.`,
  },
  // /help
  help: {
    'zh-TW': [
      '🤖 **Cortex Bot 使用說明**\n',
      '📌 **指令**：',
      '• `?` — 查看您的可用工具清單',
      '• `/new` — 開啟新對話（清除記憶）',
      '• `/help` — 顯示此說明\n',
      '📎 **附件支援**：',
      '• PDF、Word、Excel、PPT、圖片、音訊',
      '• AI 可讀取附件內容並回答',
      '• AI 生成的 Excel/PDF 等會以附件回傳\n',
      '⚠️ **注意**：',
      '• 群組 Room 請 @Bot 後輸入問題',
      '• 回覆約需 10-30 秒，請稍候',
    ].join('\n'),
    'en': [
      '🤖 **Cortex Bot User Guide**\n',
      '📌 **Commands**:',
      '• `?` — View your available tools',
      '• `/new` — Start a new conversation (clear memory)',
      '• `/help` — Show this guide\n',
      '📎 **Attachment Support**:',
      '• PDF, Word, Excel, PPT, images, audio',
      '• AI can read attachment content and answer',
      '• AI-generated Excel/PDF files are sent as attachments\n',
      '⚠️ **Note**:',
      '• In group rooms, @mention the Bot before your question',
      '• Replies may take 10-30 seconds, please wait',
    ].join('\n'),
    'vi': [
      '🤖 **Hướng dẫn sử dụng Cortex Bot**\n',
      '📌 **Lệnh**:',
      '• `?` — Xem danh sách công cụ khả dụng',
      '• `/new` — Bắt đầu cuộc trò chuyện mới (xóa bộ nhớ)',
      '• `/help` — Hiển thị hướng dẫn này\n',
      '📎 **Hỗ trợ tệp đính kèm**:',
      '• PDF, Word, Excel, PPT, hình ảnh, âm thanh',
      '• AI có thể đọc nội dung tệp và trả lời',
      '• Các tệp AI tạo (Excel/PDF) được gửi dưới dạng tệp đính kèm\n',
      '⚠️ **Lưu ý**:',
      '• Trong phòng nhóm, hãy @Bot trước khi nhập câu hỏi',
      '• Phản hồi có thể mất 10-30 giây, vui lòng chờ',
    ].join('\n'),
  },
};

// 預算超限訊息翻譯（budget.message 由 tokenService 產生，格式固定）
function translateBudgetMsg(msg, lang) {
  if (!lang || lang === 'zh-TW') return `⚠️ ${msg}`;
  // 解析中文 budget message: "當日/本週/本月使用金額已達上限 $X（已使用 $Y），請明日/下週一/下月一日再試。"
  const m = msg.match(/(當日|本週|本月).*?\$([.\d]+).*?\$([.\d]+)/);
  if (!m) return `⚠️ ${msg}`;
  const [, period, limit, spent] = m;
  const periods = {
    en:  { '當日': 'daily', '本週': 'weekly', '本月': 'monthly' },
    vi:  { '當日': 'hàng ngày', '本週': 'hàng tuần', '本月': 'hàng tháng' },
  };
  const retries = {
    en:  { '當日': 'Please try again tomorrow.', '本週': 'Please try again next Monday.', '本月': 'Please try again next month.' },
    vi:  { '當日': 'Vui lòng thử lại vào ngày mai.', '本週': 'Vui lòng thử lại vào thứ Hai tuần sau.', '本月': 'Vui lòng thử lại vào tháng sau.' },
  };
  const p = periods[lang]?.[period] || period;
  const r = retries[lang]?.[period] || '';
  if (lang === 'en') return `⚠️ Your ${p} usage has reached the limit of $${limit} (used $${spent}). ${r}`;
  if (lang === 'vi') return `⚠️ Mức sử dụng ${p} của bạn đã đạt giới hạn $${limit} (đã dùng $${spent}). ${r}`;
  return `⚠️ ${msg}`;
}

// 取得 i18n 訊息（支援函數或字串）
function t(key, lang, ...args) {
  const entry = WEBEX_I18N[key];
  if (!entry) return key;
  // not_found 特殊處理：直接是函數（三語全發）
  if (typeof entry === 'function') return entry(...args);
  const val = entry[lang] || entry['zh-TW'];
  return typeof val === 'function' ? val(...args) : val;
}
const WEBEX_SYSTEM_SUFFIX_BASE = `

---
【Webex 回覆格式規範】
你正在透過 Webex 訊息視窗回覆，請遵守：
1. 回覆精簡，重點優先，避免冗長鋪陳
2. 用 bullet list 取代大段落，每條不超過 40 字
3. 避免寬表格（改用清單呈現）
4. Markdown 僅使用粗體、清單、代碼塊（Webex 支援有限）
5. 如回答需要詳細版，結尾加提示語（依回覆語言）：中文「💡 需詳細版本請至 Web 介面查看」/ English "💡 For a detailed version, please visit the Web interface" / Tiếng Việt "💡 Để xem phiên bản chi tiết, vui lòng truy cập giao diện Web"

【Webex 檔案生成規則 — 強制執行，最高優先級】
當使用者要求生成/輸出/匯出/整理成 Excel/Word/PDF/PPT/TXT 等檔案時：

⚠️ 你必須在回覆中完整輸出 generate 代碼塊，否則系統無法生成檔案。
⚠️ 只說「📎 檔案將以附件傳送」而沒有輸出代碼塊，等於完全沒有生成任何東西。

正確的輸出格式範例（以 PDF 為例）：
\`\`\`generate_pdf:報告檔名.pdf
# 標題
完整的文件內容...
\`\`\`
📎 檔案將以附件傳送，請稍候

正確的輸出格式範例（以 Excel 為例）：
\`\`\`generate_xlsx:資料檔名.xlsx
[{"sheetName":"Sheet1","data":[["欄位1","欄位2"],["值1","值2"]]}]
\`\`\`
📎 檔案將以附件傳送，請稍候

規則：
- 必須先輸出完整 generate_xxx 代碼塊（含完整文件內容），再說「📎 檔案將以附件傳送，請稍候」
- 禁止只說「📎 檔案將以附件傳送」而不輸出代碼塊
- 禁止說「請點擊下載連結」、「請至 Web 介面下載」
- Webex 模式下所有生成的檔案直接以附件回傳，不需要連結
`;

const WEBEX_LANG_INSTRUCTION = {
  'zh-TW': '\n\n---\n【輸出語言】必須使用「繁體中文」回答所有內容。即使輸入或資料是別的語言，回答仍必須是繁體中文。專有名詞可保留原文。唯一例外：使用者明確要求翻譯成特定語言（如「翻成日文」）。',
  'en':    '\n\n---\n[Output Language] You MUST respond in English for all content, even if the input or data is in another language. Proper nouns can stay in original. Only exception: user explicitly asks for translation to a specific language (e.g., "translate to Japanese").',
  'vi':    '\n\n---\n[Ngôn ngữ đầu ra] BẮT BUỘC trả lời bằng Tiếng Việt cho mọi nội dung, ngay cả khi đầu vào hoặc dữ liệu bằng ngôn ngữ khác. Danh từ riêng có thể giữ nguyên gốc. Ngoại lệ duy nhất: người dùng yêu cầu dịch sang ngôn ngữ cụ thể (ví dụ: "dịch sang tiếng Nhật").',
};

function getWebexSystemSuffix(lang) {
  return WEBEX_SYSTEM_SUFFIX_BASE + (WEBEX_LANG_INSTRUCTION[lang] || WEBEX_LANG_INSTRUCTION['zh-TW']);
}

// ── 驗簽 ──────────────────────────────────────────────────────────────────────
function verifySignature(rawBody, signature, secret) {
  if (!secret) return true; // 未設定 secret 時跳過驗簽（不建議用於 prod）
  if (!signature) return false;
  try {
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(rawBody);
    const expected = hmac.digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature.toLowerCase(), 'hex'),
      Buffer.from(expected.toLowerCase(), 'hex')
    );
  } catch (e) {
    return false;
  }
}

// ── 共用 access 權限參數（MCP/DIFY/KB 六種 grantee_type）────────────────────
// 回傳 { clause, params } 供 EXISTS 子查詢使用
// accessAlias: access 表別名, fkCol: 外鍵欄位名 (e.g. 'mcp_server_id', 'dify_kb_id')
function buildAccessFilter(accessAlias, fkCol, tableAlias, user) {
  const a = accessAlias;
  const clause = `EXISTS (
    SELECT 1 FROM ${fkCol.includes('mcp') ? 'mcp_access' : 'dify_access'} ${a}
    WHERE ${a}.${fkCol}=${tableAlias}.id AND (
      (${a}.grantee_type='user'        AND ${a}.grantee_id=?)
      OR (${a}.grantee_type='role'        AND ${a}.grantee_id=? AND ? IS NOT NULL)
      OR (${a}.grantee_type='department'  AND ${a}.grantee_id=? AND ? IS NOT NULL)
      OR (${a}.grantee_type='cost_center' AND ${a}.grantee_id=? AND ? IS NOT NULL)
      OR (${a}.grantee_type='division'    AND ${a}.grantee_id=? AND ? IS NOT NULL)
      OR (${a}.grantee_type='factory'     AND ${a}.grantee_id=? AND ? IS NOT NULL)
      OR (${a}.grantee_type='org_group'   AND ${a}.grantee_id=? AND ? IS NOT NULL)
    )
  )`;
  const params = [
    String(user.id),
    user.role_id != null ? String(user.role_id) : null, user.role_id ?? null,
    user.dept_code ?? null, user.dept_code ?? null,
    user.profit_center ?? null, user.profit_center ?? null,
    user.org_section ?? null, user.org_section ?? null,
    user.factory_code ?? null, user.factory_code ?? null,
    user.org_group_name ?? null, user.org_group_name ?? null,
  ];
  return { clause, params };
}

// ── Email 正規化 ───────────────────────────────────────────────────────────────
// @foxlink.com.tw → @foxlink.com，不分大小寫
function normalizeEmail(email) {
  return (email || '').toLowerCase().replace(/@foxlink\.com\.tw$/i, '@foxlink.com');
}

// ── 取台北時區日期字串 YYYY-MM-DD ─────────────────────────────────────────────
function getTaipeiDateStr() {
  return new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-');
}

// ── 去除 @Bot mention 前綴 ────────────────────────────────────────────────────
function stripMention(text, botName) {
  if (!text) return '';
  // 去除 HTML mention 標籤 (透過 message.text 取得的通常已是純文字)
  let clean = text.replace(/<spark-mention[^>]*>.*?<\/spark-mention>/gi, '').trim();
  // 去除 "@BotName " 前綴（群組 room 常見）
  if (botName) {
    clean = clean.replace(new RegExp(`^@?${botName}\\s*`, 'i'), '').trim();
  }
  return clean;
}

// ── Email domain 白名單（system_settings.webex_allowed_domains，空陣列=全拒）──
// 快取 60 秒避免每則訊息都打 DB
let _domainCache = { at: 0, list: [] };
async function getAllowedDomains(db) {
  const now = Date.now();
  if (now - _domainCache.at < 60_000) return _domainCache.list;
  try {
    const row = await db.prepare(
      `SELECT value FROM system_settings WHERE key='webex_allowed_domains'`
    ).get();
    let list = [];
    if (row?.value) {
      try { list = JSON.parse(row.value); } catch { list = []; }
    }
    if (!Array.isArray(list)) list = [];
    // 規格化：lowercase + trim（domain 本身大小寫不敏感）
    list = list.map(d => String(d || '').trim().toLowerCase()).filter(Boolean);
    _domainCache = { at: now, list };
    return list;
  } catch (e) {
    console.error('[Webex][Auth] getAllowedDomains error:', e.message);
    // DB 故障保守做法：回空 → 拒絕全部（符合 fail-closed）
    return [];
  }
}

function extractDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

// ── DB 查用戶（email 正規化比對）────────────────────────────────────────────────
async function findUserByEmail(db, rawEmail) {
  const normalized = normalizeEmail(rawEmail);
  console.log(`[Webex][Auth] email lookup: raw="${rawEmail}" → normalized="${normalized}"`);
  let row;
  try {
    row = await db.prepare(
      `SELECT id, username, name, email, role, status,
              allow_text_upload, text_max_mb,
              allow_audio_upload, audio_max_mb,
              allow_image_upload, image_max_mb,
              budget_daily, budget_weekly, budget_monthly,
              role_id, dept_code, profit_center, org_section, org_group_name,
              webex_bot_enabled, preferred_language
       FROM users
       WHERE LOWER(REPLACE(email, '.com.tw', '.com')) = ?
       FETCH FIRST 1 ROWS ONLY`
    ).get(normalized);
  } catch (e) {
    console.error(`[Webex][Auth] DB query error: ${e.message}`);
    return null;
  }
  if (row) {
    console.log(`[Webex][Auth] ✅ user found: id=${row.id} username="${row.username}" name="${row.name}" email="${row.email}" role=${row.role} status=${row.status}`);
  } else {
    console.warn(`[Webex][Auth] ❌ user NOT found for normalized email="${normalized}"`);
  }
  return row;
}

// ── 取得或建立 Webex Session ──────────────────────────────────────────────────
async function getOrCreateSession(db, userId, roomId, isDm) {
  const today = getTaipeiDateStr();

  if (isDm) {
    // DM: 每日新 session
    const existing = await db.prepare(
      `SELECT id FROM chat_sessions
       WHERE user_id=? AND source='webex_dm'
         AND TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') = ?
       ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY`
    ).get(userId, today);
    if (existing) return existing.id;
  } else {
    // Room: 永久 session
    const existing = await db.prepare(
      `SELECT id FROM chat_sessions
       WHERE webex_room_id=? AND source='webex_room'
       ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY`
    ).get(roomId);
    if (existing) return existing.id;
  }

  // 建立新 session
  const sessionId = uuidv4();
  const source = isDm ? 'webex_dm' : 'webex_room';
  const title = isDm ? `Webex DM ${today}` : `Webex Room ${roomId.slice(-8)}`;
  await db.prepare(
    `INSERT INTO chat_sessions (id, user_id, title, model, source, webex_room_id)
     VALUES (?, ?, ?, 'pro', ?, ?)`
  ).run(sessionId, userId, title, source, isDm ? null : roomId);
  return sessionId;
}

// ── 強制新開 Session ──────────────────────────────────────────────────────────
async function createNewSession(db, userId, roomId, isDm) {
  const today = getTaipeiDateStr();
  const sessionId = uuidv4();
  const source = isDm ? 'webex_dm' : 'webex_room';
  const title = isDm ? `Webex DM ${today}` : `Webex Room ${roomId.slice(-8)}`;
  await db.prepare(
    `INSERT INTO chat_sessions (id, user_id, title, model, source, webex_room_id)
     VALUES (?, ?, ?, 'pro', ?, ?)`
  ).run(sessionId, userId, title, source, isDm ? null : roomId);
  return sessionId;
}

// ── 工具清單（? 指令）────────────────────────────────────────────────────────
async function buildToolList(db, user, lang) {
  const L = {
    'zh-TW': { title: '📋 **您可使用的工具**（依帳號授權）\n', skills: '🔧 **技能 (Skills)**：', kb: '🧠 **自建知識庫 (KB)**：', dify: '🔌 **API 連接器**：', mcp: '⚙️ **MCP 工具**：', empty: '（目前無可用工具）', tip: '💡 直接輸入問題，AI 將自動判斷並使用合適工具。' },
    'en':    { title: '📋 **Your Available Tools** (based on account permissions)\n', skills: '🔧 **Skills**:', kb: '🧠 **Knowledge Bases (KB)**:', dify: '🔌 **API Connectors**:', mcp: '⚙️ **MCP Tools**:', empty: '(No tools available)', tip: '💡 Just type your question — AI will automatically select the appropriate tool.' },
    'vi':   { title: '📋 **Công cụ khả dụng của bạn** (theo quyền tài khoản)\n', skills: '🔧 **Kỹ năng (Skills)**:', kb: '🧠 **Kho tri thức tự xây (KB)**:', dify: '🔌 **Bộ kết nối API**:', mcp: '⚙️ **Công cụ MCP**:', empty: '(Không có công cụ khả dụng)', tip: '💡 Chỉ cần nhập câu hỏi — AI sẽ tự động chọn công cụ phù hợp.' },
  };
  const l = L[lang] || L['zh-TW'];
  const lines = [l.title];

  // 依語言取名稱/描述，fallback 到原始 name/description
  const langSuffix = lang === 'en' ? 'en' : lang === 'vi' ? 'vi' : 'zh';
  const pickName = (row) => row[`name_${langSuffix}`] || row.name;
  const pickDesc = (row) => row[`desc_${langSuffix}`] || row.description;

  // ── 4 個查詢並行執行（Promise.all）─────────────────────────────────────────
  const difyAcl = buildAccessFilter('a', 'dify_kb_id', 'd', user);
  const mcpAcl  = buildAccessFilter('a', 'mcp_server_id', 'm', user);

  const [skills, kbs, difyKbs, mcpServers] = await Promise.all([
    // Skills
    db.prepare(
      `SELECT name, description, name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi FROM skills
       WHERE is_public=1
          OR owner_user_id=?
          OR EXISTS (
            SELECT 1 FROM skill_access sa WHERE sa.skill_id=skills.id
            AND ((sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
              OR (sa.grantee_type='role' AND sa.grantee_id=TO_CHAR(?))
              OR (sa.grantee_type='dept'          AND sa.grantee_id=? AND ? IS NOT NULL)
              OR (sa.grantee_type='profit_center' AND sa.grantee_id=? AND ? IS NOT NULL)
              OR (sa.grantee_type='org_section'   AND sa.grantee_id=? AND ? IS NOT NULL)
              OR (sa.grantee_type='factory'       AND sa.grantee_id=? AND ? IS NOT NULL)
              OR (sa.grantee_type='org_group'     AND sa.grantee_id=? AND ? IS NOT NULL))
          )
       ORDER BY name ASC`
    ).all(
      user.id, user.id, user.role_id || 0,
      user.dept_code || null, user.dept_code || null,
      user.profit_center || null, user.profit_center || null,
      user.org_section || null, user.org_section || null,
      user.factory_code || null, user.factory_code || null,
      user.org_group_name || null, user.org_group_name || null,
    ).catch(e => {
      console.warn('[Webex] buildToolList skills error:', e.message);
      return [];
    }),
    // 自建 KB
    db.prepare(
      `SELECT kb.name, kb.description, kb.name_zh, kb.name_en, kb.name_vi, kb.desc_zh, kb.desc_en, kb.desc_vi FROM knowledge_bases kb
       WHERE kb.chunk_count>0 AND (
         kb.creator_id=? OR kb.is_public=1
         OR EXISTS (
           SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id
           AND ((ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
             OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
             OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
             OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
             OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
             OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
             OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL))
         )
       )
       ORDER BY kb.name ASC`
    ).all(
      user.id, user.id, user.role_id || 0,
      user.dept_code || null, user.dept_code || null,
      user.profit_center || null, user.profit_center || null,
      user.org_section || null, user.org_section || null,
      user.factory_code || null, user.factory_code || null,
      user.org_group_name || null, user.org_group_name || null,
    ).catch(e => {
      console.warn('[Webex] buildToolList selfKB error:', e.message);
      return [];
    }),
    // DIFY KB
    db.prepare(
      `SELECT d.name, DBMS_LOB.SUBSTR(d.description, 200, 1) AS description, d.sort_order,
              d.name_zh, d.name_en, d.name_vi,
              DBMS_LOB.SUBSTR(d.desc_zh, 200, 1) AS desc_zh, DBMS_LOB.SUBSTR(d.desc_en, 200, 1) AS desc_en, DBMS_LOB.SUBSTR(d.desc_vi, 200, 1) AS desc_vi
       FROM dify_knowledge_bases d
       WHERE d.is_active=1 AND (
         (d.is_public=1 AND d.public_approved=1)
         OR ${difyAcl.clause}
       )
       ORDER BY d.sort_order ASC`
    ).all(...difyAcl.params).catch(e => {
      console.warn('[Webex] buildToolList dify error:', e.message);
      return [];
    }),
    // MCP
    db.prepare(
      `SELECT m.name, DBMS_LOB.SUBSTR(m.description, 200, 1) AS description,
              m.name_zh, m.name_en, m.name_vi,
              DBMS_LOB.SUBSTR(m.desc_zh, 200, 1) AS desc_zh, DBMS_LOB.SUBSTR(m.desc_en, 200, 1) AS desc_en, DBMS_LOB.SUBSTR(m.desc_vi, 200, 1) AS desc_vi
       FROM mcp_servers m
       WHERE m.is_active=1 AND (
         (m.is_public=1 AND m.public_approved=1)
         OR ${mcpAcl.clause}
       )
       ORDER BY m.name ASC`
    ).all(...mcpAcl.params).catch(e => {
      console.warn('[Webex] buildToolList mcp error:', e.message);
      return [];
    }),
  ]);

  if (skills.length > 0) {
    lines.push(l.skills);
    skills.forEach(s => {
      const desc = pickDesc(s) ? ` — ${pickDesc(s).slice(0, 40)}` : '';
      lines.push(`• ${pickName(s)}${desc}`);
    });
    lines.push('');
  }

  if (kbs.length > 0) {
    lines.push(l.kb);
    kbs.forEach(k => {
      const desc = pickDesc(k) ? ` — ${pickDesc(k).slice(0, 40)}` : '';
      lines.push(`• ${pickName(k)}${desc}`);
    });
    lines.push('');
  }

  if (difyKbs.length > 0) {
    lines.push(l.dify);
    difyKbs.forEach(k => {
      const desc = pickDesc(k) ? ` — ${pickDesc(k).slice(0, 40)}` : '';
      lines.push(`• ${pickName(k)}${desc}`);
    });
    lines.push('');
  }

  if (mcpServers.length > 0) {
    lines.push(l.mcp);
    mcpServers.forEach(m => {
      const desc = pickDesc(m) ? ` — ${pickDesc(m).slice(0, 40)}` : '';
      lines.push(`• ${pickName(m)}${desc}`);
    });
    lines.push('');
  }

  if (lines.length <= 1) {
    lines.push(l.empty);
  } else {
    lines.push(l.tip);
  }

  return lines.join('\n');
}

// ── 稽核 ──────────────────────────────────────────────────────────────────────
async function checkSensitiveKeywords(db, user, sessionId, content) {
  try {
    const keywords = await db.prepare(`SELECT keyword FROM sensitive_keywords`).all();
    const lowerContent = content.toLowerCase();
    const matched = keywords.map(k => k.keyword).filter(kw => lowerContent.includes(kw.toLowerCase()));
    const hasSensitive = matched.length > 0 ? 1 : 0;

    await db.prepare(
      `INSERT INTO audit_logs (user_id, session_id, content, has_sensitive, sensitive_keywords, source)
       VALUES (?, ?, ?, ?, ?, 'webex')`
    ).run(user.id, sessionId, content.slice(0, 4000), hasSensitive, matched.length ? JSON.stringify(matched) : null);

    if (hasSensitive) {
      notifyAdminSensitiveKeyword({ user, content, keywords: matched, sessionId }).catch(e => {
        console.error('[Webex][Audit] notify error:', e.message);
      });
    }
  } catch (e) {
    console.error('[Webex][Audit] error:', e.message);
  }
}

// ── 載入 function declarations（selfKB + DIFY + MCP）────────────────────────
async function loadFunctionDeclarations(db, user) {
  const declarations = [];
  const handlers = {};

  // ── 自建 KB ─────────────────────────────────────────────────────────────────
  try {
    const kbs = await db.prepare(
        `SELECT kb.id, kb.name, kb.description, kb.retrieval_mode, kb.embedding_dims, kb.top_k_return, kb.score_threshold, kb.retrieval_config
         FROM knowledge_bases kb
         WHERE kb.chunk_count>0 AND (
           kb.creator_id=? OR kb.is_public=1
           OR EXISTS (SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
             (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
             OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
             OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
             OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
             OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
             OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
             OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
           ))
         )
         ORDER BY kb.name ASC`
      ).all(
        user.id, user.id, user.role_id || 0,
        user.dept_code || null, user.dept_code || null,
        user.profit_center || null, user.profit_center || null,
        user.org_section || null, user.org_section || null,
        user.factory_code || null, user.factory_code || null,
        user.org_group_name || null, user.org_group_name || null,
      );

    for (const kb of kbs) {
      const fnName = `selfkb_${kb.id.replace(/-/g, '_')}`;
      declarations.push({
        name: fnName,
        description: `查詢自建知識庫「${kb.name}」。${kb.description ? `適用範疇：${kb.description}` : ''}。每次對話此工具只呼叫一次。`,
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '查詢問題' } },
          required: ['query'],
        },
      });
      handlers[fnName] = async (args) => {
        try {
          const { retrieveKbChunks } = require('../services/kbRetrieval');
          const { results } = await retrieveKbChunks(db, {
            kb, query: args.query || '', source: 'webex',
          });
          if (results.length === 0) return `[知識庫「${kb.name}」未找到相關內容]`;
          return `【知識庫「${kb.name}」結果】\n\n` + results.map((r, i) =>
            `[${i + 1}] 來源: ${r.filename} (${((r.score || 0) * 100).toFixed(0)}%)\n${r.content}`
          ).join('\n\n---\n\n');
        } catch (e) {
          return `[知識庫「${kb.name}」查詢失敗: ${e.message}]`;
        }
      };
    }
  } catch (e) {
    console.warn('[Webex] loadFunctionDeclarations selfKB error:', e.message);
  }

  // ── DIFY KB ──────────────────────────────────────────────────────────────────
  try {
    const { buildFunctionDeclaration, executeConnector } = require('../services/apiConnectorService');
    const difyAcl2 = buildAccessFilter('a', 'dify_kb_id', 'd', user);
    console.log(`[Webex][loadFuncDecl] API params: ${JSON.stringify(difyAcl2.params)}`);
    const difyKbs = await db.prepare(
      `SELECT d.*
       FROM dify_knowledge_bases d
       WHERE d.is_active=1 AND (
         (d.is_public=1 AND d.public_approved=1)
         OR ${difyAcl2.clause}
       )
       ORDER BY d.sort_order ASC`
    ).all(...difyAcl2.params);
    console.log(`[Webex][loadFuncDecl] API result count: ${difyKbs.length}`);

    for (const kb of difyKbs) {
      const decl = buildFunctionDeclaration(kb);
      declarations.push(decl);
      const connType = kb.connector_type || 'dify';
      handlers[decl.name] = async (args) => {
        try {
          const userCtx = { id: user.id, email: user.email || '', name: user.name || '', employee_id: user.employee_id || '', dept_code: user.dept_code || '' };
          const answer = await executeConnector(kb, args, userCtx, { sessionId: null, db });
          const label = connType === 'dify' ? `DIFY「${kb.name}」` : `API「${kb.name}」`;
          return `【${label}結果】\n${answer}`;
        } catch (e) {
          return `[API「${kb.name}」查詢失敗: ${e.message}]`;
        }
      };
    }
  } catch (e) {
    console.warn('[Webex] loadFunctionDeclarations api error:', e.message);
  }

  // ── MCP ──────────────────────────────────────────────────────────────────────
  try {
    const mcpClient = require('../services/mcpClient');
    const mcpAcl2 = buildAccessFilter('a', 'mcp_server_id', 'm', user);
    console.log(`[Webex][loadFuncDecl] MCP params: ${JSON.stringify(mcpAcl2.params)}`);
    const mcpServers = await db.prepare(
      `SELECT m.*
       FROM mcp_servers m
       WHERE m.is_active=1 AND (
         (m.is_public=1 AND m.public_approved=1)
         OR ${mcpAcl2.clause}
       )
       ORDER BY m.name ASC`
    ).all(...mcpAcl2.params);
    console.log(`[Webex][loadFuncDecl] MCP result count: ${mcpServers.length}`);

    for (const srv of mcpServers) {
      try {
        const tools = await mcpClient.listTools(db, srv);
        for (const tool of (tools || [])) {
          const fnName = `mcp_${srv.id}_${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
          declarations.push({
            name: fnName,
            description: `[MCP:${srv.name}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema || { type: 'object', properties: {} },
          });
          handlers[fnName] = async (args) => {
            try {
              const mcpUserCtx = { id: user.id, email: user.email || '', name: user.name || '', employee_id: user.employee_id || '', dept_code: user.dept_code || '' };
              const result = await mcpClient.callTool(db, srv, null, user.id, tool.name, args, mcpUserCtx);
              return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            } catch (e) {
              return `[MCP "${tool.name}" 錯誤: ${e.message}]`;
            }
          };
        }
      } catch (e) {
        console.warn(`[Webex] MCP server "${srv.name}" tools load failed:`, e.message);
      }
    }
  } catch (e) {
    console.warn('[Webex] loadFunctionDeclarations mcp error:', e.message);
  }

  return { declarations, handlers };
}

/**
 * Sanitize Gemini history: filter empty model turns, merge consecutive same-role,
 * strip leading model turns, ensure history ends with model turn.
 */
function sanitizeHistory(hist) {
  if (!hist || hist.length === 0) return [];
  const isEmptyTextPart = (p) => !p.inlineData && !p.functionCall && !p.functionResponse
    && typeof p.text === 'string' && p.text.trim() === '';
  // filter out model turns with only empty text
  const filtered = hist.filter((entry) => {
    if (entry.role !== 'model') return true;
    return entry.parts.filter((p) => !isEmptyTextPart(p)).length > 0;
  });
  // merge consecutive same-role entries
  const merged = [];
  for (const entry of filtered) {
    const last = merged[merged.length - 1];
    if (last && last.role === entry.role) {
      last.parts = [...last.parts, ...entry.parts];
    } else {
      merged.push({ role: entry.role, parts: [...entry.parts] });
    }
  }
  // strip leading model turns (Gemini requires first content = user)
  while (merged.length > 0 && merged[0].role === 'model') {
    merged.shift();
  }
  // history must end with model turn
  while (merged.length > 0 && merged[merged.length - 1].role === 'user') {
    merged.pop();
  }
  return merged;
}

// ── 主訊息處理 ─────────────────────────────────────────────────────────────────
async function processMessage(db, webex, user, sessionId, roomId, messageText, fileUrls, isDm, lang) {
  const today = getTaipeiDateStr();

  // 1. 下載並處理附件
  const userParts = [];
  let combinedText = messageText;
  const fileMetas = [];

  for (const fileUrl of fileUrls) {
    const tmpName = `webex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tmpPath = path.join(WEBEX_TMP_DIR, tmpName);
    let downloaded = null;

    try {
      downloaded = await webex.downloadFile(fileUrl, tmpPath);
      const { filename, mimeType } = downloaded;
      const sizeMb = fs.statSync(tmpPath).size / 1024 / 1024;

      // 影片檔拒絕
      if (mimeType.startsWith('video/')) {
        await webex.sendMessage(roomId, t('video_reject', lang, filename));
        fs.unlink(tmpPath, () => {});
        continue;
      }

      // 音訊轉錄
      if (mimeType.startsWith('audio/')) {
        const maxMb = user.audio_max_mb || 10;
        if (!user.allow_audio_upload) {
          await webex.sendMessage(roomId, t('audio_no_perm', lang, filename));
          fs.unlink(tmpPath, () => {});
          continue;
        }
        if (sizeMb > maxMb) {
          await webex.sendMessage(roomId, t('audio_too_large', lang, maxMb, filename));
          fs.unlink(tmpPath, () => {});
          continue;
        }
        try {
          const res = await transcribeAudio(tmpPath, mimeType);
          combinedText += `\n\n[音訊轉錄: ${filename}]\n${res.text}`;
          fileMetas.push({ name: filename, type: 'audio' });
          if (res.inputTokens || res.outputTokens) {
            await upsertTokenUsage(db, user.id, today, 'flash', res.inputTokens, res.outputTokens, 0);
          }
        } catch (e) {
          console.error('[Webex] Audio transcribe error:', e.message);
          combinedText += `\n\n[音訊轉錄失敗: ${filename}]`;
        }
        fs.unlink(tmpPath, () => {});
        continue;
      }

      // 圖片
      if (mimeType.startsWith('image/')) {
        if (user.allow_image_upload === 0) {
          await webex.sendMessage(roomId, t('image_no_perm', lang, filename));
          fs.unlink(tmpPath, () => {});
          continue;
        }
        const maxMb = user.image_max_mb || 10;
        if (sizeMb > maxMb) {
          await webex.sendMessage(roomId, t('image_too_large', lang, maxMb, filename));
          fs.unlink(tmpPath, () => {});
          continue;
        }
        userParts.push(await fileToGeminiPart(tmpPath, mimeType));
        fileMetas.push({ name: filename, type: 'image' });
        fs.unlink(tmpPath, () => {});
        continue;
      }

      // PDF inline
      const MAX_PDF_INLINE_MB = 15;
      if (mimeType === 'application/pdf' && sizeMb <= MAX_PDF_INLINE_MB) {
        userParts.push(await fileToGeminiPart(tmpPath, mimeType));
        fileMetas.push({ name: filename, type: 'document' });
        fs.unlink(tmpPath, () => {});
        continue;
      }

      // 其他文件 → 文字提取
      const extracted = await extractTextFromFile(tmpPath, mimeType, filename);
      if (extracted) {
        combinedText += `\n\n${extracted}`;
        fileMetas.push({ name: filename, type: 'document' });
      } else {
        fileMetas.push({ name: filename, type: 'unknown' });
      }
      fs.unlink(tmpPath, () => {});

    } catch (e) {
      console.error('[Webex] File download/process error:', e.message);
      if (fs.existsSync(tmpPath)) fs.unlink(tmpPath, () => {});
    }
  }

  if (combinedText.trim()) {
    userParts.push({ text: combinedText });
  }

  if (userParts.length === 0) return;

  // 2. 儲存用戶訊息
  await db.prepare(
    `INSERT INTO chat_messages (session_id, role, content, files_json) VALUES (?, 'user', ?, ?)`
  ).run(sessionId, combinedText, fileMetas.length ? JSON.stringify(fileMetas) : null);

  // 3. 稽核
  await checkSensitiveKeywords(db, user, sessionId, combinedText);

  // 4. 載入歷史
  const historyMsgs = await db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE session_id=? ORDER BY created_at DESC FETCH FIRST ? ROWS ONLY`
  ).all(sessionId, MAX_HISTORY_MESSAGES);
  // 倒序回正序，移除最後一筆（剛插入的用戶訊息），並 sanitize
  const rawHistory = historyMsgs.reverse().slice(0, -1).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || ' ' }],
  }));
  const history = sanitizeHistory(rawHistory);

  // 5. 載入工具
  const { declarations, handlers } = await loadFunctionDeclarations(db, user);

  // 6. 呼叫 AI
  // 6. Budget 檢查（admin 豁免）
  if (user.role !== 'admin') {
    const budget = await checkBudgetExceeded(db, user.id);
    if (budget.exceeded && budget.action !== 'warn') {
      await webex.sendMessage(roomId, translateBudgetMsg(budget.message, lang));
      return;
    }
    if (budget.exceeded && budget.action === 'warn') {
      // warn 模式：繼續執行但提示
      console.warn(`[Webex][Budget] warn user=${user.id} msg="${budget.message}"`);
    }
  }

  const { apiModel } = await resolveApiModel(db, 'pro');
  console.log(`[Webex] Calling AI model=${apiModel} user=${user.username} session=${sessionId} tools=${declarations.length}`);

  // Typing indicator：發送「處理中」提示，AI 回覆後 edit 為實際內容
  let typingMsgId = null;
  try {
    typingMsgId = await webex.sendMessage(roomId, t('typing', lang));
  } catch (_) {}

  let aiText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const result = await generateWithTools(
      apiModel,
      history,
      userParts,
      declarations,
      async (name, args) => {
        const handler = handlers[name];
        if (!handler) return `[未知工具: ${name}]`;
        return handler(args);
      },
      getWebexSystemSuffix(lang)
    );
    aiText = result.text || '';
    inputTokens = result.inputTokens || 0;
    outputTokens = result.outputTokens || 0;
  } catch (e) {
    console.error('[Webex] AI call error:', e.message);
    await webex.sendMessage(roomId, t('ai_error', lang, e.message?.slice(0, 80)));
    return;
  }

  // 7. 處理 generate_xxx 代碼塊
  let generatedFiles = [];
  const hasGenerateBlock = /```generate_[a-z_]+:[^\n]+/.test(aiText);
  console.log(`[Webex] generate blocks detected=${hasGenerateBlock} aiTextLen=${aiText.length}`);
  try {
    const genResult = await processGenerateBlocks(aiText, { userId: user.id, sessionId });
    if (genResult?.length) {
      generatedFiles = genResult; // processGenerateBlocks returns array directly
      console.log(`[Webex] generated ${generatedFiles.length} file(s): ${generatedFiles.map(f => f.filename).join(', ')}`);
      // 清除 code block，只保留說明文字
      aiText = aiText.replace(/```generate_[a-z_]+:[^\n]+\n[\s\S]*?```/g, '').trim();
    }
  } catch (e) {
    console.warn('[Webex] processGenerateBlocks error:', e.message);
  }

  // fallback：AI 說了「附件傳送」但沒有 generate 代碼塊
  // → 自動將 AI 輸出內容包裝成 generate 代碼塊再次嘗試生成
  const claimedAttachment = /附件傳送|以附件/.test(aiText);
  if (claimedAttachment && !hasGenerateBlock && generatedFiles.length === 0) {
    console.warn('[Webex] Auto-wrap fallback: AI claimed attachment but no generate block');

    const attachIdx = aiText.indexOf('📎');
    const contentPart = (attachIdx > 0 ? aiText.slice(0, attachIdx) : aiText)
      .replace(/📎[^\n]*/g, '').trim();

    if (contentPart.length > 30) {
      // 從用戶訊息推斷格式
      const msgLow = combinedText.toLowerCase();
      let genType = 'pdf';
      if (msgLow.includes('excel') || msgLow.includes('xlsx') || msgLow.includes('試算表')) {
        genType = 'xlsx';
      } else if (msgLow.includes('word') || msgLow.includes('docx')) {
        genType = 'docx';
      } else if (msgLow.includes('txt') || msgLow.includes('文字檔')) {
        genType = 'txt';
      }

      const fname = `document_${Date.now()}.${genType === 'xlsx' ? 'xlsx' : genType === 'docx' ? 'docx' : genType === 'txt' ? 'txt' : 'pdf'}`;
      const syntheticBlock = `\`\`\`generate_${genType}:${fname}\n${contentPart}\n\`\`\``;
      console.log(`[Webex] Auto-wrap: generate_${genType}:${fname} contentLen=${contentPart.length}`);

      try {
        const genResult = await processGenerateBlocks(syntheticBlock, { userId: user.id, sessionId });
        if (genResult?.length) {
          generatedFiles = genResult; // array direct
          aiText = '📎 檔案將以附件傳送，請稍候';
          console.log(`[Webex] Auto-wrap succeeded: ${generatedFiles.map(f => f.filename).join(', ')}`);
        }
      } catch (e) {
        console.warn('[Webex] Auto-wrap error:', e.message);
      }
    }

    if (generatedFiles.length === 0) {
      // 最終 fallback：清除誤導文字，提示重試
      aiText = contentPart || aiText.replace(/📎[^\n]*/g, '').trim();
      aiText += '\n\n⚠️ 抱歉，檔案生成失敗。請重新傳送指令，例如「整理成 PDF」或「匯出為 Excel」。';
      console.warn('[Webex] Auto-wrap failed, showing error to user');
    }
  }

  // 8. 截斷過長回應
  if (aiText.length > MAX_WEBEX_CHARS) {
    const publicUrl = process.env.WEBEX_PUBLIC_URL || '';
    aiText = aiText.slice(0, MAX_WEBEX_CHARS) +
      `\n\n…（回應過長已截斷${publicUrl ? `，完整版請至 ${publicUrl}` : ''}）`;
  }

  // 9. 儲存 AI 訊息
  await db.prepare(
    `INSERT INTO chat_messages (session_id, role, content, input_tokens, output_tokens) VALUES (?, 'assistant', ?, ?, ?)`
  ).run(sessionId, aiText, inputTokens, outputTokens);

  // 10. 更新 session
  await db.prepare(`UPDATE chat_sessions SET updated_at=SYSTIMESTAMP WHERE id=?`).run(sessionId);

  // 11. 記錄 token
  await upsertTokenUsage(db, user.id, today, 'pro', inputTokens, outputTokens, 0);

  // 12. 送回 Webex 文字回應（優先 edit typing indicator，fallback 新訊息）
  if (aiText.trim()) {
    let edited = false;
    if (typingMsgId) {
      edited = await webex.editMessage(typingMsgId, aiText, { markdown: aiText });
    }
    if (!edited) {
      await webex.sendMessage(roomId, aiText, { markdown: aiText });
    }
  } else if (typingMsgId) {
    // AI 沒回文字，刪掉 typing indicator
    await webex.deleteMessage(typingMsgId);
  }

  // 13. 送回生成的檔案（使用 file.filePath，包含 timestamp prefix）
  for (const file of generatedFiles) {
    try {
      const filePath = file.filePath; // e.g. /uploads/generated/1234567890_report.pdf
      console.log(`[Webex] Sending file: ${filePath} exists=${fs.existsSync(filePath)}`);
      if (fs.existsSync(filePath)) {
        await webex.sendFile(roomId, t('file_generated', lang, file.filename), filePath);
        console.log(`[Webex] File sent: ${file.filename}`);
      } else {
        console.error(`[Webex] File not found: ${filePath}`);
      }
    } catch (e) {
      console.error('[Webex] File send error:', e.message);
    }
  }
}

// ── 解析 API model ─────────────────────────────────────────────────────────────
async function resolveApiModel(db, modelKey) {
  try {
    const row = await db.prepare(
      `SELECT api_model FROM llm_models WHERE key=? AND is_active=1 FETCH FIRST 1 ROWS ONLY`
    ).get(modelKey);
    if (row?.api_model) return { apiModel: row.api_model };
  } catch (e) {}
  if (modelKey === 'flash') return { apiModel: process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash' };
  return { apiModel: process.env.GEMINI_MODEL_PRO || 'gemini-2.0-pro' };
}

// ── Webhook 端點 ───────────────────────────────────────────────────────────────
// rawBody 由 server.js 的 express.json verify 捕捉，存在 req.rawBody
router.post('/webhook', async (req, res) => {
  // 立即回 200（Webex 要求 15 秒內回應）
  res.sendStatus(200);

  const secret = process.env.WEBEX_WEBHOOK_SECRET;
  const signature = req.headers['x-spark-signature'];
  const rawBody = req.rawBody; // Buffer，由 express.json verify 儲存

  console.log(`[Webex] Webhook received: ip=${req.ip} hasRawBody=${!!rawBody} hasSignature=${!!signature}`);

  // 驗簽
  if (!verifySignature(rawBody, signature, secret)) {
    console.warn(`[Webex] ❌ Signature mismatch from ${req.ip} — rawBodyLen=${rawBody?.length ?? 'N/A'} sig="${signature?.slice(0,10)}..."`);
    return;
  }
  console.log('[Webex] ✅ Signature verified');

  // req.body 已由 express.json 解析，直接用
  const event = req.body;
  if (!event || typeof event !== 'object') {
    console.error('[Webex] Invalid event body');
    return;
  }

  console.log(`[Webex] Event: resource=${event.resource} event=${event.event} actorId=${event.actorId} msgId=${event.data?.id}`);

  // 只處理 messages:created
  if (event.resource !== 'messages' || event.event !== 'created') {
    console.log(`[Webex] Ignored non-message event: ${event.resource}/${event.event}`);
    return;
  }

  // 背景處理（不 block response）
  setImmediate(() => handleWebexEvent(event).catch(e => {
    console.error('[Webex] handleWebexEvent uncaught:', e.message, e.stack);
  }));
});

// Webhook 事件處理（取完整訊息後交給 handleWebexMessage）
async function handleWebexEvent(event) {
  let webex;
  try {
    webex = getWebexService();
  } catch (e) {
    console.error('[Webex] getWebexService error:', e.message);
    return;
  }

  // 過濾 Bot 自己發的訊息
  const botPersonId = await webex.getBotPersonId().catch(() => null);
  console.log(`[Webex] botPersonId=${botPersonId} actorId=${event.actorId}`);
  if (botPersonId && event.actorId === botPersonId) {
    console.log('[Webex] Ignored: bot own message (actorId match)');
    return;
  }
  if (botPersonId && event.data?.personId === botPersonId) {
    console.log('[Webex] Ignored: bot own message (personId match)');
    return;
  }

  // 取得完整訊息
  let message;
  try {
    message = await webex.getMessage(event.data.id);
    console.log(`[Webex] Message fetched: id=${message.id} roomType=${message.roomType} personEmail="${message.personEmail}" text="${(message.text || '').slice(0, 80)}" files=${message.files?.length ?? 0}`);
  } catch (e) {
    console.error('[Webex] getMessage error:', e.message);
    return;
  }

  // Redis lock — 避免 polling 同時處理同一訊息（兩者共用同一 lock key）
  const lockKey = `webex:msg:${message.id}`;
  let acquired = true;
  try {
    acquired = await tryLock(lockKey, 300);
  } catch (e) {
    console.warn('[Webex] Webhook tryLock error:', e.message);
    // Redis 故障時保守降級：仍處理（避免訊息遺失）
  }
  if (!acquired) {
    console.log(`[Webex] Webhook skipped (lock held by polling pod): msg=${message.id}`);
    return;
  }
  console.log(`[Webex] Webhook acquired lock: msg=${message.id}`);

  await handleWebexMessage(message);
}

// ── 公開函數：由 webhook 端點或 polling listener 呼叫 ──────────────────────────
// 接受完整 message 物件（已含 personEmail, roomId, text, files 等欄位）
async function handleWebexMessage(message) {
  const db = require('../database-oracle').db;
  let webex;
  try {
    webex = getWebexService();
  } catch (e) {
    console.error('[Webex] getWebexService error:', e.message);
    return;
  }

  const senderEmail = message.personEmail || '';
  const roomId = message.roomId;
  const isDm = message.roomType === 'direct';

  console.log(`[Webex] Incoming ${isDm ? 'DM' : 'GroupRoom'} from="${senderEmail}" roomId="${roomId}"`);

  const roomType = isDm ? 'direct' : 'group';
  const msgPreview = (message.text || '').slice(0, 100);

  // Domain 白名單檢查（先於 user lookup，擋私人 Webex 冒用公司 email 的情境）
  const senderDomain = extractDomain(senderEmail);
  const allowedDomains = await getAllowedDomains(db);
  if (!senderDomain || !allowedDomains.includes(senderDomain)) {
    console.warn(`[Webex][Auth] Domain blocked: email="${senderEmail}" domain="${senderDomain}" allowed=[${allowedDomains.join(',')}]`);
    db.prepare(
      `INSERT INTO webex_auth_logs (raw_email, norm_email, status, room_type, room_id, msg_text)
       VALUES (?, ?, 'domain_blocked', ?, ?, ?)`
    ).run(senderEmail, normalizeEmail(senderEmail), roomType, roomId, msgPreview).catch(() => {});
    await webex.sendMessage(roomId, t('domain_blocked', null, senderEmail));
    return;
  }

  // 查 user
  const user = await findUserByEmail(db, senderEmail);

  if (!user) {
    console.warn(`[Webex][Auth] No user matched, sending rejection to roomId="${roomId}"`);
    // 記錄認證失敗
    db.prepare(
      `INSERT INTO webex_auth_logs (raw_email, norm_email, status, room_type, room_id, msg_text)
       VALUES (?, ?, 'not_found', ?, ?, ?)`
    ).run(senderEmail, normalizeEmail(senderEmail), roomType, roomId, msgPreview).catch(() => {});
    // not_found: 無法取得 user，三語全發
    await webex.sendMessage(roomId, t('not_found', null, senderEmail));
    return;
  }

  // 有 user → 依 preferred_language 決定回應語言
  const lang = user.preferred_language || 'zh-TW';

  if (user.status !== 'active') {
    console.warn(`[Webex][Auth] User id=${user.id} status=${user.status}, rejected`);
    db.prepare(
      `INSERT INTO webex_auth_logs (raw_email, norm_email, user_id, user_name, username, status, room_type, room_id, msg_text)
       VALUES (?, ?, ?, ?, ?, 'disabled', ?, ?, ?)`
    ).run(senderEmail, normalizeEmail(senderEmail), user.id, user.name, user.username, roomType, roomId, msgPreview).catch(() => {});
    await webex.sendMessage(roomId, t('disabled', lang, senderEmail));
    return;
  }
  // webex_bot_enabled = 0 表示此帳號不允許使用 Webex Bot
  if (user.webex_bot_enabled === 0) {
    console.warn(`[Webex][Auth] User id=${user.id} webex_bot_enabled=0, rejected`);
    db.prepare(
      `INSERT INTO webex_auth_logs (raw_email, norm_email, user_id, user_name, username, status, room_type, room_id, msg_text)
       VALUES (?, ?, ?, ?, ?, 'bot_disabled', ?, ?, ?)`
    ).run(senderEmail, normalizeEmail(senderEmail), user.id, user.name, user.username, roomType, roomId, msgPreview).catch(() => {});
    await webex.sendMessage(roomId, t('bot_disabled', lang, senderEmail));
    return;
  }
  console.log(`[Webex][Auth] User authenticated: id=${user.id} username="${user.username}" role=${user.role}`);
  // 記錄認證成功
  db.prepare(
    `INSERT INTO webex_auth_logs (raw_email, norm_email, user_id, user_name, username, status, room_type, room_id, msg_text)
     VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, ?)`
  ).run(senderEmail, normalizeEmail(senderEmail), user.id, user.name, user.username, roomType, roomId, msgPreview).catch(() => {});

  // 取得 Bot 名稱（用來剝 mention）— 使用 cache，不再每次呼叫 API
  const botName = await webex.getBotDisplayName();

  // 解析訊息文字（去 mention）
  const rawText = message.text || '';
  const msgText = stripMention(rawText, botName).trim();
  console.log(`[Webex] Message parsed: botName="${botName}" rawText="${rawText.slice(0, 80)}" → msgText="${msgText.slice(0, 80)}"`);

  // 非 DM 時若訊息為空（只有 mention）直接略過
  if (!isDm && !msgText && (!message.files || message.files.length === 0)) {
    console.log('[Webex] Ignored: empty message after mention strip');
    return;
  }

  // 取得/建立 session
  let sessionId = await getOrCreateSession(db, user.id, roomId, isDm);
  console.log(`[Webex] Session: id=${sessionId} isDm=${isDm}`);

  // ── 指令分派 ──────────────────────────────────────────────────────────────
  const cmdText = msgText.toLowerCase();
  console.log(`[Webex] Dispatch: cmd="${cmdText.slice(0, 30)}"`);

  // ? → 工具清單（容許 "?" / "? :" / "？" 等變體）
  if (/^[?？]\s*[:：]?\s*$/.test(msgText)) {
    const toolList = await buildToolList(db, user, lang);
    await webex.sendMessage(roomId, toolList, { markdown: toolList });
    return;
  }

  // /new 及多種別名 → 新 session + 清理暫存檔
  const NEW_SESSION_CMDS = ['/new', '/重置', '新對話', '重置', '/clear', '/restart', '/reset', 'new'];
  if (NEW_SESSION_CMDS.includes(cmdText)) {
    sessionId = await createNewSession(db, user.id, roomId, isDm);
    // 清理 webex_tmp 中的殘留暫存檔（超過 30 分鐘）
    try {
      const now = Date.now();
      const tmpFiles = fs.readdirSync(WEBEX_TMP_DIR);
      let cleaned = 0;
      for (const f of tmpFiles) {
        const fp = path.join(WEBEX_TMP_DIR, f);
        try {
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs > 30 * 60 * 1000) {
            fs.unlinkSync(fp);
            cleaned++;
          }
        } catch (_) {}
      }
      if (cleaned > 0) console.log(`[Webex] /new cleanup: removed ${cleaned} stale tmp files`);
    } catch (_) {}
    const nowStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    const divider = t('new_session', lang, nowStr);
    await webex.sendMessage(roomId, divider);
    return;
  }

  // /help → 使用說明
  if (cmdText === '/help') {
    const helpText = t('help', lang);
    await webex.sendMessage(roomId, helpText, { markdown: helpText });
    return;
  }

  // ── Feedback 指令 ────────────────────────────────────────────────────────
  if (cmdText.startsWith('feedback ') || cmdText.startsWith('fb ')) {
    try {
      const feedbackService = require('../services/feedbackService');
      const parts = msgText.replace(/^(feedback|fb)\s+/i, '').split(/\s+/);
      const subCmd = (parts[0] || '').toLowerCase();
      const ticketNo = parts[1] || '';
      const restText = parts.slice(2).join(' ');

      if (subCmd === 'list') {
        const result = await feedbackService.listTickets(db, {
          userId: user.id, isAdmin: user.role === 'admin',
          status: 'open,processing,pending_user', sort: 'created_at', order: 'desc', page: 1, limit: 10,
        });
        if (result.tickets.length === 0) {
          await webex.sendMessage(roomId, '目前沒有待處理的工單');
        } else {
          const lines = result.tickets.map(t =>
            `• **${t.ticket_no}** [${t.priority}] ${t.subject} — ${t.status}`
          );
          await webex.sendMessage(roomId, `📋 **待處理工單** (${result.total})\n${lines.join('\n')}`, { markdown: true });
        }
        return;
      }

      if (subCmd === 'view' && ticketNo) {
        const ticket = await feedbackService.getTicketByNo(db, ticketNo.toUpperCase());
        if (!ticket) { await webex.sendMessage(roomId, `找不到工單 ${ticketNo}`); return; }
        const md = `🎫 **${ticket.ticket_no}** [${ticket.priority}] ${ticket.status}\n**申請者：** ${ticket.applicant_name}\n**主旨：** ${ticket.subject}\n**建立：** ${ticket.created_at}`;
        await webex.sendMessage(roomId, md, { markdown: md });
        return;
      }

      if (subCmd === 'reply' && ticketNo && restText) {
        const ticket = await feedbackService.getTicketByNo(db, ticketNo.toUpperCase());
        if (!ticket) { await webex.sendMessage(roomId, `找不到工單 ${ticketNo}`); return; }
        if (user.role !== 'admin') { await webex.sendMessage(roomId, '只有管理員可以回覆工單'); return; }
        await feedbackService.addMessage(db, {
          ticket_id: ticket.id, sender_id: user.id, sender_role: 'admin', content: restText, is_internal: false,
        });
        const { emitNewMessage } = require('../services/socketService');
        emitNewMessage(ticket.id, { content: restText, sender_role: 'admin', sender_name: user.name });
        await webex.sendMessage(roomId, `✅ 已回覆 ${ticket.ticket_no}`);
        return;
      }

      if (subCmd === 'resolve' && ticketNo) {
        const ticket = await feedbackService.getTicketByNo(db, ticketNo.toUpperCase());
        if (!ticket) { await webex.sendMessage(roomId, `找不到工單 ${ticketNo}`); return; }
        if (user.role !== 'admin') { await webex.sendMessage(roomId, '只有管理員可以結案'); return; }
        await feedbackService.changeStatus(db, ticket.id, 'resolved', user.id, restText || 'via Webex');
        await webex.sendMessage(roomId, `✅ 已結案 ${ticket.ticket_no}`);
        return;
      }

      if (subCmd === 'assign' && ticketNo) {
        const ticket = await feedbackService.getTicketByNo(db, ticketNo.toUpperCase());
        if (!ticket) { await webex.sendMessage(roomId, `找不到工單 ${ticketNo}`); return; }
        if (user.role !== 'admin') { await webex.sendMessage(roomId, '只有管理員可以接單'); return; }
        await feedbackService.assignTicket(db, ticket.id, user.id);
        await webex.sendMessage(roomId, `✅ 已接單 ${ticket.ticket_no}`);
        return;
      }

      // 不認識的子指令 → 顯示幫助
      const helpMd = `🎫 **Feedback 指令**\n• \`feedback list\` — 列出待處理工單\n• \`feedback view #FB-xxx\` — 查看工單\n• \`feedback reply #FB-xxx 回覆內容\` — 回覆\n• \`feedback resolve #FB-xxx [說明]\` — 結案\n• \`feedback assign #FB-xxx\` — 接單`;
      await webex.sendMessage(roomId, helpMd, { markdown: helpMd });
      return;
    } catch (fbErr) {
      console.error('[Webex] Feedback command error:', fbErr.message);
      await webex.sendMessage(roomId, `❌ 指令執行失敗: ${fbErr.message}`);
      return;
    }
  }

  // 一般訊息 → AI 處理
  const fileUrls = message.files || [];
  console.log(`[Webex] Processing chat: user=${user.username} session=${sessionId} text="${msgText.slice(0, 50)}" files=${fileUrls.length}`);

  await processMessage(db, webex, user, sessionId, roomId, msgText, fileUrls, isDm, lang);
}

// ── Autoscan：掃描 users.email 的 domain，union 進白名單（啟動時呼叫）──────────
// 策略：只新增、不刪除；admin 若想拒絕某 domain，要先把該 domain 的 users 停用或刪除
// （重啟後會被再加回）。這是為了「部署後新員工自動被放行」。
async function autoScanUserDomains(db) {
  try {
    const rows = await db.prepare(
      `SELECT DISTINCT LOWER(TRIM(email)) AS email FROM users WHERE email IS NOT NULL AND email LIKE '%@%'`
    ).all();

    const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;
    const scanned = new Set();
    for (const r of rows) {
      const d = extractDomain(r.email || r.EMAIL || '');
      if (d && DOMAIN_RE.test(d)) scanned.add(d);
    }

    const row = await db.prepare(
      `SELECT value FROM system_settings WHERE key='webex_allowed_domains'`
    ).get();
    let current = [];
    if (row?.value) {
      try { current = JSON.parse(row.value); } catch { current = []; }
    }
    if (!Array.isArray(current)) current = [];
    current = current.map(d => String(d || '').trim().toLowerCase()).filter(Boolean);

    const currentSet = new Set(current);
    const added = [];
    for (const d of scanned) {
      if (!currentSet.has(d)) {
        added.push(d);
        currentSet.add(d);
      }
    }

    if (added.length === 0) {
      console.log(`[Webex][DomainAutoScan] No new domains (scanned=${scanned.size}, whitelist=${current.length})`);
      return { added: [], total: current.length };
    }

    const merged = Array.from(currentSet).sort();
    const value = JSON.stringify(merged);
    if (row) {
      await db.prepare(
        `UPDATE system_settings SET value=? WHERE key='webex_allowed_domains'`
      ).run(value);
    } else {
      await db.prepare(
        `INSERT INTO system_settings (key, value) VALUES ('webex_allowed_domains', ?)`
      ).run(value);
    }

    // 清本地快取，避免延遲 60 秒生效
    _domainCache = { at: 0, list: [] };

    console.log(`[Webex][DomainAutoScan] ✅ Added ${added.length} new domain(s): ${added.join(', ')}  (total=${merged.length})`);
    return { added, total: merged.length };
  } catch (e) {
    console.error('[Webex][DomainAutoScan] error:', e.message);
    return { added: [], total: 0, error: e.message };
  }
}

module.exports = router;
module.exports.handleWebexMessage = handleWebexMessage;
module.exports.autoScanUserDomains = autoScanUserDomains;
