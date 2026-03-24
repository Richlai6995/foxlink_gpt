# K8s Monitor 設計計畫 v2

## Context
在現有 Foxlink GPT AdminDashboard 中整合 K8s/Docker + 系統監控模組（admin-only）。
Server 跑在 K8s management node，直接 spawn kubectl/docker/proc 指令。
**沒有 metrics-server**，改用 `kubectl describe node` 解析 Requests/Limits vs Allocatable。

參考系統：Portainer、Grafana+Prometheus、Netdata、cAdvisor、Datadog Synthetic

---

## 確認的需求

| 需求 | 決策 |
|------|------|
| 整合位置 | AdminDashboard 側邊欄 + `/admin/monitor` 路由，admin only |
| 進入方式 | 不需要再輸入密碼，已登入的 admin 直接進入 |
| Deploy 確認 | 改為確認 modal（顯示指令內容），不要求重新輸密碼 |
| 指令執行 | `child_process.spawn`（直接在 management node） |
| 節點指標 | kubectl describe node → Allocatable vs Requests（無 metrics-server） |
| 主機指標 | /proc 解析：CPU Load / Memory / Network I/O / Disk I/O |
| Container 細部 | docker stats --no-stream（CPU%、Mem、Net、Block I/O） |
| 磁碟監控 | df -h 所有 mount point + NAS 掛載偵測 + inode |
| 線上人數 | 讀 in-memory token Map，每 5 分鐘快照入庫，歷史趨勢 |
| K8s Events | kubectl get events --all-namespaces，Warning 標紅 |
| 趨勢圖 | ECharts 折線，節點/磁碟/線上人數/系統負載，可選 24h/7d/30d |
| Log | 即時串流、關鍵字高亮、tail N 行、下載、自動清除排程 |
| Deploy | SSE 串流輸出 + 確認 modal（無需密碼）+ 歷史紀錄 |
| Image 清理 | docker image prune -f + 確認 modal |
| Service 健康檢查 | 可設定 URL 清單，定期 ping，顯示可用率與回應時間 |
| 異常通知 | 多等級（Warning/Critical/Emergency），Email + Webhook（LINE/Teams）|
| Dashboard 總覽 | 頁面頂部一排 stat 卡片：節點/Pod/線上人數/磁碟/CPU Load/未解告警 |
| Container 操作 | restart/stop/start（確認 modal），選配 exec terminal（xterm.js）|

---

## DB Schema 新增（Oracle）

```sql
-- 節點指標歷史（每 5 分鐘一筆）
CREATE TABLE node_metrics (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_name     VARCHAR2(100) NOT NULL,
  role          VARCHAR2(20),           -- master / worker
  status        VARCHAR2(20),           -- Ready / NotReady / Unknown
  cpu_alloc     VARCHAR2(20),           -- Allocatable CPU, e.g. "3920m"
  cpu_req       VARCHAR2(20),           -- Total Requests CPU
  cpu_req_pct   NUMBER(5,2),            -- Requests / Allocatable %
  mem_alloc     VARCHAR2(20),           -- Allocatable Memory
  mem_req       VARCHAR2(20),           -- Total Requests Memory
  mem_req_pct   NUMBER(5,2),            -- Requests / Allocatable %
  pod_count     NUMBER,                 -- Running pods on node
  collected_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 主機系統指標（每 5 分鐘一筆，讀 /proc）
CREATE TABLE host_metrics (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  load_1m       NUMBER(6,2),            -- /proc/loadavg
  load_5m       NUMBER(6,2),
  load_15m      NUMBER(6,2),
  mem_total_mb  NUMBER,                 -- /proc/meminfo
  mem_used_mb   NUMBER,
  mem_cached_mb NUMBER,
  swap_used_mb  NUMBER,
  net_rx_mb     NUMBER(10,2),           -- /proc/net/dev 累計，取 delta
  net_tx_mb     NUMBER(10,2),
  disk_read_mb  NUMBER(10,2),           -- /proc/diskstats 累計，取 delta
  disk_write_mb NUMBER(10,2),
  uptime_sec    NUMBER,
  collected_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 磁碟使用歷史（每小時一筆）
CREATE TABLE disk_metrics (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mount         VARCHAR2(200),          -- e.g. /, /data/nas
  device        VARCHAR2(200),
  total_gb      NUMBER(10,2),
  used_gb       NUMBER(10,2),
  use_pct       NUMBER(5,2),
  inode_pct     NUMBER(5,2),
  is_mounted    NUMBER(1) DEFAULT 1,    -- 0 = NAS 掉了
  collected_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 線上人數快照（每 5 分鐘一筆）
CREATE TABLE online_user_snapshots (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  online_count  NUMBER,
  user_ids      VARCHAR2(2000),         -- JSON array of user_ids
  collected_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Service 健康檢查設定
CREATE TABLE health_checks (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            VARCHAR2(100) NOT NULL,
  url             VARCHAR2(500) NOT NULL,
  method          VARCHAR2(10) DEFAULT 'GET',
  expected_status NUMBER DEFAULT 200,
  timeout_ms      NUMBER DEFAULT 5000,
  enabled         NUMBER(1) DEFAULT 1,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Service 健康檢查結果（每 1 分鐘一筆）
CREATE TABLE health_check_results (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  check_id      NUMBER NOT NULL,
  status_code   NUMBER,
  response_ms   NUMBER,
  is_up         NUMBER(1),
  error_msg     VARCHAR2(500),
  checked_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 異常通知記錄
CREATE TABLE monitor_alerts (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_type    VARCHAR2(50),    -- node_not_ready / pod_crash / resource_high / disk_high / nas_down / service_down
  severity      VARCHAR2(20),    -- warning / critical / emergency
  resource_name VARCHAR2(200),
  message       CLOB,
  notified_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at   TIMESTAMP        -- NULL = 尚未解除
);

-- Deploy 歷史紀錄
CREATE TABLE deploy_history (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  triggered_by  NUMBER,          -- user_id
  git_before    VARCHAR2(40),    -- git rev-parse HEAD 執行前
  git_after     VARCHAR2(40),    -- 執行後
  exit_code     NUMBER,
  log_text      CLOB,
  deployed_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- system_settings 新增 key
-- 'monitor_log_retention_days'       => '30'
-- 'monitor_metrics_retention_days'   => '7'
-- 'monitor_disk_retention_days'      => '30'
-- 'monitor_online_retention_days'    => '30'
-- 'monitor_health_check_retention'   => '7'
-- 'monitor_alert_enabled'            => 'true'
-- 'monitor_alert_cooldown'           => '30'   (分鐘)
-- 'monitor_cpu_threshold'            => '90'   (%)
-- 'monitor_mem_threshold'            => '85'   (%)
-- 'monitor_disk_threshold'           => '85'   (%)
-- 'monitor_pod_restart_limit'        => '5'
-- 'monitor_pod_pending_minutes'      => '10'
-- 'monitor_alert_webhook_url'        => ''     (LINE Notify / Teams Webhook)
-- 'monitor_alert_webhook_enabled'    => 'false'
-- 'monitor_load_threshold'           => '0.9'  (load avg / CPU count 比值)
```

---

## Backend API（`server/routes/monitor.js`）

所有 API：`verifyToken` + `req.user.role === 'admin'`

### Dashboard 總覽
```
GET  /api/monitor/summary              # 總覽卡片資料（節點/Pod/線上人數/磁碟/CPU Load/未解告警）
```

### 節點 & K8s
```
GET  /api/monitor/nodes                # kubectl get nodes -o json
GET  /api/monitor/nodes/detail         # kubectl describe node（解析 Requests/Limits）
GET  /api/monitor/nodes/history        # query node_metrics (?hours=24&days=7)
GET  /api/monitor/pods                 # kubectl get pods --all-namespaces -o json
GET  /api/monitor/events               # kubectl get events --all-namespaces -o json（K8s Events）
```

### 主機系統指標
```
GET  /api/monitor/host/current         # 即時 /proc 解析：Load / Mem / Net / Disk I/O / Uptime
GET  /api/monitor/host/history         # query host_metrics (?hours=24&days=7)
GET  /api/monitor/host/processes       # ps aux --sort=-%cpu | head 20（Top 10 process by CPU/Mem）
```

### Docker
```
GET  /api/monitor/images               # docker images --format json
GET  /api/monitor/containers           # docker ps -a --format json
GET  /api/monitor/containers/:id/stats # docker stats --no-stream（CPU%/Mem/Net/BlockIO）
POST /api/monitor/containers/:id/restart  # docker restart（確認後執行）
POST /api/monitor/containers/:id/stop     # docker stop
POST /api/monitor/containers/:id/start   # docker start
POST /api/monitor/images/prune         # docker image prune -f
```

### Log Streaming（SSE）
```
GET  /api/monitor/logs/pod/:ns/:pod    # SSE: kubectl logs --follow --tail=N
GET  /api/monitor/logs/container/:id   # SSE: docker logs --follow --tail=N
```

### 磁碟 / NAS
```
GET  /api/monitor/disk                 # df -h + df -i（所有 mount point）
GET  /api/monitor/disk/history         # query disk_metrics (?days=7&mount=/)
```

### 線上人數
```
GET  /api/monitor/online-users         # 當前線上人數 + 用戶清單（token Map）
GET  /api/monitor/online-users/history # query online_user_snapshots (?hours=24&days=7)
```

### Service 健康檢查
```
GET  /api/monitor/health-checks        # 列出所有設定
POST /api/monitor/health-checks        # 新增
PUT  /api/monitor/health-checks/:id    # 更新
DELETE /api/monitor/health-checks/:id  # 刪除
GET  /api/monitor/health-checks/:id/results  # 歷史結果 + 可用率統計
```

### Deploy & Alerts
```
POST /api/monitor/deploy               # SSE: git pull && ./deploy.sh（確認 modal，無需密碼）
GET  /api/monitor/deploy/history       # query deploy_history
GET  /api/monitor/alerts               # query monitor_alerts（可篩選 resolved/unresolved）
POST /api/monitor/alerts/:id/resolve   # 手動標記解除
GET  /api/monitor/settings             # 監控相關設定
PUT  /api/monitor/settings             # 更新設定
```

---

## Services

### `server/services/metricsCollector.js`（node-cron）

```
每 1 分鐘：
  - health check runner：對 health_checks 表的啟用項目發 HTTP request
    → INSERT health_check_results
    → 連續失敗 2 次 → 觸發 service_down 告警

每 5 分鐘：
  1. kubectl get/describe nodes → INSERT node_metrics
  2. /proc/loadavg, /proc/meminfo, /proc/net/dev, /proc/diskstats → INSERT host_metrics
  3. 讀 in-memory token Map → INSERT online_user_snapshots
  4. 比對所有閾值 → 觸發異常告警（monitor_alerts + Email + Webhook）

每 1 小時：
  5. df -h / df -i → INSERT disk_metrics
  6. NAS 掛載狀態檢查（mount point 消失 → is_mounted=0 → 告警）

每日凌晨 2 點：
  7. 清除超過保留天數的歷史資料（node_metrics / host_metrics / disk_metrics / online_user_snapshots / health_check_results）
```

### `server/services/webhookNotifier.js`（新增）

```js
// 支援 LINE Notify 及 Microsoft Teams Incoming Webhook
// LINE: POST https://notify-api.line.me/api/notify  { message: '...' }
// Teams: POST <webhook_url>  { "@type": "MessageCard", "text": "..." }
// 從 system_settings 讀取 webhook url 及 enabled flag
```

---

## 前端 UI 布局

```
AdminDashboard Sidebar:
[... 現有項目 ...]
[🖥 系統監控]  ← 新增，admin only，直接進入不需密碼

MonitorPage 頁面：
┌──────────────────────────────────────────────────────────────────┐
│  系統監控          [🔄 Refresh]  [🚀 Deploy]  [⚙ 設定]          │
│  ⚠ [異常警示 banner，有未解除異常時顯示，可點擊展開詳情]           │
├──────────────────────────────────────────────────────────────────┤
│  DASHBOARD 總覽（stat 卡片一排）                                  │
│  [節點 3/3 Ready]  [Pod 12 Running 0 Error]  [線上人數 5]        │
│  [磁碟 /data 62%]  [CPU Load 1.2/3.8/4.1]   [未解除告警 2]      │
├──────────────┬──────────────────────┬──────────────────────────┤
│  節點狀態     │  K8s Pods             │  Docker Images           │
│              │  [Namespace 篩選 ▼]  │  REPO:TAG       SIZE     │
│ ● master     │  foxlink/app-xxx      │  app:latest     1.2G    │
│  ✓ Ready     │  Running  v1.2.3     │  redis:7-alpine 200M    │
│  CPU req 23% │  foxlink/redis-xxx   │  <none>:<none>  500M ⚠  │
│  Mem req 45% │  Running  7-alpine   │  [清理無用 Image 🗑]      │
│              ├──────────────────────┤                          │
│ ● worker-1   │  K8s Events           │  Docker Containers      │
│  ✓ Ready     │  ⚠ Warning 標紅       │  app    Up 2days  [↻][■]│
│  CPU req 67% │  Normal 標灰          │  redis  Up 2days  [↻][■]│
│  Mem req 78% │  [ns 篩選] [W only▼] │  (CPU%/Mem/Net inline)  │
├──────────────┴──────────────────────┴──────────────────────────┤
│  主機系統指標（即時 + 歷史，/proc 解析）                           │
│  CPU Load: 1.2 / 3.8 / 4.1   Mem: 12.4GB/32GB   Uptime: 5d   │
│  Net: ↓ 12MB/s ↑ 3MB/s       Disk I/O: R 5MB/s W 2MB/s       │
│  Top Processes: [表格 pid / name / cpu% / mem%]                │
├──────────────────────────────────────────────────────────────────┤
│  磁碟 / NAS 掛載                                                 │
│  /            80GB / 500GB  16%  ████░░░░                      │
│  /data/nas    2.1TB / 4TB   52%  █████░░░  ✓ 已掛載             │
│  /data/nas2   -             -    ██████████  ✗ 未掛載！⚠        │
├──────────────────────────────────────────────────────────────────┤
│  Service 健康檢查                                                 │
│  ● Foxlink GPT   200ms  ✓ 99.9% (30d)  [編輯][刪除]             │
│  ● Oracle DB     12ms   ✓ 100%          [編輯][刪除]             │
│  ● SMTP          -       ✗ DOWN ⚠       [編輯][刪除]             │
│  [+ 新增檢查項目]                                                 │
├──────────────────────────────────────────────────────────────────┤
│  線上人數                                                         │
│  現在線上：5 人  [工號 姓名 登入時間 的清單]                        │
│  歷史趨勢（ECharts）  [24h ▼]  折線圖                             │
│  高峰時段分析（每小時平均人數 bar chart）                           │
├──────────────────────────────────────────────────────────────────┤
│  📈 節點/系統趨勢（ECharts）                                      │
│  [Node ▼] [磁碟 ▼] [主機負載 ▼]  [CPU%][Mem%][Pods][Load]       │
│  [24h / 7d / 30d]  折線圖                                        │
├──────────────────────────────────────────────────────────────────┤
│  Log Viewer                                                      │
│  [選 Pod/Container ▼] [tail: 100 ▼] [🔍 搜尋...] [⬇下載] [■停] │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 10:23:01 INFO  Server started on :3007                    │  │
│  │ 10:23:02 ERROR Failed to connect  ← 紅色高亮              │  │
│  │ 10:23:03 WARN  Retry in 5s ← 黃色高亮                     │  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  Deploy 歷史                                                      │
│  2026-03-24 10:00  admin  abc1234→def5678  ✓ 成功  [查看 log]    │
│  2026-03-20 08:30  admin  fff1111→abc1234  ✗ 失敗  [查看 log]    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 前端元件拆分

```
client/src/pages/MonitorPage.tsx               # 主頁面（原 K8sMonitorPage）
client/src/components/monitor/
├── MonitorSummaryCards.tsx     # Dashboard 總覽 stat 卡片
├── AlertBanner.tsx             # 頂部異常警示 banner
├── NodeStatusGrid.tsx          # 節點卡片（含 CPU/Mem request bar）
├── NodeMetricsChart.tsx        # ECharts 趨勢折線（可選指標 + 時間範圍）
├── PodTable.tsx                # Pod 列表（namespace 篩選）
├── K8sEventsTable.tsx          # K8s Events（Warning/Normal，可篩選）
├── HostMetricsPanel.tsx        # 主機系統指標（Load/Mem/Net/DiskIO + Top Processes）
├── DiskUsagePanel.tsx          # 磁碟 + NAS 掛載（progress bar + inode）
├── OnlineUsersPanel.tsx        # 線上人數即時 + 歷史趨勢 + 高峰分析
├── ContainerTable.tsx          # Docker container（含 stats inline + restart/stop/start）
├── DockerImagesPanel.tsx       # Image 列表 + prune
├── HealthChecksPanel.tsx       # Service 健康檢查 + 可用率 + 歷史
├── LogViewer.tsx               # SSE log + 搜尋高亮 + 下載
├── DeployPanel.tsx             # Deploy 確認 modal + SSE 串流輸出
├── DeployHistoryTable.tsx      # Deploy 歷史紀錄 + log 展開
└── MonitorSettingsModal.tsx    # 所有監控設定（閾值/保留天數/Webhook）
```

---

## Deploy 流程設計（無密碼版）

```
1. 使用者點 [🚀 Deploy]
2. 彈出確認 modal：
   - 顯示即將執行的指令：cd ~/foxlink_gpt && git pull && ./deploy.sh
   - 顯示最後一次 deploy 時間及結果
   - [確認 Deploy] / [取消] 按鈕（無需輸入密碼）
3. 後端確認 role === 'admin' → 取得 git rev-parse HEAD（before）→ 開啟 SSE
4. spawn: cd ~/foxlink_gpt && git pull && ./deploy.sh
5. 前端 log viewer 即時顯示輸出
6. Process 結束 → 取得 git rev-parse HEAD（after）
7. INSERT deploy_history（triggered_by, git_before, git_after, exit_code, log_text）
8. 顯示 exit code 及成功/失敗
```

---

## 異常通知設計

### 觸發條件（可設定開關）

| 異常類型 | 條件 | 嚴重度 |
|---------|------|--------|
| Node NotReady | kubectl get nodes 發現節點狀態變 NotReady | Emergency |
| Pod CrashLoopBackOff | Pod restarts 超過閾值（預設 5 次）| Critical |
| Pod Pending 過久 | Pod 停留 Pending 超過 N 分鐘（預設 10min）| Warning |
| Container 異常停止 | docker ps 發現 container exited（非預期）| Critical |
| Resource 過載 (K8s) | CPU/Memory request% 超過閾值（預設 90%）| Critical |
| CPU Load 過高 | load avg / CPU count 比值 > 閾值（預設 0.9）| Warning |
| Memory 過高 | 實體記憶體使用 > 閾值（預設 85%）| Warning |
| 磁碟空間不足 | 任一 mount point 使用 > 閾值（預設 85%）| Critical |
| NAS 掉掛 | mount point 消失（is_mounted=0）| Emergency |
| Service 異常 | health check 連續失敗 2 次 | Critical |

### 通知方式

| 嚴重度 | 系統內 Banner | Email | Webhook（LINE/Teams） |
|--------|--------------|-------|----------------------|
| Warning | ✓ | ✗ | ✗ |
| Critical | ✓ | ✓ | ✓（若啟用） |
| Emergency | ✓ | ✓ | ✓（強制） |

### 通知去重
- 同一異常：每 30 分鐘最多通知一次（可設定）
- 自動解除偵測：下次收集時異常消失 → 更新 `resolved_at`，banner 移除

### Webhook 格式
- **LINE Notify**: `POST https://notify-api.line.me/api/notify`，Header: `Authorization: Bearer <token>`
- **Microsoft Teams**: Incoming Webhook，`MessageCard` 格式，severity 對應顏色

---

## 設定 UI（MonitorSettingsModal）

```
[一般設定]
  資料保留天數（各類型）: node_metrics / host_metrics / disk_metrics / online_users / health_check
  Metrics 收集間隔（分鐘）: 5（固定）

[告警閾值]
  CPU Request %: [90]%
  Memory Request %: [85]%
  CPU Load (avg/cores): [0.9]
  磁碟使用 %: [85]%
  Pod Restart 上限: [5]次
  Pod Pending 上限: [10]分鐘

[告警開關]
  Toggle: Node NotReady / Pod Crash / Resource 過載 / 磁碟不足 / NAS 掉掛 / Service 異常
  通知冷卻時間（分鐘）: [30]

[Webhook 設定]
  啟用 Webhook: [toggle]
  Webhook 類型: [LINE Notify ▼ / Microsoft Teams]
  Webhook URL / Token: [輸入框]
  [測試發送]
```

---

## 實作順序

1. DB migration：新增 host_metrics / disk_metrics / online_user_snapshots / health_checks / health_check_results / deploy_history，更新 monitor_alerts（加 severity）
2. `server/routes/monitor.js` 基本 API（nodes/pods/events/images/containers/disk/host/online-users/summary）
3. `server/services/metricsCollector.js`：每 5 分鐘收集 node + host + online，每小時 disk，每分鐘 health check
4. `server/services/webhookNotifier.js`：LINE Notify + Teams webhook 發送
5. 異常偵測邏輯整合進 metricsCollector（閾值比對 → 告警 + Email + Webhook）
6. Deploy API（SSE + git rev-parse + deploy_history INSERT）+ Container 操作 API（restart/stop/start）
7. 前端：MonitorSummaryCards + AlertBanner + NodeStatusGrid + PodTable + K8sEventsTable
8. 前端：HostMetricsPanel + DiskUsagePanel + OnlineUsersPanel + NodeMetricsChart
9. 前端：ContainerTable（含 stats inline）+ DockerImagesPanel
10. 前端：HealthChecksPanel（含新增/編輯/刪除/可用率）
11. 前端：LogViewer（SSE + 搜尋高亮 + 下載）
12. 前端：DeployPanel（SSE + 無密碼確認 modal）+ DeployHistoryTable
13. 前端：MonitorSettingsModal（閾值/保留天數/Webhook 設定）
14. AdminDashboard sidebar 整合 + 頂部異常警示 banner

---

## 驗證方式

1. Dashboard 總覽卡片即時反映節點/Pod/線上人數/磁碟/Load/告警狀態
2. 節點狀態卡片正確顯示 Ready/NotReady + resource request%
3. K8s Events 正確顯示 Warning（紅）/ Normal（灰），可按 namespace 篩選
4. 主機指標面板：Load/Mem/Net/DiskIO 數值正確，Top Processes 顯示正常
5. 磁碟面板：各 mount point 使用率正確，NAS 掉掛時顯示紅色警示
6. 線上人數：token Map 人數與面板一致，歷史折線有正確資料點
7. Container stats：docker stats 數值與 CLI 一致，restart/stop/start 正常
8. Health check：連續失敗 → 自動告警，恢復後 resolved_at 更新
9. 每 5 分鐘入庫，24h 趨勢圖有資料點，時間範圍切換正常
10. Pod log SSE 即時輸出，ERROR 紅色高亮，下載 .txt 正常
11. Deploy 不輸密碼直接確認，SSE 串流輸出，歷史紀錄正確記錄 git commit
12. Image prune 後列表刷新，dangling image 消失
13. Warning 告警只顯示 banner，Critical/Emergency 額外發 Email + Webhook
14. 同一異常 30 分鐘內不重複通知
15. 設定保留天數後，舊資料定時清除
