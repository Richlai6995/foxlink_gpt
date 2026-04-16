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
    this._botDisplayName = null;

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

  /** 取得 Bot displayName（快取，只呼叫一次 API） */
  async getBotDisplayName() {
    if (this._botDisplayName) return this._botDisplayName;
    try {
      const res = await this.client.get('/people/me');
      this._botDisplayName = res.data.displayName || 'Cortex';
    } catch {
      this._botDisplayName = 'Cortex';
    }
    return this._botDisplayName;
  }

  /** 取得完整 message 物件（webhook 只傳 ID） */
  async getMessage(messageId) {
    const res = await this.client.get(`/messages/${messageId}`);
    return res.data;
  }

  /** 傳送純文字訊息，回傳 message id */
  async sendMessage(roomId, text, { markdown, parentId } = {}) {
    const payload = { roomId };
    if (markdown) {
      payload.markdown = markdown;
    } else {
      payload.text = text;
    }
    if (parentId) payload.parentId = parentId;
    const res = await this.client.post('/messages', payload);
    return res.data?.id || null;
  }

  /**
   * DM 給指定使用者（by email）。Webex 自動建立 1-on-1 direct room，
   * 不需預先 create。parentId 帶入可串 thread。
   * @returns {string|null} message id（可存為 thread parent）
   */
  async sendDirectMessage(toPersonEmail, markdown, { parentId } = {}) {
    if (!toPersonEmail) return null;
    try {
      const payload = { toPersonEmail, markdown };
      if (parentId) payload.parentId = parentId;
      const res = await this.client.post('/messages', payload);
      return res.data?.id || null;
    } catch (e) {
      // parentId 指向對方看不到的 room → Webex 400；fallback 不帶 parentId 重送
      if (parentId && e.response?.status === 400) {
        try {
          const res = await this.client.post('/messages', { toPersonEmail, markdown });
          return res.data?.id || null;
        } catch (e2) {
          console.warn(`[Webex] sendDirectMessage ${toPersonEmail} retry failed: ${e2.response?.status || e2.message}`);
          return null;
        }
      }
      console.warn(`[Webex] sendDirectMessage ${toPersonEmail}: ${e.response?.status || e.message}`);
      return null;
    }
  }

  /** 編輯訊息（用於將 typing indicator 更新為實際回覆） */
  async editMessage(messageId, text, { markdown } = {}) {
    try {
      const payload = {};
      if (markdown) {
        payload.markdown = markdown;
      }
      payload.text = text;
      await this.client.put(`/messages/${messageId}`, payload);
      return true;
    } catch (e) {
      console.warn(`[Webex] editMessage failed (${e.response?.status || e.message}), will fallback to new message`);
      return false;
    }
  }

  /** 建立群組 Room */
  async createRoom(title) {
    const res = await this.client.post('/rooms', { title });
    return res.data;
  }

  /** 加成員到 Room (by email) */
  async addRoomMember(roomId, personEmail, isModerator = false) {
    try {
      await this.client.post('/memberships', { roomId, personEmail, isModerator });
      return true;
    } catch (e) {
      // 409 = 已是成員
      if (e.response?.status === 409) return true;
      console.warn(`[Webex] addRoomMember ${personEmail}: ${e.response?.status || e.message}`);
      return false;
    }
  }

  /** 列出 Room 成員 */
  async listRoomMembers(roomId) {
    const res = await this.client.get('/memberships', { params: { roomId, max: 200 } });
    return res.data?.items || [];
  }

  /** 刪除訊息（用於撤回 typing indicator） */
  async deleteMessage(messageId) {
    try {
      await this.client.delete(`/messages/${messageId}`);
    } catch (e) {
      // 刪除失敗不影響主流程
    }
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
