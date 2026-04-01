# Gmail API 整合設計 — 收信 + 附件處理

> 狀態：規劃中（尚未實作）

## 目標

透過 Google Workspace (GWS) Gmail API，在內網 GPT Server 讀取使用者 Gmail 信件及附件，進行後續 AI 處理。

---

## 架構概述

```
Google Gmail API (googleapis.com:443)
        ↑
   Service Account (Domain-Wide Delegation)
   一把 JSON key 代理所有使用者信箱
        ↑
   GPT Server (內網)
   根據登入使用者 email 讀取對應信箱
```

---

## 前置條件

### 1. 網路連通性

Server 必須能連到 `gmail.googleapis.com:443`。

```bash
# 測試連通
curl -I https://gmail.googleapis.com
```

- 能通 → 直接使用
- 不能通 → 需透過 HTTP Proxy 或 DMZ 中繼

若需 Proxy：

```env
# .env
HTTPS_PROXY=http://proxy.foxlink.com:8080
```

### 2. GWS Admin 設定（一次性）

| 步驟 | 操作 |
|------|------|
| 1 | GCP Console → 建立 Service Account |
| 2 | 下載 JSON key 檔案 |
| 3 | 記錄 Service Account 的 **Client ID**（純數字） |
| 4 | GWS Admin Console → Security → API Controls → Domain-Wide Delegation |
| 5 | 新增 Client ID，Scope 填 `https://www.googleapis.com/auth/gmail.readonly` |

> Scope 僅開 `gmail.readonly`（唯讀），最小權限原則。
> Admin 可用 OU (Organizational Unit) 限縮可代理的信箱範圍。

### 3. Server 端安裝

```bash
cd server
npm install googleapis
```

---

## 核心設計

### Service Account 代理模式

一把 JSON key 可代理 domain 內所有使用者信箱，透過 `subject` 參數切換：

```js
const { google } = require('googleapis');

function getGmailClient(userEmail) {
  const auth = new google.auth.JWT({
    keyFile: path.join(__dirname, '../config/gmail-service-account.json'),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    subject: userEmail, // 代理的目標信箱
  });
  return google.gmail({ version: 'v1', auth });
}
```

### 若需 Proxy

```js
const { HttpsProxyAgent } = require('https-proxy-agent');

function getGmailClient(userEmail) {
  const agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
  const auth = new google.auth.JWT({
    keyFile: path.join(__dirname, '../config/gmail-service-account.json'),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    subject: userEmail,
  });
  auth.transporter = { defaults: { httpAgent: agent, httpsAgent: agent } };
  return google.gmail({ version: 'v1', auth });
}
```

---

## API 功能

### 列出信件

```js
async function listMessages(userEmail, query = 'is:unread', maxResults = 20) {
  const gmail = getGmailClient(userEmail);
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,        // Gmail 搜尋語法
    maxResults,
  });
  return res.data.messages || [];
}
```

常用 query 範例：
- `is:unread` — 未讀
- `from:someone@example.com` — 特定寄件者
- `has:attachment` — 有附件
- `after:2026/03/01 before:2026/04/01` — 日期範圍
- `subject:報價單` — 主旨含關鍵字

### 讀取信件內容

```js
async function getMessage(userEmail, messageId) {
  const gmail = getGmailClient(userEmail);
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full', // full | metadata | minimal
  });

  const headers = res.data.payload.headers;
  const subject = headers.find(h => h.name === 'Subject')?.value;
  const from = headers.find(h => h.name === 'From')?.value;
  const date = headers.find(h => h.name === 'Date')?.value;
  const body = extractBody(res.data.payload);
  const attachments = extractAttachmentInfo(res.data.payload);

  return { subject, from, date, body, attachments };
}
```

### 下載附件

```js
async function getAttachment(userEmail, messageId, attachmentId) {
  const gmail = getGmailClient(userEmail);
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  // data.data 是 URL-safe base64
  return Buffer.from(res.data.data, 'base64');
}
```

### 解析信件 Body（遞迴處理 multipart）

```js
function extractBody(payload) {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    // 優先取 text/html，其次 text/plain
    const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
    const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
    const target = htmlPart || textPart;
    if (target) return extractBody(target);
    // multipart 嵌套
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result) return result;
    }
  }
  return '';
}
```

### 提取附件資訊

```js
function extractAttachmentInfo(payload, attachments = []) {
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
          attachmentId: part.body.attachmentId,
        });
      }
      extractAttachmentInfo(part, attachments);
    }
  }
  return attachments;
}
```

---

## API 路由設計

```
GET  /api/gmail/messages?q=is:unread&max=20   列出信件
GET  /api/gmail/messages/:id                   讀取信件內容
GET  /api/gmail/messages/:id/attachments/:aid  下載附件
POST /api/gmail/messages/:id/process           將信件+附件送入 AI 處理
```

### 路由範例

```js
// routes/gmail.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const gmailService = require('../services/gmailService');

// 使用者的 email 從 DB users 表取得
router.get('/messages', verifyToken, async (req, res) => {
  const userEmail = req.user.email; // users 表需有 email 欄位
  const { q = 'is:unread', max = 20 } = req.query;
  const messages = await gmailService.listMessages(userEmail, q, Number(max));
  res.json({ success: true, data: messages });
});

router.get('/messages/:id', verifyToken, async (req, res) => {
  const userEmail = req.user.email;
  const message = await gmailService.getMessage(userEmail, req.params.id);
  res.json({ success: true, data: message });
});

router.get('/messages/:id/attachments/:aid', verifyToken, async (req, res) => {
  const userEmail = req.user.email;
  const buffer = await gmailService.getAttachment(userEmail, req.params.id, req.params.aid);
  res.setHeader('Content-Disposition', `attachment; filename="${req.query.filename || 'download'}"`);
  res.send(buffer);
});

// 將信件內容+附件送入現有 AI chat 處理
router.post('/messages/:id/process', verifyToken, async (req, res) => {
  const userEmail = req.user.email;
  const message = await gmailService.getMessage(userEmail, req.params.id);
  // 下載所有附件
  const files = [];
  for (const att of message.attachments) {
    const buffer = await gmailService.getAttachment(userEmail, req.params.id, att.attachmentId);
    files.push({ filename: att.filename, mimeType: att.mimeType, buffer });
  }
  // 組合成 AI prompt 或轉交現有 chat service
  // ...
  res.json({ success: true });
});
```

---

## 前端整合方向

在 AI Chat 介面新增「匯入 Gmail」按鈕：

1. 開啟 modal → 呼叫 `GET /api/gmail/messages` 列出信件
2. 使用者勾選要處理的信件
3. 呼叫 `POST /api/gmail/messages/:id/process`
4. 信件內容 + 附件自動注入當前 chat session

---

## 安全考量

| 項目 | 措施 |
|------|------|
| JSON Key 保管 | 放 `server/config/`，加入 `.gitignore`，**絕不進 git** |
| 權限最小化 | Scope 僅 `gmail.readonly` |
| 存取控制 | 僅登入使用者可讀自己的信箱（用 `req.user.email`） |
| 信箱範圍限縮 | GWS Admin 可用 OU 限制 delegation 範圍 |
| 附件大小限制 | 前端/後端設上限（建議 25MB，Gmail 附件上限） |
| 敏感內容 | 信件內容經 AI 處理前，可過現有敏感用語稽核 |

---

## .env 新增設定

```env
# Gmail API
GMAIL_SERVICE_ACCOUNT_KEY=config/gmail-service-account.json
GMAIL_ENABLED=false        # 開關，預設關閉
HTTPS_PROXY=               # 若需 proxy 填入
```

---

## 檔案結構（預計）

```
server/
├── config/
│   └── gmail-service-account.json   # GWS Service Account key（不進 git）
├── services/
│   └── gmailService.js              # Gmail API 封裝
├── routes/
│   └── gmail.js                     # API 路由
client/src/
├── components/
│   └── GmailImport.tsx              # Gmail 匯入 modal
```

---

## 斷外網替代方案

若 Server 完全無法連到 `googleapis.com`：

1. **DMZ 中繼**：在 DMZ 放一台可連外的 relay server，定時拉信存到內網共享目錄
2. **Google Apps Script**：在 GWS 端寫 Apps Script，定時將信件+附件推到內網 API endpoint（需內網有對外開放的入口）
3. **Power Automate**：用 Microsoft Power Automate 串 Gmail connector，轉存到 SharePoint/網路磁碟

---

## 實作優先順序

1. 確認網路連通性（`curl https://gmail.googleapis.com`）
2. 請 GWS Admin 建 Service Account + Domain-Wide Delegation
3. 實作 `gmailService.js`
4. 實作 `routes/gmail.js`
5. 前端 `GmailImport.tsx` 整合進 AI Chat
6. 測試 + 敏感用語稽核整合
