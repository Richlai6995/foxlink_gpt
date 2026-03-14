# FOXLINK GPT — K8s 正式環境部署規劃書

> 版本：v1.0
> 日期：2026-03-14
> 狀態：討論完成，待實作

---

## 一、環境規格

| 項目 | 規格 |
|------|------|
| K8s Worker Node | 3 台，Linux x86，SSD，RAM 64GB/台 |
| 檔案儲存 | Synology NAS，NFS 協定 |
| 資料庫 | Oracle 23 AI，獨立 VM，SSD 2TB，RAM 32GB，Single Instance |
| 快取層 | Redis（新增，K8s 內部 Pod） |
| 預估同時在線 | 200~300 人 |
| 預估同時送訊息 | 100 人 |
| Gemini API | Google Cloud Vertex AI，Paid Tier 3 |

---

## 二、Gemini API Quota 評估

### 結論：**不是瓶頸，無需限流機制**

| Quota 項目 | 限制值 | 需求估算 | 狀態 |
|------------|--------|----------|------|
| Online prediction requests/min (us-central1) | 30,000 RPM | ~100 RPM | ✅ 充裕 |
| Generate content input tokens/min per model | 4,000,000 TPM | ~50,000 TPM | ✅ 充裕 |
| Request limit per day (gemini-3-flash) | 無限制 | — | ✅ |
| Concurrent streaming | 包含在 RPM 內 | — | ✅ |

> **注意**：Quota 頁面有兩個 API，確認使用的是 **Vertex AI API**（非 cloudaicompanion.googleapis.com）

---

## 三、架構設計

### 3.1 整體架構圖

```
Browser (HTTPS)
       ↓
nginx-ingress
  ├── proxy-buffering: off
  ├── proxy-read-timeout: 3600s
  ├── proxy-send-timeout: 3600s
  ├── proxy-body-size: 60m
  └── proxy-http-version: 1.1
       ↓
K8s Service (round-robin)
  ┌──────┬──────┬──────┐
 Pod1  Pod2  Pod3          ← Node.js (stateless, 3 replicas)
  └──────┴──────┴──────┘
     ↓          ↓            ↓
 Oracle DB    Redis        NFS PVC
 (主資料)    (Token)     (uploads/)
  32GB VM   Alpine        Synology
```

### 3.2 各元件說明

| 元件 | 用途 | 備註 |
|------|------|------|
| Node.js Pod × 3 | API Server + SSE Streaming | Stateless，token 不存本地 |
| Oracle DB | 所有業務資料 | Single Instance，獨立 VM |
| Redis | Auth Token Store | 無 persistence，TTL 管理 |
| Synology NAS (NFS) | 上傳檔案、生成檔案 | ReadWriteMany PVC |
| nginx-ingress | 反向代理、TLS 終止 | SSE 特殊設定必須配置 |

---

## 四、致命問題與解法

### 4.1 🔴 In-memory Token Store（必修）

**問題**：現有 `routes/auth.js` 將 token 存在 server process 記憶體的 `Map` 中。3 個 Pod 各自獨立記憶體，用戶請求打到不同 Pod 時 token 找不到 → 強制登出。

**解法**：Token 改存 Redis

```
驗證流程：
Client → Bearer token → Pod N → Redis GET token → 找到 → 放行
                                               → 找不到 → 401
```

Redis Token 設定：
- Key：`token:<uuid>`
- Value：`{ userId, username, role }`
- TTL：與現有 session 過期時間一致（建議 8 小時）

### 4.2 🔴 SSE 長連接被 nginx 切斷（必修）

**問題**：nginx-ingress 預設 timeout 60 秒，Gemini 長回答 + SSE streaming 超過 60 秒直接斷線。

**解法**：nginx-ingress Annotation

```yaml
annotations:
  nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
  nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
  nginx.ingress.kubernetes.io/proxy-buffering: "off"
  nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
  nginx.ingress.kubernetes.io/proxy-body-size: "60m"
```

### 4.3 🔴 檔案存在 Container 本地路徑（必修）

**問題**：`uploads/` 目前在 container 本地，Pod 重啟或換 Pod → 檔案消失。

**解法**：NFS PVC 掛載（見第六節）

---

## 五、Oracle Connection Pool 調整

**現狀**（[server/database-oracle.js:244](../server/database-oracle.js#L244)）：
```js
poolMin: 2, poolMax: 10, poolIncrement: 2
```

**問題**：3 pods × 10 = 30 條連線，高峰期不足。

**調整後**：
```js
poolMin:          5,
poolMax:          25,   // 3 pods × 25 = 75 條總連線
poolIncrement:    5,
poolTimeout:      60,
poolPingInterval: 60,   // 避免 idle 連線被 Oracle 斷掉
```

**Oracle DB 參數確認**（需在 Oracle VM 執行）：
```sql
SELECT name, value FROM v$parameter
WHERE name IN ('processes', 'sessions');
```
建議設定：`PROCESSES = 150`，`SESSIONS` 自動計算約 170。

---

## 六、Synology NFS + K8s PVC 設定

### 6.1 Synology DSM 設定
1. 控制台 → 檔案服務 → NFS → 啟用 **NFSv4.1**
2. 建立共用資料夾（例：`/volume1/foxlink-uploads`）
3. 編輯共用資料夾權限 → 加入 K8s Node IP 段
4. Squash 設定：`No mapping`（保留 UID 對應）

### 6.2 K8s YAML

```yaml
# PersistentVolume
apiVersion: v1
kind: PersistentVolume
metadata:
  name: foxlink-nfs-pv
spec:
  capacity:
    storage: 500Gi
  accessModes:
    - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  nfs:
    server: 192.168.x.x        # Synology IP（部署時填入）
    path: /volume1/foxlink-uploads
  mountOptions:
    - nfsvers=4.1
    - hard
    - timeo=600
    - retrans=3
    - noatime
---
# PersistentVolumeClaim
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: foxlink-nfs-pvc
  namespace: foxlink
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 500Gi
  volumeName: foxlink-nfs-pv
---
# Deployment volumeMounts 片段
volumes:
  - name: uploads
    persistentVolumeClaim:
      claimName: foxlink-nfs-pvc
containers:
  - name: foxlink-gpt
    volumeMounts:
      - name: uploads
        mountPath: /app/uploads
```

---

## 七、Redis 部署（K8s 內部）

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: foxlink
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          args: ["--save", "", "--loglevel", "warning"]
          ports:
            - containerPort: 6379
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "200m"
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: foxlink
spec:
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
```

> **重要**：`--save ""` 關閉 persistence，token 丟失只需重新登入，不需要磁碟持久化。

---

## 八、Node.js Pod 資源設定

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "2000m"
```

> CPU limit 設 2000m（2 核）是因為 pdfkit / pptxgenjs 是同步 CPU 密集操作，limit 太低會造成生成超時。

---

## 九、Graceful Shutdown（SSE 連線保護）

### 9.1 K8s Deployment 設定

```yaml
spec:
  terminationGracePeriodSeconds: 60
  containers:
    - name: foxlink-gpt
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 15"]
```

### 9.2 Node.js server.js 修改

```js
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM received, closing gracefully...');
  server.close(async () => {
    try {
      await pool.close(10); // Oracle pool 10s 超時
    } catch (e) {}
    process.exit(0);
  });
  // 55 秒強制退出保底（K8s grace period 60s）
  setTimeout(() => {
    console.error('[Shutdown] Force exit after timeout');
    process.exit(1);
  }, 55000);
});
```

### 9.3 Rolling Update 流程

```
K8s 送 SIGTERM
  → preStop sleep 15s（ingress 先把新流量導到其他 Pod）
  → server.close() 停止接受新連線
  → 等現有 SSE 串流自然完成
  → Oracle pool 關閉 → process.exit(0)
  → K8s 確認 Pod 終止，啟動新版本 Pod
```

---

## 十、K8s Health Check

### 10.1 需新增 API 端點

`server/routes/health.js`（新增）：
```js
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});
```

### 10.2 Deployment Probe 設定

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3001
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/health
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 2
```

---

## 十一、監控與告警

### 方案：Uptime Kuma（輕量，無需 Prometheus）

- 每 60 秒 HTTP check ingress endpoint
- 異常時發送通知（支援 Email / Teams / Slack / Line Notify）
- 自帶 uptime dashboard
- Docker 單行啟動

```bash
docker run -d --restart=always \
  -p 3100:3001 \
  -v uptime-kuma:/app/data \
  --name uptime-kuma \
  louislam/uptime-kuma:latest
```

監控項目建議：
| 監控目標 | 類型 | 頻率 |
|----------|------|------|
| FOXLINK GPT 首頁 | HTTP | 60s |
| /api/health | HTTP | 30s |
| Oracle DB（TCP） | TCP port | 60s |
| Redis（TCP） | TCP port | 60s |
| Synology NAS | HTTP/TCP | 60s |

### K8s 內建（不需額外安裝）

- `kubectl get pods -n foxlink -w` — 即時觀察 Pod 狀態
- `kubectl top pods -n foxlink` — CPU/Memory 使用量（需 metrics-server）
- Liveness Probe 失敗 → 自動重啟（不需人工介入）

---

## 十二、Log 集中化

### 方案：Grafana Loki + Fluent Bit（輕量 Log Stack）

```
Pod1 stdout/stderr ──┐
Pod2 stdout/stderr ──┼── Fluent Bit (DaemonSet) ──→ Loki ──→ Grafana
Pod3 stdout/stderr ──┘
```

| 元件 | 功能 | 記憶體用量 |
|------|------|-----------|
| Fluent Bit | Log 收集（每個 Node 跑一個） | ~50MB |
| Loki | Log 儲存與索引 | ~200MB |
| Grafana | 查詢介面 | ~200MB |

查詢語法範例：
```
{app="foxlink-gpt"} |= "ERROR"
{app="foxlink-gpt"} | json | level="error" | line_format "{{.msg}}"
```

---

## 十三、已知風險與暫緩項目

| 風險 | 說明 | 建議 |
|------|------|------|
| Node.js event loop blocking | pdfkit/pptxgenjs 同步 CPU 操作 | 上線觀察，必要時改用 worker_threads |
| Synology NFS 高並發 I/O | 多人同時上傳大檔時延遲 | 監控 NFS latency，必要時調整 rsize/wsize |
| Oracle Single Instance SPOF | DB 掛掉全系統不可用 | 評估 Oracle Data Guard（後期） |
| HPA 未設定 | 固定 3 replica | 觀察 CPU 用量後再決定是否啟用 |

---

## 十四、實作優先順序

| 優先 | 項目 | 說明 |
|------|------|------|
| 🔴 P0 | Token store 改 Redis | 多 Pod 必須解決 |
| 🔴 P0 | nginx-ingress SSE timeout 設定 | 上線前必須設定 |
| 🔴 P0 | uploads 改掛 NFS PVC | 上線前必須設定 |
| 🟡 P1 | Oracle pool 調整 poolMax: 25 | 一行修改 |
| 🟡 P1 | Graceful shutdown SIGTERM handler | Rolling update 保護 |
| 🟡 P1 | /api/health endpoint + K8s probe | Pod 自動重啟機制 |
| 🟢 P2 | Uptime Kuma 部署 | 上線後監控 |
| 🟢 P2 | Loki + Fluent Bit log 集中 | 上線後 debug 用 |
| 🟢 P3 | worker_threads 檔案生成 | 視 CPU 負載決定 |
| 🟢 P3 | Oracle Data Guard | 後期 HA 評估 |

---

*文件由 Claude Code 協助產出，最終架構決策請與基礎設施團隊確認。*
