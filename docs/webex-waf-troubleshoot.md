# Webex Webhook 被 WAF 擋下的排查 SOP

> 對象:Cortex / Foxlink GPT 維運。當 Webex Bot 「彷彿沒收到訊息」但內網看 webhook URL 有開、後端 K8s pod log 沒紀錄時,大概率是 Akamai WAF 在外層擋下。
> 最後更新:2026-05-11

## 1. 確認問題在 WAF 還是後端

Webex 雲端走外網 → Akamai WAF(`flgpt.foxlink.com.tw` 443)→ K8s ingress → app。三段任一不通都會「Bot 沒反應」。

| 現象 | 可能位置 |
|------|---------|
| 從外網 curl POST `https://flgpt.foxlink.com.tw/api/webex/webhook` 回 403 + HTML `Reference #...` | **Akamai WAF 擋下**(本文重點) |
| 從外網 curl 回 200 / 401 / 400,但 Webex 仍沒反應 | 後端 / app 層問題,不在 WAF |
| 內網直連 K8s(`10.8.93.20`)POST 通,但外網 curl 403 | 一定是 WAF |
| 內網外網都 503 / 502 | K8s ingress 或 app 掛了,跟 WAF 無關 |

## 2. 抓 Akamai Reference Number(必備證據)

WAF admin 沒有 Reference # 無法在 Akamai console 反查具體擋下的規則。Reference 在 Akamai 回的 403 HTML 內,格式 `Reference #18.xxxxxxxx.xxxxxxxxxx.xxxxxxx`。

### 自動抓 — 用 probe 腳本

從**外網**(家裡 / 4G 熱點 / 手機開熱點)執行:

```bash
bash server/scripts/probe-waf-webhook.sh
```

腳本會發 POST 模擬 Webex webhook,自動 grep 出 Reference # 並顯示完整 response 暫存路徑。

### 手動抓 — 原始 curl

```bash
curl -sS -i -X POST https://flgpt.foxlink.com.tw/api/webex/webhook \
  -H "Content-Type: application/json" \
  -H "X-Spark-Signature: abc123fakehash" \
  -d '{"id":"test","resource":"messages","event":"created","data":{"id":"x","personEmail":"test@example.com"}}' \
  | tee /tmp/waf-reject.txt

grep -oE "Reference #[0-9a-f.]+" /tmp/waf-reject.txt
```

預期回:

```
HTTP/2 403
...
<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>
...
Reference #18.140985cb.1778248578.414e4bb     ← ★ 拿這串
</BODY></HTML>
```

### ⚠️ 內網跑沒意義

從內網跑會直接打到 K8s ingress(`10.8.93.20`)不經 WAF,**永遠不會** 403。Reference 只能從外網拿。

## 3. 發給 WAF Admin 的工單範本

照下面這個格式發,admin 拿到就能直接動手:

```
URL:    https://flgpt.foxlink.com.tw/api/webex/webhook
Method: POST
Body:   application/json (JSON payload, < 4KB)
Source: Cisco Webex 雲端(全球 CDN,IP 浮動)

WAF 拒絕證據:
  - 從外網 curl POST 此 URL 回 HTTP 403
  - Akamai Reference #18.xxxxxxxx.xxxxxxxxxx.xxxxxxx  ← ★ 必附

請設定:
  1. 路徑 /api/webex/webhook 的 POST 不套用 Bot Manager / Anti-Bot / OWASP CRS
     (Webex 雲端 POST 沒帶 cookie/referer/真實 UA,看起來像 bot)
  2. 不可剝以下 headers(後端 HMAC 驗簽用):
     - X-Spark-Signature
     - Content-Type: application/json
  3. Source IP 放行全部(Webex IP 全球 CDN,無法 allowlist)
  4. Body size limit 可保留(payload 一律 < 4KB)
```

## 4. WAF 修完後的驗證流程

從**外網**重跑 probe:

```bash
bash server/scripts/probe-waf-webhook.sh
```

| 預期結果 | 意義 |
|---------|------|
| HTTP 200 / 204 | ✅ WAF 過了,後端有收到並正常回 |
| HTTP 401 / 400 | ✅ WAF 過了,簽章 / payload 假所以後端拒,但 WAF 是通的 |
| HTTP 403 + Reference # | ❌ WAF 還在擋,拿新 Reference 回 admin 看是不是漏改規則 |

確認 WAF 通後,再從 Cortex 端用 admin 帳號:

1. 從 Cortex 對話框觸發 Webex Bot(例:用 webex bot 收件功能,或者請 admin 從 Webex 對 bot 發訊息)
2. K8s pod log 應該看到 `[Webex] webhook received: ...`(`kubectl logs -n foxlink -l app=foxlink-gpt --tail=50 -f`)
3. 對話 / 通知正常回到 Webex

## 5. 預防再次發生

- Akamai admin 端 **把 `/api/webex/webhook` 設成 永久 bypass 規則**,而非單次特例。避免下次規則更新又被誤殺
- **保留 8443 入口**:萬一 WAF 又出事(常見:Akamai 更新 Bot Manager 鏈),Webex webhook 可緊急切換 `WEBEX_PUBLIC_URL=https://flgpt.foxlink.com.tw:8443` 跳過 WAF
  - 切換步驟:改 `server/.env` + 重啟 server + 重跑 `node server/scripts/registerWebhook.js`(向 Webex 註冊新 webhook URL)
- 監控:Uptime Kuma 加一條從外部對 `/api/webex/webhook` POST 健檢,WAF 一擋立刻告警

## 6. 相關檔案

- 腳本:[server/scripts/probe-waf-webhook.sh](../server/scripts/probe-waf-webhook.sh) — 抓 Reference #
- 註冊 webhook:[server/scripts/registerWebhook.js](../server/scripts/registerWebhook.js) — Webex 那邊註冊接收方
- Webhook handler:`server/routes/webex.js` POST `/api/webex/webhook`
- ingress 規則:[k8s/ingress-webhook.yaml](../k8s/ingress-webhook.yaml) — K8s 層只接收 POST `/api/webex/webhook`
- 防火牆 / WAF 設定參考:[docs/webex-webhook-firewall-setup.md](webex-webhook-firewall-setup.md)

## 7. 常見坑 — 規則沒包全

### 7.1 OWASP bypass 不等於 Bot Manager bypass

Akamai 安全層分多層,**bypass OWASP CRS 不會自動 bypass Bot Manager**。常見症狀:

| 測試方式 | 結果 | 意思 |
|--|--|--|
| 從家用 IP curl(預設 UA `curl/8.x`)| 200 OK | OWASP 過了 |
| 從家用 IP curl + `User-Agent: ...CiscoSparkBot...` | **403 + Reference #** | Bot Manager 用 UA 擋下 |
| Webex 雲端真實流量 | 沒紀錄(silent drop) | UA + Cloud IP 雙因素都中 |

**驗證指令**(從外網跑兩次比對):

```bash
# 預設 UA — 通常會通
bash server/scripts/probe-waf-webhook.sh

# 模擬 Webex UA — 應該 403(2026-05-11 證實)
bash server/scripts/probe-waf-webhook.sh "" "Mozilla/5.0 (compatible; CiscoSparkBot)"
```

### 7.2 Reference # 被 HTML-encode 抓不到

Akamai 有時把 `Reference #` 在 HTML 內 encode 成 `Reference&#32;&#35;`,簡單 grep 抓不到。probe 腳本已更新(2026-05-11)先 sed decode 再 grep。手動檢查用:

```bash
sed -e 's/&#46;/./g' -e 's/&#32;/ /g' -e 's/&#35;/#/g' response.html | grep "Reference #"
```

## 8. 歷史紀錄

| 日期 | 事件 | Reference |
|------|------|----------|
| 2026-05-11 | 內網 443 上線後 Webex webhook 仍不通,確認 Akamai OWASP 擋 | `#18.140985cb.1778248578.414e4bb` |
| 2026-05-11 | OWASP bypass 後手動 curl 200 OK,**但 Webex 雲端仍進不來** → 證實 Bot Manager 對 `CiscoSparkBot` UA 過濾 | `#18.f7463af.1778490819.76a333a6` |
