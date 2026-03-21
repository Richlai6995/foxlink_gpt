# FOXLINK GPT 壓力測試指南

## 目錄
1. [前置準備](#1-前置準備)
2. [快速開始](#2-快速開始)
3. [場景說明](#3-場景說明)
4. [執行範例](#4-執行範例)
5. [觀測結果解讀](#5-觀測結果解讀)
6. [k8s 系統負擔監控](#6-k8s-系統負擔監控)
7. [閾值判斷基準](#7-閾值判斷基準)
8. [常見問題排查](#8-常見問題排查)

---

## 1. 前置準備

### 安裝 k6

```bash
# macOS
brew install k6

# Linux (apt)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# Windows
winget install k6 --source winget

# 確認安裝
k6 version
```

### 建立壓測專用帳號（建議）

在系統管理介面新增一個或多個測試帳號（避免汙染稽核日誌）：

```
帳號：stress_test_01 / stress_test_02 ...
角色：一般使用者
確認已啟用：can_use_ai_dashboard（若要跑 dashboard 場景）
```

### 確認測試目標 ID

壓測前需取得以下資料（進系統管理後台查詢）：

| 場景 | 需要的 ID | 取得方式 |
|------|-----------|---------|
| `kb` | 知識庫 ID（整數） | 後台 → 知識庫管理 → 查看 URL 中的 ID |
| `dashboard` | 戰情設計 ID（整數） | 後台 → AI 戰情設計 → 查看 URL 中的 ID |
| `mcp` | MCP Server ID（整數） | 後台 → MCP 伺服器 → 查看 ID |

---

## 2. 快速開始

```bash
cd load-test
chmod +x run.sh

# 步驟 1：暖機確認連通（3 VU，30 秒）
./run.sh --url http://your-server:3001 --users 3 --duration 30s

# 步驟 2：單場景壓測
./run.sh --scenario chat --users 20 --duration 2m --url http://your-server:3001

# 步驟 3：全混合壓測
./run.sh --scenario full --users 40 --duration 3m \
         --url http://your-server:3001 \
         --kb-id 5 --design-id 2 --mcp-ids 1
```

---

## 3. 場景說明

### `chat` — LLM 對話

模擬使用者發送一般文字問題，等待 SSE streaming 完整回應。

**流程**：建立 session → POST message（SSE）→ 等待 `done` event → 刪除 session

**系統壓力點**：Gemini API 併發請求數、Node.js event loop、記憶體（SSE 連線保持）

**建議 VU**：10–30（受限於 Gemini API 速率限制）

---

### `kb` — 知識庫向量搜尋

直接呼叫知識庫 search API，不走 LLM。

**流程**：POST /api/kb/:id/search → 同步回應

**系統壓力點**：Oracle DB 向量搜尋（VECTOR 索引）、連線池

**建議 VU**：20–50

---

### `dashboard` — AI 戰情查詢

最重的場景：LLM 生成 SQL + 連 ERP Oracle 執行 + SSE 回傳結果。

**流程**：POST /api/dashboard/query → LLM 生成 SQL → ERP 查詢 → SSE 回傳

**系統壓力點**：Gemini API、ERP Oracle 連線池、資料政策計算

**建議 VU**：3–8（ERP 連線池通常 10–20，多了會排隊）

---

### `mcp` — MCP Tool Call

透過 chat 觸發 MCP function calling，LLM 自主決定呼叫外部工具。

**流程**：建立 session → POST message with mcp_server_ids → FC loop → SSE done

**系統壓力點**：Gemini API（多輪 FC 迴圈）、外部 MCP HTTP 呼叫

**建議 VU**：3–8

---

### `full` — 混合場景

依真實使用比例同時跑所有場景：

| 場景 | 比例 | 說明 |
|------|------|------|
| chat | 40% | 最常見 |
| kb | 30% | 知識庫查詢頻繁 |
| dashboard | 20% | 管理人員使用 |
| mcp | 10% | 進階功能 |

**建議 VU（total）**：20–50

---

## 4. 執行範例

### 基本 Chat 壓測

```bash
./run.sh \
  --scenario chat \
  --users 20 \
  --duration 2m \
  --url http://10.0.0.5:3001 \
  --username stress_test_01 \
  --password test123
```

### 知識庫搜尋壓測

```bash
./run.sh \
  --scenario kb \
  --users 30 \
  --duration 2m \
  --url http://10.0.0.5:3001 \
  --kb-id 5
```

### AI 戰情壓測（含 k8s 監控）

```bash
./run.sh \
  --scenario dashboard \
  --users 5 \
  --duration 2m \
  --url http://10.0.0.5:3001 \
  --design-id 2 \
  --watch-k8s
```

### 全混合場景 + HTML 報告

```bash
./run.sh \
  --scenario full \
  --users 40 \
  --duration 5m \
  --url http://10.0.0.5:3001 \
  --kb-id 5 \
  --design-id 2 \
  --mcp-ids 1,2 \
  --report \
  --watch-k8s
```

### 漸進式壓測（手動分階段執行）

```bash
# 階段 1：輕載
./run.sh --scenario full --users 10 --duration 2m

# 階段 2：中載
./run.sh --scenario full --users 25 --duration 2m

# 階段 3：重載
./run.sh --scenario full --users 50 --duration 2m

# 觀察哪個階段開始出現 error rate 上升或 p95 劇增
```

---

## 5. 觀測結果解讀

### k6 終端輸出格式

壓測結束後 k6 會輸出類似以下內容：

```
scenarios: (100.00%) 1 scenario, 20 max VUs, 1m30s max duration
default: 20 looping VUs for 1m0s (gracefulStop: 30s)

✓ login 200
✓ create session 200
✓ chat SSE 200
✓ chat got done
✗ chat < 30s          ← 這個 check 失敗 → 部分回應超過 30 秒

checks.........................: 94.20% ✓ 1884  ✗ 116
data_received..................: 45 MB  750 kB/s
data_sent......................: 2.3 MB 38 kB/s
http_req_blocked...............: avg=1.2ms    p(90)=2.1ms    p(95)=3.4ms
http_req_connecting............: avg=0.8ms    p(90)=1.5ms    p(95)=2.3ms
http_req_duration..............: avg=8.3s     p(90)=18.2s    p(95)=24.6s  ← 重點
http_req_failed................: 2.40%  ✓ 47   ✗ 1913         ← 失敗率
http_req_waiting...............: avg=0.9s     p(90)=2.1s     p(95)=3.8s   ← TTFB
http_reqs......................: 1960   32.6/s
vus............................: 20     min=20  max=20
vus_max........................: 20     min=20  max=20

chat_duration_ms...............: avg=8234ms   p(90)=18156ms  p(95)=24581ms
chat_success_rate..............: 97.60%

✓ chat_success_rate rate>90.00%    ← 閾值通過
✗ chat_duration_ms p(95)<30000ms   ← 閾值不通過（24.6s < 30s，實際通過但顯示計算問題）
```

### 關鍵指標說明

#### `http_req_duration` — 總請求時間

從發出請求到收完整個 response body 的時間。
**對 SSE 場景**（chat / dashboard）：這個值代表 LLM 完整生成完畢的時間，正常偏長（5–30 秒）。

```
avg=8.3s     → 平均每次 LLM 對話耗時 8.3 秒
p(90)=18.2s  → 90% 的請求在 18.2 秒內完成
p(95)=24.6s  → 95% 的請求在 24.6 秒內完成（用於判斷是否達閾值）
p(99)=35.1s  → 1% 的請求超過 35 秒（偶發慢請求）
```

#### `http_req_waiting` — TTFB（Time to First Byte）

從發出請求到收到第一個 byte 的時間。
**對 SSE 場景**：代表 LLM 回應「第一個 token」的延遲，是使用者感受到的「系統反應速度」。
正常範圍：0.5–3 秒。超過 5 秒代表系統有排隊或 LLM API 壅塞。

#### `http_req_failed` — HTTP 錯誤率

k6 計算所有 4xx/5xx 及連線失敗的比率。
正常應低於 2%。若爬升代表系統過載。

#### `chat_success_rate` / `kb_search_success_rate` 等

自訂指標，代表業務層面成功率（status 200 + SSE 有 `done` event）。
**比 `http_req_failed` 更嚴格**：即使 HTTP 200 但 SSE 沒收到 `done`（如超時中斷）也算失敗。

#### `vus` — 當前 Virtual Users 數

若 VU 數在壓測期間下降（低於設定值），表示 k6 因超時而提前結束了部分 VU，系統已達極限。

---

### Checks 結果解讀

```
✓ chat SSE 200      → HTTP 狀態 200（連線正常）
✓ chat got done     → SSE 收到 done event（LLM 完整回應）
✗ chat < 30s        → 超時（LLM 回應超過 30 秒，不一定是錯誤，可能是正常慢）
```

**Check 失敗不等於系統故障**，需結合業務判斷：
- `chat got done` 失敗 → 嚴重，LLM 沒有完整回應
- `chat < 30s` 失敗 → 參考，可能只是 LLM 這次回應比較長

---

### 快速摘要輸出（run.sh 自動產生）

若環境有 `python3`，壓測結束後會自動輸出：

```
══ 壓測快速摘要 ══
  請求時間(ms): avg=8234  p95=24581  p99=35120
  Chat 時間(ms): avg=8190  p95=24320  p99=34800
  Chat 成功率: 97.6%
  總請求數: 1960
```

---

## 6. k8s 系統負擔監控

### 使用 `--watch-k8s` 自動監控

```bash
./run.sh --scenario full --users 40 --watch-k8s
```

壓測開始前、進行中（每 10 秒）、結束後各顯示 pod 資源：

```
── 壓測前 pod 資源 ──
NAME                        CPU(cores)   MEMORY(bytes)
foxlink-gpt-7d9b4f-xk2lp    45m          312Mi

── 14:32:15 pod 資源 ──
foxlink-gpt-7d9b4f-xk2lp    680m         485Mi     ← 壓測中 CPU 飆升

── 壓測後 pod 資源 ──
foxlink-gpt-7d9b4f-xk2lp    52m          340Mi     ← 回落
```

### 手動監控（另開終端）

```bash
# 即時 pod 資源（每 2 秒刷新）
watch -n 2 kubectl top pods -n your-namespace

# 觀察 HPA 自動擴縮
kubectl get hpa -n your-namespace -w

# pod 重啟次數（若有 OOM 或崩潰）
kubectl get pods -n your-namespace

# 查看 pod 詳細事件
kubectl describe pod <pod-name> -n your-namespace
```

### 資源使用解讀

| 指標 | 正常範圍 | 需注意 | 危險 |
|------|---------|--------|------|
| CPU（單 pod） | < 500m | 500m–900m | > 900m（接近 limit） |
| Memory（單 pod） | < 512Mi | 512Mi–800Mi | > 800Mi（有 OOM 風險） |
| Pod 重啟次數 | 0 | 1–2 | ≥3（頻繁崩潰） |
| HPA 觸發擴縮 | 無 | 擴到 2 pod | 擴到 max 且仍過載 |

### Node.js 特有觀察

Node.js 是單執行緒，CPU 超過 100% 不可能（上限 1 core = 1000m）。
若 CPU 長期在 **800m–1000m** 代表 event loop 已壅塞，所有 SSE 連線都會變慢。

**判斷 event loop 壅塞的方法**：觀察 `http_req_waiting`（TTFB）是否隨 VU 增加而線性上升。若是，表示請求在 Node.js 內排隊，需要考慮：
- 增加 pod replica 數
- 調高 k8s resource limit
- 優化 async 程式碼

---

## 7. 閾值判斷基準

### 各場景通過標準

| 場景 | 成功率 | p95 時間 | HTTP 錯誤率 |
|------|--------|---------|------------|
| chat | ≥ 90% | ≤ 30s | ≤ 10% |
| kb | ≥ 95% | ≤ 5s | ≤ 5% |
| dashboard | ≥ 85% | ≤ 60s | ≤ 15% |
| mcp | ≥ 85% | ≤ 45s | ≤ 15% |
| full（混合） | ≥ 85% | ≤ 30s | ≤ 15% |

### 健康 vs 過載 對比

**健康狀態**：
```
chat_success_rate: 97.5%     ← 遠高於 90%
chat_duration_ms  p95: 18s   ← 低於 30s
http_req_failed: 0.8%        ← 低於 10%
Pod CPU: 450m / 800m limit   ← 還有餘裕
```

**過載狀態**：
```
chat_success_rate: 78.2%     ← 低於 90% ❌
chat_duration_ms  p95: 52s   ← 超過 30s ❌
http_req_failed: 18.4%       ← 超過 10% ❌
Pod CPU: 950m / 1000m limit  ← 接近上限 ⚠️
Pod MEMORY: 1.1Gi / 1Gi      ← 超過 limit，OOM 殺手介入 ❌
```

### k6 exit code

| exit code | 含義 |
|-----------|------|
| 0 | 所有閾值通過 |
| 99 | 部分閾值未達標（run.sh 會顯示 ⚠️） |
| 1 | k6 執行錯誤（腳本語法錯誤、連線失敗等） |

---

## 8. 常見問題排查

### Chat 打出 `400 Bad Request`

**原因**：multipart/form-data 解析問題。
**確認**：
```bash
# 手動測試登入
curl -X POST http://your-server:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"ADMIN","password":"123456"}'

# 手動測試 chat（取得 token 後）
curl -X POST http://your-server:3001/api/chat/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"flash"}'
```

### Dashboard 打出 `403 Forbidden`

**原因**：測試帳號沒有 `can_use_ai_dashboard` 權限，或 design_id 不存在。
**確認**：後台 → 使用者管理 → 確認帳號有 AI 戰情使用權限。

### `http_req_failed` 突然從 0% 跳到 30%+

**原因**：可能是 Oracle DB 連線池耗盡（ORA-12519），或 Node.js OOM 被 k8s 殺掉。
**確認**：
```bash
kubectl logs <pod-name> -n your-namespace --tail=100 | grep -E "ORA-|Error|FATAL"
kubectl get events -n your-namespace --sort-by='.lastTimestamp' | tail -20
```

### VU 數量在壓測中途下降

**原因**：k6 偵測到請求超時（90–120 秒 timeout），自動關閉那個 VU 的 iteration。
**含義**：系統已在這個 VU 數下無法正常回應，**找到了瓶頸點**。
記錄這個 VU 數，這就是你系統在當前配置下的並發極限。

### 壓測機本身 CPU 飆高

**原因**：k6 本身消耗資源，尤其 VU 數很高時。
**建議**：壓測機和被測機分開，或用 Docker 跑 k6：
```bash
docker run --rm -i \
  -e BASE_URL=http://your-server:3001 \
  -e VUS=40 \
  -e DURATION=2m \
  -v $(pwd)/scenarios:/scenarios \
  grafana/k6 run /scenarios/full.js
```

---

## 附錄：結果記錄表格

建議每次壓測後記錄以下資料，追蹤各版本效能變化：

| 日期 | 版本 | 場景 | VU | 成功率 | p95 時間 | 錯誤率 | Pod CPU峰值 | 備註 |
|------|------|------|-----|--------|---------|--------|------------|------|
| 2025-03-21 | v1.0 | full | 20 | 96% | 22s | 1.2% | 480m | 基準測試 |
| | | | | | | | | |
| | | | | | | | | |
