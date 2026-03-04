require('dotenv').config();
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_SERVER;
  const port = parseInt(process.env.SMTP_PORT || '25');
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;

  if (!host) return null;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
    tls: { rejectUnauthorized: false },
  });
  return transporter;
}

// Reset transporter when settings change
function resetTransporter() {
  transporter = null;
}

/**
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {Array<{filename:string, path:string}>} [opts.attachments]
 */
async function sendMail({ to, subject, html, text, attachments }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[Mail] No SMTP config, skipping email');
    return false;
  }

  const fromAddr = process.env.FROM_ADDRESS || 'noreply@foxlink.com';

  try {
    await t.sendMail({ from: fromAddr, to, subject, html, text, attachments });
    return true;
  } catch (e) {
    console.error('[Mail] Send error:', e.message);
    return false;
  }
}

async function notifyAdminSensitiveKeyword({ user, content, keywords, sessionId }) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.FROM_ADDRESS;
  if (!adminEmail) return;

  const subject = `[FOXLINK GPT] 敏感詞彙警示 - 使用者: ${user.name || user.username}`;
  const html = `
    <h3>偵測到敏感詞彙</h3>
    <p><strong>使用者:</strong> ${user.name || user.username} (${user.username})</p>
    <p><strong>工號:</strong> ${user.employee_id || 'N/A'}</p>
    <p><strong>Session ID:</strong> ${sessionId}</p>
    <p><strong>敏感詞:</strong> ${keywords.join(', ')}</p>
    <p><strong>訊息內容:</strong></p>
    <blockquote style="border-left:3px solid red;padding-left:10px;">${content}</blockquote>
    <p><small>時間: ${new Date().toLocaleString('zh-TW')}</small></p>
  `;

  await sendMail({ to: adminEmail, subject, html });
}

module.exports = { sendMail, notifyAdminSensitiveKeyword, resetTransporter };
