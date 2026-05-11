#!/bin/bash
# 從外網用 curl 模擬 Webex webhook POST,觸發 WAF 阻擋並抓取 Akamai Reference #
# 用途:給 WAF admin 提供具體 reference number 查 Akamai console 找擋下的規則
#
# 使用方式(從外網執行,不能在公司內網 — 內網直連 K8s 不過 WAF):
#   bash server/scripts/probe-waf-webhook.sh
#
# 預期:WAF 回 HTTP 403 + HTML body 含 "Reference #18.xxxx.xxxx.xxxx",
#       腳本自動 grep 出來顯示
#
# 如果回 200 / 後端 log 看到請求 → WAF 已通,Webex 不通是別的問題
set -euo pipefail

URL="${1:-https://flgpt.foxlink.com.tw/api/webex/webhook}"
OUT="$(mktemp -t waf-probe-XXXXXX.txt)"

echo "[probe] POST $URL"
echo "[probe] 從外網(家裡 / 4G)執行才有意義 — 內網直連 K8s 不過 WAF"
echo ""

# UA 預設模擬 Webex 雲端真實 UA(更準確還原 Webex 被擋的情境)
# 想用 curl 預設 UA 跑通透測試,傳 1 個參數:bash probe.sh "" "curl/8.0"
UA="${2:-Mozilla/5.0 (compatible; CiscoSparkBot)}"

# 假 webhook payload(內容無所謂,只是要觸發 POST + JSON)
BODY='{"id":"test-probe","name":"waf_probe","resource":"messages","event":"created","data":{"id":"x","personEmail":"probe@example.com"}}'

curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Spark-Signature: abc123fakeprobehash" \
  -H "User-Agent: $UA" \
  -d "$BODY" \
  -i > "$OUT" 2>&1 || true

echo "=== HTTP response head ==="
head -5 "$OUT"
echo ""

# Akamai 有時把 Reference # HTML-encode 成 Reference&#32;&#35; — 先 decode 再 grep
DECODED=$(sed -e 's/&#46;/./g' -e 's/&#32;/ /g' -e 's/&#35;/#/g' "$OUT")
REF=$(echo "$DECODED" | grep -oE "Reference #[0-9a-f.]+" | head -1 || true)
if [ -n "$REF" ]; then
  echo "=== WAF 擋下 ✗  Reference 已抓到 ==="
  echo "$REF"
  echo ""
  echo "[probe] 把上面這串 Reference 給 WAF admin 查 Akamai console"
  echo "[probe] 完整 response 在: $OUT"
else
  STATUS=$(head -1 "$OUT" | awk '{print $2}')
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "401" ] || [ "$STATUS" = "400" ]; then
    echo "=== WAF 通過 ✓  HTTP $STATUS — 後端有收到請求 ==="
    echo "[probe] WAF 設定 OK,問題不在 WAF,改查 K8s ingress / app log"
  else
    echo "=== HTTP $STATUS 但沒抓到 Akamai Reference ==="
    echo "[probe] 完整 response 在: $OUT,手動檢查"
  fi
fi
