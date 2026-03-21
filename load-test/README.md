# FOXLINK GPT 壓力測試

使用 [k6](https://k6.io/) 對 k8s/docker 環境進行壓力測試。

## 安裝 k6

```bash
# macOS
brew install k6

# Linux (apt)
sudo apt install k6

# Linux (snap)
sudo snap install k6

# Docker（不需安裝，直接用）
docker run --rm -i grafana/k6 run - < scenarios/chat.js

# Windows
winget install k6 --source winget
```

## 快速開始

```bash
chmod +x run.sh

# 基本 chat 壓測（10 VU，60 秒）
./run.sh --url http://your-k8s-ip:3001

# 指定場景和人數
./run.sh --scenario chat --users 20 --duration 2m

# 知識庫搜尋（需指定 KB ID）
./run.sh --scenario kb --users 30 --kb-id 5

# AI 戰情（需指定 Design ID）
./run.sh --scenario dashboard --users 5 --design-id 2

# MCP 工具呼叫
./run.sh --scenario mcp --users 5 --mcp-ids 1,2

# 全混合場景（模擬真實使用比例）
./run.sh --scenario full --users 40 --kb-id 5 --design-id 2 --mcp-ids 1
```

## 場景說明

| 場景 | 說明 | 建議 VU | 閾值 |
|------|------|---------|------|
| `chat` | 基本 LLM 對話（SSE） | 10–30 | 成功率>90%, p95<30s |
| `kb` | 知識庫向量搜尋 | 20–50 | 成功率>95%, p95<5s |
| `dashboard` | AI 戰情查詢（SSE+ERP） | 3–10 | 成功率>85%, p95<60s |
| `mcp` | MCP Tool Call via Chat | 3–10 | 成功率>85%, p95<45s |
| `full` | 混合（4:3:2:1 比例） | 20–50 | 成功率>85% |

## 環境變數一覧

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `BASE_URL` | 伺服器位址 | `http://localhost:3001` |
| `USERNAME` | 測試帳號 | `ADMIN` |
| `PASSWORD` | 密碼 | `123456` |
| `VUS` | 並發用戶數 | 各場景不同 |
| `DURATION` | 持續時間 | `60s` |
| `KB_ID` | 知識庫 ID（`kb` 場景） | `1` |
| `DESIGN_ID` | AI 戰情 Design ID（`dashboard` 場景） | `1` |
| `MCP_SERVER_IDS` | MCP Server IDs 逗號分隔（`mcp` 場景） | `1` |
| `SELF_KB_IDS` | KB IDs 逗號分隔（chat 帶 KB） | 無 |

## 結合 k8s 監控

```bash
# 加 --watch-k8s 同時顯示 pod 資源使用（需 metrics-server）
./run.sh --scenario full --users 40 --watch-k8s

# 手動監控（另開終端）
watch kubectl top pods -n your-namespace

# 查看 HPA 縮放
kubectl get hpa -n your-namespace -w

# 看 pod 重啟次數
kubectl get pods -n your-namespace
```

## Grafana/Prometheus 整合（k8s 環境推薦）

如果 k8s 已有 Prometheus + Grafana，可以用 k6 的 remote write 輸出：

```bash
K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
k6 run --out experimental-prometheus-rw scenarios/full.js
```

## 閱讀報告

每次執行會在 `reports/` 目錄產生 `{scenario}_{timestamp}.json`。

k6 終端輸出說明：
```
✓ chat SSE 200     ← check 項目（✓ 通過 / ✗ 失敗）
http_req_duration  ← 請求總時間
http_req_waiting   ← TTFB（Time to First Byte）—對 SSE 最重要
vus                ← 當前 VU 數
```

**重點看**：
- `http_req_waiting` p95 — LLM 首 token 延遲
- `chat_success_rate` — SSE 完整回應率
- `http_req_failed` — 連線錯誤率
- 壓測期間 kubectl top pods 的 CPU/Memory 峰值

## 注意事項

1. **先用低 VU 暖機**：先跑 `--users 5 --duration 30s` 確認連通性再拉高
2. **dashboard 場景** VU 不要超過 ERP 連線池大小（預設通常 10–20）
3. **k6 在壓測機本身也需要資源**：建議在非 k8s node 的機器上執行
4. **SSE 超時設定**：LLM 回應慢時正常，已設 90–120 秒 timeout
5. **測試帳號**：建議建立專用的壓測帳號，不要用生產帳號，避免稽核日誌汙染
