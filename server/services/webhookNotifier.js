/**
 * Webhook Notifier — LINE Notify & Microsoft Teams
 */

async function sendWebhook(url, type, message, severity) {
  if (!url) return false;

  try {
    if (type === 'line') {
      // LINE Notify
      const res = await fetch('https://notify-api.line.me/api/notify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${url}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ message: `\n[${severity}] ${message}` }),
      });
      if (!res.ok) console.warn('[Webhook] LINE Notify error:', res.status, await res.text());
      return res.ok;
    } else {
      // Microsoft Teams Incoming Webhook (MessageCard)
      const colorMap = { warning: 'FFA500', critical: 'FF0000', emergency: 'FF0000' };
      const body = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: colorMap[severity] || 'FF0000',
        summary: `[FOXLINK GPT] ${severity.toUpperCase()} Alert`,
        sections: [{
          activityTitle: `[FOXLINK GPT] ${severity.toUpperCase()} Alert`,
          text: message,
          markdown: true,
        }],
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) console.warn('[Webhook] Teams error:', res.status, await res.text());
      return res.ok;
    }
  } catch (e) {
    console.error('[Webhook] sendWebhook error:', e.message);
    return false;
  }
}

/**
 * Send alert through all configured channels (email + webhook)
 */
async function notifyAlert({ db, alertType, severity, resourceName, message }) {
  // 1. Write to monitor_alerts
  await db.prepare(
    `INSERT INTO monitor_alerts (alert_type, severity, resource_name, message) VALUES (?,?,?,?)`
  ).run(alertType, severity, resourceName, message);

  // 2. Email for critical/emergency
  if (severity === 'critical' || severity === 'emergency') {
    try {
      const { sendMail } = require('./mailService');
      // Get all admin emails
      const admins = await db.prepare(
        `SELECT email FROM users WHERE role='admin' AND status='active' AND email IS NOT NULL`
      ).all();
      const adminEmails = admins.map(a => a.email).filter(Boolean);
      if (adminEmails.length > 0) {
        const severityLabel = severity === 'emergency' ? '🔴 EMERGENCY' : '🟠 CRITICAL';
        await sendMail({
          to: adminEmails.join(','),
          subject: `[FOXLINK GPT Monitor] ${severityLabel} - ${alertType}`,
          html: `
            <h3>${severityLabel} Alert</h3>
            <p><b>Type:</b> ${alertType}</p>
            <p><b>Resource:</b> ${resourceName}</p>
            <p><b>Message:</b> ${message}</p>
            <p><b>Time:</b> ${new Date().toISOString()}</p>
          `,
        });
      }
    } catch (e) {
      console.error('[Webhook] Email notification error:', e.message);
    }
  }

  // 3. Webhook for critical (if enabled) / emergency (forced)
  if (severity === 'critical' || severity === 'emergency') {
    try {
      const webhookEnabled = await db.prepare(
        `SELECT value FROM system_settings WHERE key='monitor_alert_webhook_enabled'`
      ).get();
      const webhookUrl = await db.prepare(
        `SELECT value FROM system_settings WHERE key='monitor_alert_webhook_url'`
      ).get();
      const webhookType = await db.prepare(
        `SELECT value FROM system_settings WHERE key='monitor_alert_webhook_type'`
      ).get();

      const shouldSend = severity === 'emergency' || webhookEnabled?.value === 'true';
      if (shouldSend && webhookUrl?.value) {
        await sendWebhook(webhookUrl.value, webhookType?.value || 'teams', message, severity);
      }
    } catch (e) {
      console.error('[Webhook] Webhook notification error:', e.message);
    }
  }
}

/**
 * Check cooldown — returns true if we should skip notification
 */
async function isInCooldown(db, alertType, resourceName, cooldownMinutes = 30) {
  const row = await db.prepare(
    `SELECT notified_at FROM monitor_alerts
     WHERE alert_type = ? AND resource_name = ? AND resolved_at IS NULL
     ORDER BY notified_at DESC FETCH FIRST 1 ROW ONLY`
  ).get(alertType, resourceName);

  if (!row) return false;

  const lastNotified = new Date(row.notified_at);
  const now = new Date();
  const diffMin = (now - lastNotified) / 60000;
  return diffMin < cooldownMinutes;
}

module.exports = { sendWebhook, notifyAlert, isInCooldown };
