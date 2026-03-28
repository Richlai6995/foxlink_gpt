'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const WEBEX_API = 'https://webexapis.com/v1';

class WebexService {
  constructor(token) {
    this.token = token;
    this._botPersonId = null;

    this.client = axios.create({
      baseURL: WEBEX_API,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /** 取得 Bot 自身 personId（快取） */
  async getBotPersonId() {
    if (this._botPersonId) return this._botPersonId;
    const res = await this.client.get('/people/me');
    this._botPersonId = res.data.id;
    return this._botPersonId;
  }

  /** 取得完整 message 物件（webhook 只傳 ID） */
  async getMessage(messageId) {
    const res = await this.client.get(`/messages/${messageId}`);
    return res.data;
  }

  /** 傳送純文字訊息 */
  async sendMessage(roomId, text, { markdown, parentId } = {}) {
    const payload = { roomId };
    if (markdown) {
      payload.markdown = markdown;
    } else {
      payload.text = text;
    }
    if (parentId) payload.parentId = parentId;
    await this.client.post('/messages', payload);
  }

  /** 傳送含本地附件的訊息 */
  async sendFile(roomId, text, localFilePath) {
    const form = new FormData();
    form.append('roomId', roomId);
    form.append('text', text || '');
    form.append('files', fs.createReadStream(localFilePath), {
      filename: path.basename(localFilePath),
    });

    await axios.post(`${WEBEX_API}/messages`, form, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...form.getHeaders(),
      },
      timeout: 60000,
      maxContentLength: 110 * 1024 * 1024,
    });
  }

  /**
   * 從 Webex 下載附件到本地路徑
   * @returns {{ filename: string, mimeType: string }}
   */
  async downloadFile(fileUrl, destPath) {
    const res = await axios.get(fileUrl, {
      headers: { Authorization: `Bearer ${this.token}` },
      responseType: 'stream',
      timeout: 60000,
    });

    // 解析 content-disposition 取得原始檔名
    const cd = res.headers['content-disposition'] || '';
    const fnMatch = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
    let filename = fnMatch ? fnMatch[1].replace(/['"]/g, '') : path.basename(destPath);
    filename = decodeURIComponent(filename);

    const mimeType = res.headers['content-type']?.split(';')[0]?.trim() || 'application/octet-stream';

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath);
      res.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    return { filename, mimeType };
  }

  /** 列出 webhooks */
  async listWebhooks() {
    const res = await this.client.get('/webhooks');
    return res.data.items || [];
  }

  /** 刪除 webhook */
  async deleteWebhook(webhookId) {
    await this.client.delete(`/webhooks/${webhookId}`);
  }

  /** 建立 webhook */
  async createWebhook({ name, targetUrl, resource, event, secret }) {
    const res = await this.client.post('/webhooks', {
      name,
      targetUrl,
      resource,
      event,
      secret,
    });
    return res.data;
  }
}

// 單例
let _instance = null;
function getWebexService() {
  if (!_instance) {
    const token = process.env.WEBEX_BOT_TOKEN;
    if (!token) throw new Error('WEBEX_BOT_TOKEN not configured');
    _instance = new WebexService(token);
  }
  return _instance;
}

module.exports = { WebexService, getWebexService };
