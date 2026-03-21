#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FOXLINK GPT 壓力測試主控腳本
# 用法：./run.sh [選項]
#
# 選項：
#   --scenario  <名稱>   測試場景：chat | kb | dashboard | mcp | full（預設 chat）
#   --users     <數>     並發用戶數（預設 10）
#   --duration  <時間>   持續時間，例如 60s / 2m（預設 60s）
#   --url       <網址>   伺服器位址（預設 http://localhost:3001）
#   --username  <帳號>   測試帳號（預設 ADMIN）
#   --password  <密碼>   密碼（預設 123456）
#   --kb-id     <ID>     知識庫 ID（kb 場景必填）
#   --design-id <ID>     AI 戰情設計 ID（dashboard 場景必填）
#   --mcp-ids   <IDs>    MCP Server ID 逗號分隔（mcp 場景必填）
#   --report            產生 HTML 報告（需要 k6 reporter 外掛）
#   --watch-k8s         同時監控 k8s pod 資源（需要 kubectl）
#   -h, --help           顯示此說明
#
# 範例：
#   ./run.sh --scenario chat --users 20 --duration 2m
#   ./run.sh --scenario kb --users 30 --kb-id 5
#   ./run.sh --scenario dashboard --users 5 --design-id 2 --url http://10.0.0.5:3001
#   ./run.sh --scenario full --users 40 --kb-id 5 --design-id 2 --mcp-ids 1,2
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 預設值 ────────────────────────────────────────────────────────────────────
SCENARIO="chat"
VUS=10
DURATION="60s"
BASE_URL="http://localhost:3001"
USERNAME="ADMIN"
PASSWORD="123456"
KB_ID=""
DESIGN_ID=""
MCP_SERVER_IDS=""
SELF_KB_IDS=""
DO_REPORT=false
WATCH_K8S=false

# ── 參數解析 ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)   SCENARIO="$2";    shift 2 ;;
    --users)      VUS="$2";          shift 2 ;;
    --duration)   DURATION="$2";     shift 2 ;;
    --url)        BASE_URL="$2";     shift 2 ;;
    --username)   USERNAME="$2";     shift 2 ;;
    --password)   PASSWORD="$2";     shift 2 ;;
    --kb-id)      KB_ID="$2";        shift 2 ;;
    --design-id)  DESIGN_ID="$2";    shift 2 ;;
    --mcp-ids)    MCP_SERVER_IDS="$2"; shift 2 ;;
    --self-kb-ids) SELF_KB_IDS="$2"; shift 2 ;;
    --report)     DO_REPORT=true;    shift ;;
    --watch-k8s)  WATCH_K8S=true;    shift ;;
    -h|--help)
      sed -n '/^# ──/,/^# ──/p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0 ;;
    *) echo "未知參數: $1" >&2; exit 1 ;;
  esac
done

# ── 確認 k6 已安裝 ────────────────────────────────────────────────────────────
if ! command -v k6 &>/dev/null; then
  echo "❌ 找不到 k6，請先安裝："
  echo "   Linux:   sudo snap install k6  OR  brew install k6 (macOS)"
  echo "   Docker:  docker run --rm -i grafana/k6 run -"
  echo "   下載：   https://k6.io/docs/get-started/installation/"
  exit 1
fi

# ── 選擇場景腳本 ──────────────────────────────────────────────────────────────
case "$SCENARIO" in
  chat)      SCRIPT="$SCRIPT_DIR/scenarios/chat.js" ;;
  kb)        SCRIPT="$SCRIPT_DIR/scenarios/kb_search.js" ;;
  dashboard) SCRIPT="$SCRIPT_DIR/scenarios/dashboard.js" ;;
  mcp)       SCRIPT="$SCRIPT_DIR/scenarios/mcp.js" ;;
  full)      SCRIPT="$SCRIPT_DIR/scenarios/full.js" ;;
  *)
    echo "❌ 未知場景: $SCENARIO（可用：chat | kb | dashboard | mcp | full）"
    exit 1 ;;
esac

# ── 場景特定必填檢查 ───────────────────────────────────────────────────────────
if [[ "$SCENARIO" == "kb" && -z "$KB_ID" ]]; then
  echo "⚠️  kb 場景需要 --kb-id，嘗試使用 KB_ID=1（請確認此 ID 存在）"
  KB_ID="1"
fi
if [[ "$SCENARIO" == "dashboard" && -z "$DESIGN_ID" ]]; then
  echo "⚠️  dashboard 場景需要 --design-id，嘗試使用 DESIGN_ID=1（請確認此 ID 存在）"
  DESIGN_ID="1"
fi
if [[ "$SCENARIO" == "mcp" && -z "$MCP_SERVER_IDS" ]]; then
  echo "⚠️  mcp 場景需要 --mcp-ids，嘗試使用 MCP_SERVER_IDS=1（請確認此 ID 存在）"
  MCP_SERVER_IDS="1"
fi

# ── 建立報告目錄 ───────────────────────────────────────────────────────────────
REPORT_DIR="$SCRIPT_DIR/reports"
mkdir -p "$REPORT_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_JSON="$REPORT_DIR/${SCENARIO}_${TIMESTAMP}.json"

# ── 顯示測試資訊 ──────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║         FOXLINK GPT 壓力測試                         ║"
echo "╠══════════════════════════════════════════════════════╣"
printf "║  場景    : %-43s║\n" "$SCENARIO"
printf "║  並發數  : %-43s║\n" "$VUS VU"
printf "║  持續時間: %-43s║\n" "$DURATION"
printf "║  目標    : %-43s║\n" "$BASE_URL"
[[ -n "$KB_ID" ]]          && printf "║  KB ID   : %-43s║\n" "$KB_ID"
[[ -n "$DESIGN_ID" ]]      && printf "║  戰情 ID : %-43s║\n" "$DESIGN_ID"
[[ -n "$MCP_SERVER_IDS" ]] && printf "║  MCP IDs : %-43s║\n" "$MCP_SERVER_IDS"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── k8s 監控（背景）─────────────────────────────────────────────────────────
WATCH_PID=""
if [[ "$WATCH_K8S" == true ]]; then
  if ! command -v kubectl &>/dev/null; then
    echo "⚠️  找不到 kubectl，跳過 k8s 監控"
  else
    echo "📊 k8s pod 資源監控（每 10 秒，Ctrl+C 停止）："
    echo "   namespace: 請確認你的 namespace（修改下方 watch 指令）"
    # 壓測開始前先抓一次
    echo "── 壓測前 pod 資源 ──"
    kubectl top pods 2>/dev/null || echo "（需要 metrics-server）"
    echo ""
    # 背景監控
    (while true; do
      echo "── $(date '+%H:%M:%S') pod 資源 ──"
      kubectl top pods 2>/dev/null || true
      sleep 10
    done) &
    WATCH_PID=$!
    trap "kill $WATCH_PID 2>/dev/null || true" EXIT
  fi
fi

# ── 執行 k6 ──────────────────────────────────────────────────────────────────
echo "🚀 開始壓測..."
echo ""

K6_ENV=""
K6_ENV="$K6_ENV -e BASE_URL=$BASE_URL"
K6_ENV="$K6_ENV -e USERNAME=$USERNAME"
K6_ENV="$K6_ENV -e PASSWORD=$PASSWORD"
K6_ENV="$K6_ENV -e VUS=$VUS"
K6_ENV="$K6_ENV -e DURATION=$DURATION"
[[ -n "$KB_ID" ]]          && K6_ENV="$K6_ENV -e KB_ID=$KB_ID"
[[ -n "$DESIGN_ID" ]]      && K6_ENV="$K6_ENV -e DESIGN_ID=$DESIGN_ID"
[[ -n "$MCP_SERVER_IDS" ]] && K6_ENV="$K6_ENV -e MCP_SERVER_IDS=$MCP_SERVER_IDS"
[[ -n "$SELF_KB_IDS" ]]    && K6_ENV="$K6_ENV -e SELF_KB_IDS=$SELF_KB_IDS"

# shellcheck disable=SC2086
k6 run $K6_ENV \
  --out "json=$REPORT_JSON" \
  "$SCRIPT"

EXIT_CODE=$?

# ── 壓測後 k8s 資源 ───────────────────────────────────────────────────────────
if [[ "$WATCH_K8S" == true ]] && command -v kubectl &>/dev/null; then
  [[ -n "$WATCH_PID" ]] && kill "$WATCH_PID" 2>/dev/null || true
  echo ""
  echo "── 壓測後 pod 資源 ──"
  kubectl top pods 2>/dev/null || true
fi

# ── 結果摘要 ─────────────────────────────────────────────────────────────────
echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✅ 壓測完成，結果符合閾值"
else
  echo "⚠️  壓測完成，部分閾值未達標（exit code: $EXIT_CODE）"
fi
echo "📄 JSON 結果：$REPORT_JSON"
echo ""

# ── 生成 HTML 報告（選用）────────────────────────────────────────────────────
if [[ "$DO_REPORT" == true ]]; then
  REPORT_HTML="$REPORT_DIR/${SCENARIO}_${TIMESTAMP}.html"
  if command -v k6-reporter &>/dev/null; then
    k6-reporter "$REPORT_JSON" -o "$REPORT_HTML"
    echo "📊 HTML 報告：$REPORT_HTML"
  else
    echo "💡 安裝 k6 reporter 可產生 HTML 報告："
    echo "   npm install -g k6-reporter"
    echo "   然後重新執行並加上 --report"
  fi
fi

# ── 快速摘要（從 JSON 解析）──────────────────────────────────────────────────
if command -v python3 &>/dev/null && [[ -f "$REPORT_JSON" ]]; then
  python3 - "$REPORT_JSON" <<'PYEOF'
import sys, json

path = sys.argv[1]
metrics = {}
try:
    with open(path) as f:
        for line in f:
            try:
                obj = json.loads(line)
                if obj.get('type') == 'Point':
                    m = obj['metric']
                    v = obj['data']['value']
                    if m not in metrics:
                        metrics[m] = []
                    metrics[m].append(v)
            except:
                pass
except:
    sys.exit(0)

def pct(vals, p):
    if not vals: return 0
    s = sorted(vals)
    idx = int(len(s) * p / 100)
    return s[min(idx, len(s)-1)]

def rate(vals):
    if not vals: return 0
    return sum(vals) / len(vals) * 100

print("\n══ 壓測快速摘要 ══")
for key, label in [
    ('http_req_duration', '請求時間(ms)'),
    ('chat_duration_ms',  'Chat 時間(ms)'),
    ('kb_search_duration_ms', 'KB 搜尋時間(ms)'),
    ('dashboard_duration_ms', '戰情查詢時間(ms)'),
    ('mcp_duration_ms',   'MCP 時間(ms)'),
    ('overall_duration_ms', '整體時間(ms)'),
]:
    if key in metrics:
        vals = metrics[key]
        print(f"  {label}: avg={sum(vals)/len(vals):.0f}  p95={pct(vals,95):.0f}  p99={pct(vals,99):.0f}")

for key, label in [
    ('chat_success_rate', 'Chat 成功率'),
    ('kb_search_success_rate', 'KB 成功率'),
    ('dashboard_success_rate', '戰情成功率'),
    ('mcp_success_rate', 'MCP 成功率'),
    ('overall_success_rate', '整體成功率'),
]:
    if key in metrics:
        print(f"  {label}: {rate(metrics[key]):.1f}%")

if 'http_reqs' in metrics:
    total = len(metrics['http_reqs'])
    print(f"  總請求數: {total}")
PYEOF
fi

exit $EXIT_CODE
