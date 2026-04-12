# FOXLINK GPT — 500+ 使用者擴容規劃

> 撰寫日期:2026-04-10
> 觸發事件:本日 84 用戶在線時 ingress `limit-connections: 50` 撞牆全 503,連帶追查到多個瓶頸
> 目標:支撐 500+ 同時在線用戶,峰值 800

---

## 1. 現況快照

| 項目 | 現值 | 備註 |
|------|------|------|
| 線上用戶峰值 | ~84 | 2026-04-10 觀察 |
| K8s pods (`foxlink-gpt`) | 4 replicas | `512Mi-2Gi` RAM, `500m-2000m` CPU |
| K8s nodes | 4 (1 master + 3 workers) | flgptm01 / flgptn01-03 |
| Oracle 連線池 (`poolMax`) | ≥ 25 (per pod) | 4 pods × 25 = 100 connections |
| ingress-nginx-controller | **1 replica** ⚠️ | 30 天內已重啟 3 次 |
| ingress 限流 | 已移除 (原本 limit-connections=50) | NAT IP 全用戶共用,直接全爆 |
| `externalTrafficPolicy` | 預設 (Cluster) | client IP 被 SNAT 成 `10.244.x.x`,看不到真實 IP |
| Gemini API quota | 預設(未申請提升) | Pro 約 600 RPM/project |

---

## 2. 五個瓶頸 (依嚴重程度排序)

### 🔴 P0-A:無真實 client IP → 無法做有意義的限流

**現狀**:nginx-ingress 看到的 client IP 全部是 K8s NAT 後的 `10.244.3.0`。

**影響**:
- 任何 per-IP 的 rate limit / connection limit 都會把所有用戶當成同一人 → 加任何限流就秒爆 503(本日事件)
- DDoS / abuse 偵測完全失效
- audit log 拿不到真實來源 IP

**修法**:
```bash
kubectl patch svc -n ingress-nginx ingress-nginx-controller \
  -p '{"spec":{"externalTrafficPolicy":"Local"}}'
```

**副作用 / 風險**:
- `Local` 模式只有跑著 ingress pod 的 node 會接到流量
- 若 LoadBalancer EXTERNAL-IP `10.8.93.20` 由 MetalLB / 硬體 LB 提供,需確認 LB 知道哪個 node 有 ingress pod(MetalLB 有自動 healthcheck;硬體 LB 要手動確認)
- 沒分到流量的 node 上的 service 連線會多一跳跨 node(影響極小)

**驗證方式**:套用後從外部訪問 → 看 ingress controller log 中的 `client:` 欄是不是公司辦公室真實 IP 段(例如 10.8.x.x)。

### 🔴 P0-B:ingress controller 只有 1 replica = 單點故障

```
ingress-nginx-controller-6f6854dbb8-sf5dc   1/1     Running     3 (30d ago)
```

**Restarts=3** 代表這 30 天裡 ingress 已經掛過 3 次,每次掛掉 = 全站離線。500 用戶等級不能容忍。

**修法**:
```bash
kubectl scale deploy -n ingress-nginx ingress-nginx-controller --replicas=2
```

或更穩定的方式 — 改 ingress-nginx 的 deployment yaml 設定 `replicas: 2` + Pod anti-affinity 強制分散到不同 node。

**注意**:跑 2 個 ingress controller 會有 leader election 的考量(metric / leader-only 任務),預設設定下兩個都會接流量,沒問題。

### 🟡 P1-A:Pod 數量不夠

**估算**:
- 每個用戶的長連線:1 SSE (chat) + 1 WebSocket (feedback notify) + 偶發 polling(budget / activity / research / notifications)
- 平均每個 pod 撐 ~80 並發長連線(Express + Node.js 預設值,可調)
- 4 pods × 80 = **320 並發上限** → 500 用戶會持續壓在邊緣

**修法**:
```yaml
# k8s/deployment.yaml
spec:
  replicas: 8   # 從 4 → 8
```

**更好 — HPA 自動擴縮**:
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: foxlink-gpt
  namespace: foxlink
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: foxlink-gpt
  minReplicas: 4
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 75
```

需要先安裝 metrics-server(`kubectl get apiservice v1beta1.metrics.k8s.io` 看有沒有)。

### 🟡 P1-B:Oracle 連線池容量

[CLAUDE.md](../CLAUDE.md) 寫:`poolMax ≥ 25`(對應 3 pods)。

**估算 8 pods 場景**:
- 每 pod `poolMax = 30~40`
- 8 × 40 = **320 connections to Oracle**
- 加上其他應用、batch job → Oracle 實際 sessions 可能要開到 600+

**需要 DBA 配合**:
```sql
-- 在 Oracle 端執行(SYSDBA)
SHOW PARAMETER sessions;     -- 看現值
SHOW PARAMETER processes;

ALTER SYSTEM SET sessions=600 SCOPE=SPFILE;
ALTER SYSTEM SET processes=500 SCOPE=SPFILE;
-- 重啟 DB 才生效
```

**Server 端 `.env` 同步調整**:
```env
ORA_POOL_MAX=40
ORA_POOL_MIN=5
ORA_POOL_INCREMENT=5
```

並檢查 [server/database-oracle.js](../server/database-oracle.js) 是否真的有讀這幾個變數。

### 🟢 P2:Gemini API 速率上限

**現狀**:Google Gemini Pro 每 project 預設約 600 RPM。

**估算**:500 活躍用戶 × 平均每分鐘 1.5 次對話 = **750 RPM** → 撞 quota → 429 / fallback。

**修法**(三選一或全做):
1. **申請 quota 提升**:Google AI Studio console → quotas → request increase。提供使用情境說明,通常 1~3 工作天審核
2. **多 API key 輪詢**:server 端維護 key pool,round-robin 或 weighted distribution。需要改 [server/services/gemini.js](../server/services/gemini.js) 的 `genAI` 初始化邏輯
3. **降級策略**:預設用 Gemini Flash(quota 比 Pro 高很多),只有特定場景才用 Pro。目前 [client/src/components/ModelPicker](../client/src/components/) 已支援切換,但預設模型可調整

---

## 3. 行動清單

| 優先 | 項目 | 負責 | 預估工時 | Blocker |
|------|------|------|----------|---------|
| 🔴 P0 | `externalTrafficPolicy: Local` | DevOps | 30 min | 需確認 LB 行為 |
| 🔴 P0 | ingress controller replicas=2 | DevOps | 10 min | 無 |
| 🟡 P1 | 加裝 metrics-server | DevOps | 30 min | 無 |
| 🟡 P1 | HPA 設定(4→12 pods)| DevOps | 1 hr | 需 P1 metrics-server |
| 🟡 P1 | Oracle sessions/processes 提升 | **DBA** | 半天(含重啟) | 需 DBA 配合,挑離峰時段 |
| 🟡 P1 | `ORA_POOL_MAX` 調整 + verify | DevOps | 30 min | 需 P1 Oracle 完成 |
| 🟡 P1 | 限流改用 limit-rps(per 真實 IP) | DevOps | 20 min | 需 P0-A 完成 |
| 🟢 P2 | Gemini API quota 申請 | PM / Owner | 0(等審核 1~3 天) | 無 |
| 🟢 P2 | Gemini key pool 輪詢 | Backend Dev | 4 hr | 需多個 key |
| 🟢 P2 | Prometheus + Grafana 監控告警 | DevOps | 1 day | 無 |

---

## 4. 給 DBA 的問題清單

請 DBA 幫忙確認 / 評估:

1. **目前 Oracle 23 AI 的 sessions / processes 上限**
   ```sql
   SHOW PARAMETER sessions;
   SHOW PARAMETER processes;
   SELECT COUNT(*) FROM v$session WHERE username = 'FOXLINK_GPT';
   ```

2. **能否接受 sessions 提升到 600 / processes 到 500?**
   - 影響 SGA 記憶體配置(每 session 約佔幾百 KB)
   - 需要 DB instance 重啟,挑離峰時段(建議週六凌晨)

3. **是否需要為 foxlink_gpt 帳號建立獨立 profile / resource limit?**
   - 避免單一應用耗盡共享資源

4. **Backup / archive log 策略是否能應付更高 DML 量?**
   - 對話紀錄 / token usage 寫入頻率會 5~6 倍

5. **Connection idle timeout / dead connection detection 設定?**
   - K8s pod rolling restart 時會留下 stale conn

---

## 5. 給網管 / 系統管理員的問題清單

1. **`flgpt.foxlink.com.tw` 解析到哪個 IP?經過幾層 NAT?**
   - 確認 LoadBalancer EXTERNAL-IP `10.8.93.20` 是 MetalLB 還是硬體 LB
   - 是否經過企業 firewall / WAF?該層的 X-Forwarded-For 設定?

2. **是否能在企業 firewall 層加 rate limit / DDoS 保護?**
   - 比 K8s ingress 層更前面、更可靠

3. **`8443` 這個非標準 port 為什麼?能否改回 `443`?**
   - 8443 是現在 ingress LoadBalancer 直接暴露的 port
   - 用戶記非標準 port 不友善

4. **K8s nodes 之間的網路頻寬?**
   - 500 並發 SSE + 多 Oracle 連線會增加 east-west 流量

5. **若採用 `externalTrafficPolicy: Local`,LB 健康檢查有沒有問題?**
   - 沒跑 ingress 的 node 會回 healthCheckNodePort 的 503,LB 應該要把流量導去有 ingress 的 node

---

## 6. 風險與假設

### 風險

- **Oracle 改 sessions 需重啟 DB**:服務中斷視窗約 5~10 分鐘,需公告
- **`externalTrafficPolicy: Local` 切換**:可能造成短暫流量分布不均,觀察 10 分鐘確認
- **HPA 自動擴縮**:若 Gemini quota 沒提升,擴更多 pod 也只是更多 pod 一起 429
- **Ingress controller 從 1 → 2 replicas**:若兩個 controller 之間 leader election 設定不對,可能出現重複 metric 上報

### 假設

- 假設 K8s nodes 還有資源跑 12 pods × 2Gi RAM = 24Gi(請確認 `kubectl top nodes`)
- 假設 Oracle 23 AI 機器規格能撐 600 sessions
- 假設 Gemini API 用量不會線性,因為很多查詢會被 DIFY KB / skill cache 吸收

---

## 7. 觸發本計畫的事件記錄

**2026-04-10 約 15:00 (UTC+8)**

- 部署 `gemini.js` thoughtSignature 修復(commit `1b40839`)
- Deploy 完成後,整站全 503,admin 監控頁面看不到 K8s pod 資料
- 排查結果:**並非 deploy 失敗**,而是 ingress `limit-connections: 50` 在 84 用戶在線時撞牆
  - Pods 健康(0 restart, /api/health=200)
  - Service endpoints 正常(4 pod IPs)
  - 真正錯誤:nginx error log `limiting connections by zone "...conn", client: 10.244.3.0`
  - **client IP 全部是 K8s NAT 後的 10.244.3.0** → 全用戶共用 50 個 conn quota → 秒爆
- 緊急處理:`kubectl annotate ingress -n foxlink foxlink-gpt nginx.ingress.kubernetes.io/limit-connections-` → 服務恢復
- 永久處理:[k8s/ingress.yaml](../k8s/ingress.yaml) 移除 `limit-connections` 並加註解警告

**教訓**:在 NAT 後做 per-IP 限流是無效且危險的。必須先解決真實 client IP 可見性,再加限流。

---

## 8. 外網存取控制

### 背景

為 Webex webhook 開通對外 port 後，整站變成外網可存取。需限制為「只有 webhook 能從外網進來」。

### 架構：雙層防禦

```
外網請求 → [Ingress 層] → [Express middleware 層] → 路由
              │                    │
              │ whitelist-source-range    │ EXTERNAL_ACCESS_MODE
              │ (內網 IP only)            │ (webhook_only / full / internal_only)
              │                    │
              └─ ingress-webhook.yaml     └─ middleware/accessControl.js
                 (只開 /api/webex/webhook)    (env-driven, 可即時切換模式)
```

### 三個模式

| 模式 | 外網看網頁 | 外網打 API | Webhook | 切換方式 |
|------|-----------|-----------|---------|---------|
| `internal_only` | 403 | 403 | 403 | 改 env + restart |
| `webhook_only` | 403 | 403 | POST 放行 + HMAC 驗簽 | 改 env + restart |
| `full` | 可以 | 需 token | 放行 + HMAC | 改 env + restart |

### Env 參數

```env
EXTERNAL_ACCESS_MODE=webhook_only
INTERNAL_NETWORKS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
EXTERNAL_ALLOWED_PATHS=/api/webex/webhook
INTERNAL_ONLY_PATHS=/uploads,/api/v1
EXTERNAL_LOGIN_RATE_LIMIT=10
CORS_ALLOWED_ORIGINS=https://flgpt.foxlink.com.tw:8443
```

### `full` 模式安全措施

- `/uploads/*`, `/api/v1/*` 即使 full 模式也限內網（INTERNAL_ONLY_PATHS）
- `/api/auth/login` 有 per-IP rate limit（EXTERNAL_LOGIN_RATE_LIMIT 次/分鐘）
- 其餘 API 靠 `verifyToken` middleware 保護
- CORS 限制允許的 origin

### 前置條件

**`externalTrafficPolicy: Local` 必須先做**，否則 ingress / middleware 看到的 IP 全是 `10.244.x.x`，落在 `10.0.0.0/8` 內 → 外網流量被判定為內網 → 等於沒擋。

```bash
# 查詢現況
kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.spec.externalTrafficPolicy}'
# 若為空或 Cluster，執行：
kubectl patch svc -n ingress-nginx ingress-nginx-controller \
  -p '{"spec":{"externalTrafficPolicy":"Local"}}'
```

### 檔案清單

| 檔案 | 用途 |
|------|------|
| `server/middleware/accessControl.js` | Express middleware（主控） |
| `k8s/ingress.yaml` | 內網 ingress（whitelist-source-range） |
| `k8s/ingress-webhook.yaml` | Webhook ingress（對外，Exact path） |

---

## 9. 後續追蹤

- [ ] 跟 DBA 約討論時間 (週/日:____)
- [ ] 跟網管討論 LB / firewall 設定 (週/日:____)
- [ ] 申請 Gemini API quota 提升 (PM 負責,日期:____)
- [ ] P0 兩項 (externalTrafficPolicy + ingress replicas=2) 預定執行日:____
- [ ] HPA 上線預定日:____
- [ ] 第一次 stress test (k6 / Locust 模擬 500 用戶) 預定日:____
