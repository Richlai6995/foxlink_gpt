# FOXLINK GPT — Webex Webhook 防火牆與 Nginx 設定

> 請網管協助設定，讓 Webex Cloud 能將 webhook 事件推送到 FOXLINK GPT 服務。

---

## 架構圖

```
使用者在 Webex 傳訊息
        │
        ▼
  Webex Cloud
        │  HTTPS POST
        │  目標：https://fl-lite-em.foxlink.com.tw:8443/api/webex/webhook-gpt
        ▼
  ┌─────────────────────────────────────────────┐
  │  60.244.105.118:8443  （公網 IP）            │
  │  公司防火牆／NAT（已開通）                    │
  └──────────────┬──────────────────────────────┘
                 │  Port Forward 8443 → 內網（已存在）
                 ▼
  ┌─────────────────────────────────────────────┐
  │  10.8.93.10:8443  Nginx                     │
  │                                             │
  │  /api/webex/webhook      → oracle-monitor   │  ← 已存在
  │  /api/webex/webhook-gpt  → FOXLINK GPT K8s  │  ← 新增這條
  │  /                       → 只允許內網        │  ← 不動
  └──────────────┬──────────────────────────────┘
                 │
                 ▼
  10.8.93.11:30007  FOXLINK GPT（K8s NodePort）
```

---

## 網管需要做的事（共 1 件）

### 在 Nginx（10.8.93.10）加一個 location block

在現有的 `fl-lite-em.foxlink.com.tw` server block 中，加入以下內容：

```nginx
# ─── FOXLINK GPT Webex Webhook（新增）───────────────────
# Webex Cloud 推送訊息事件到此路徑，轉發到 K8s 服務
location /api/webex/webhook-gpt {
    proxy_pass         http://10.8.93.11:30007/api/webex/webhook;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;

    # 不限制 request body 大小（Webex webhook payload 通常 < 1KB）
    client_max_body_size 1m;
}
```

> **注意**：`10.8.93.11:30007` 是 K8s 的 NodePort。如果用 Ingress IP 或 ClusterIP + LoadBalancer，請替換為實際地址。

### 確認完畢後 reload Nginx

```bash
sudo nginx -t && sudo nginx -s reload
```

---

## 不需要額外做的事

| 項目 | 原因 |
|------|------|
| 防火牆 inbound 規則 | 已存在（60.244.105.118:8443 對 Webex Cloud 已開通） |
| 防火牆 outbound 規則 | 已存在（10.8.93.10 → webexapis.com:443 已開通） |
| Port Forward | 已存在（8443 → 10.8.93.10:8443） |
| SSL 憑證 | 已存在（fl-lite-em.foxlink.com.tw 的憑證） |
| DNS | 不需要新增（共用 fl-lite-em.foxlink.com.tw） |

---

## 安全說明

| 層 | 防護 |
|----|------|
| 路徑層 | Nginx 只開放 `/api/webex/webhook-gpt`，其他路徑只允許內網 |
| 應用層 | HMAC-SHA1 簽名驗證（`WEBEX_WEBHOOK_SECRET`） |
| 邏輯層 | 收到 webhook 後用 Bot Token 向 Webex API 取完整訊息，假 payload 無法偽造 |

---

## 驗證步驟

### Step 1：確認 Nginx 可達

從 K8s node 或任意內網機器：

```bash
curl -k -X POST https://fl-lite-em.foxlink.com.tw:8443/api/webex/webhook-gpt \
  -H "Content-Type: application/json" \
  -d '{"resource":"messages","event":"test","data":{}}'
```

預期回應：`200 OK`（即使 signature 不對，server 會先回 200）

### Step 2：從外部測試

在有外網的機器或手機熱點：

```bash
curl -k -X POST https://60.244.105.118:8443/api/webex/webhook-gpt \
  -H "Content-Type: application/json" \
  -d '{"resource":"messages","event":"test","data":{}}'
```

或使用我們提供的工具：

```bash
cd server && node scripts/registerWebhook.js --test
```

### Step 3：註冊 Webhook 到 Webex

```bash
cd server && node scripts/registerWebhook.js
```

### Step 4：實際測試

在 Webex 傳送「?」給 Bot，檢查 server log 是否出現：

```
[Webex] Webhook received: ip=... hasRawBody=true hasSignature=true
[Webex] ✅ Signature verified
```

---

## 如果不通的 Fallback

如果 webhook 無法設定成功，可以切回 polling 模式（不需要任何防火牆改動）：

```env
# server/.env
WEBEX_MODE=polling
WEBEX_POLLING_ENABLED=true
```

重啟 server 即可，回應速度約 10~15 秒（比 webhook 慢但可用）。

---

## 環境變數對照表

| Key | 值 | 說明 |
|-----|-----|------|
| `WEBEX_MODE` | `webhook` | webhook / websocket / polling |
| `WEBEX_PUBLIC_URL` | `https://fl-lite-em.foxlink.com.tw:8443` | Nginx 對外 URL |
| `WEBEX_WEBHOOK_PATH` | `/api/webex/webhook-gpt` | Nginx 轉發路徑 |
| `WEBEX_WEBHOOK_SECRET` | `（已設定）` | HMAC 簽名密鑰 |
| `WEBEX_POLLING_ENABLED` | `false` | webhook 模式下關閉 polling |
