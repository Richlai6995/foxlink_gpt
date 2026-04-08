# FOXLINK GPT — Webex Webhook 防火牆設定

> 讓 Webex Cloud 能將 webhook 事件推送到 FOXLINK GPT K8s 叢集。

---

## 網路架構

```
K8s 叢集：
  Management node:  10.8.93.11
  Worker nodes:     10.8.93.12~14
  VIP:              10.8.93.10
  Ingress LB IP:    10.8.93.20 (port 80=HTTP, 8443=HTTPS)
```

## 架構圖

```
使用者在 Webex 傳訊息
        │
        ▼
  Webex Cloud
        │  HTTPS POST /api/webex/webhook
        ▼
  ┌─────────────────────────────────────────────┐
  │  公網 IP:8443（防火牆 NAT）                  │
  │  60.244.105.118:8443（或其他可用 IP:port）    │
  └──────────────┬──────────────────────────────┘
                 │  NAT → 10.8.93.20:8443
                 ▼
  ┌─────────────────────────────────────────────┐
  │  K8s Ingress Controller (nginx)             │
  │  IP: 10.8.93.20  Port: 8443 (HTTPS/TLS)    │
  │                                             │
  │  Host: flgpt.foxlink.com.tw                 │
  │  TLS:  K8s Secret (flgpt-tls)              │
  │  Path: / → foxlink-gpt:3007                │
  └──────────────┬──────────────────────────────┘
                 │
                 ▼
  foxlink-gpt Pod (port 3007)
  處理 webhook → 呼叫 Gemini AI → 回覆 Webex
```

---

## 網管需要做的事（1 件）

### 新增防火牆 NAT 規則

| 方向 | 來源 | 目的地 | Port | 說明 |
|------|------|--------|------|------|
| **入站** | Webex Cloud（任意 IP） | 60.244.105.118（或可用公網 IP） | **8443/TCP** | Webex webhook 回呼 |

**NAT 轉發**：

```
公網 IP:8443  →  10.8.93.20:8443
```

> - `10.8.93.20` 是 K8s Ingress Controller 的 LoadBalancer IP
> - port 8443 是 Ingress Controller 的 HTTPS port（TLS 由 K8s 處理）
> - 如果 8443 已被其他服務佔用，可改用其他 port（如 8444），我們會同步調整

### 出站規則（如尚未開通）

| 方向 | 來源 | 目的地 | Port | 說明 |
|------|------|--------|------|------|
| 出站 | 10.8.93.11~14 | webexapis.com / api.ciscospark.com | 443/TCP | Bot 回覆訊息給 Webex |
| 出站 | 10.8.93.11~14 | generativelanguage.googleapis.com | 443/TCP | 呼叫 Gemini AI |

---

## 不需要額外做的事

| 項目 | 原因 |
|------|------|
| Nginx / 反向代理 | K8s Ingress Controller 已處理 |
| SSL 憑證安裝 | K8s 內部管理（TLS Secret） |
| 路徑限制 | K8s Ingress 只暴露指定 host 的路徑 |

---

## 安全說明

| 層 | 防護 |
|----|------|
| 網路層 | 防火牆只開 8443 port，NAT 到 K8s Ingress |
| 傳輸層 | TLS 加密（K8s Ingress Controller 終止） |
| 應用層 | HMAC-SHA1 簽名驗證（WEBEX_WEBHOOK_SECRET） |
| 邏輯層 | 收到 webhook 後用 Bot Token 向 Webex API 驗證訊息真實性 |

---

## 驗證步驟

### 1. NAT 設定好後，從外網測試

```bash
curl -k -X POST https://60.244.105.118:8443/api/webex/webhook \
  -H "Content-Type: application/json" \
  -H "Host: flgpt.foxlink.com.tw" \
  -d '{"resource":"messages","event":"test","data":{}}'
```

預期回應：`200 OK`

### 2. 從 K8s server 測試

```bash
# 用工具測試
cd ~/foxlink_gpt && node server/scripts/registerWebhook.js --test

# 註冊 webhook 到 Webex
node server/scripts/registerWebhook.js

# 列出已註冊 webhook
node server/scripts/registerWebhook.js --list
```

### 3. 實際測試

在 Webex 傳「?」給 Bot，檢查 pod log：

```bash
kubectl logs -n foxlink -l app=foxlink-gpt --tail=20 -f
```

應該看到：
```
[Webex] Webhook received: ip=... hasRawBody=true hasSignature=true
[Webex] ✅ Signature verified
```

---

## Fallback（不通時切回 polling）

如果防火牆設定有困難，可以立即切回 polling 模式（不需要任何防火牆改動）：

修改 K8s Secret 中的環境變數：

```bash
# 編輯 secret
kubectl edit secret foxlink-secrets -n foxlink
# 將 WEBEX_MODE 改為 polling，WEBEX_POLLING_ENABLED 改為 true

# 或重建 secret
kubectl delete secret foxlink-secrets -n foxlink
kubectl create secret generic foxlink-secrets -n foxlink --from-env-file=server/.env
kubectl rollout restart deployment foxlink-gpt -n foxlink
```

回應速度約 10~15 秒（比 webhook 慢但可用）。
