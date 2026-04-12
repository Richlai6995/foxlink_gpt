# FOXLINK GPT — 500+ 使用者擴容規劃

> 撰寫日期:2026-04-10
> 觸發事件:本日 84 用戶在線時 ingress `limit-connections: 50` 撞牆全 503,連帶追查到多個瓶頸
> 目標:支撐 500+ 同時在線用戶,峰值 800

---

## 1. 現況快照

| 項目 | 現值 | 備註 |
|------|------|------|
| 線上用戶峰值 | ~84 | 2026-04-10 觀察 |
| K8s pods (`foxlink-gpt`) | 4 replicas | `768Mi-2Gi` RAM, `500m-2000m` CPU |
| K8s nodes | 4 (1 master + 3 workers) | flgptm01 / flgptn01-03 |
| Oracle 連線池 (`poolMax`) | ≥ 25 (per pod) | 4 pods × 25 = 100 connections |
| ingress-nginx-controller | 2 replicas ✅ | flgptn01 + flgptn03，已解決單點故障 |
| ingress 限流 | 已移除 (原本 limit-connections=50) | NAT IP 全用戶共用,直接全爆 |
| `externalTrafficPolicy` | **Local** ✅ | 真實 client IP 已可見（10.64.x / 192.168.x / 10.40.x） |
| 外網存取控制 | **webhook_only** ✅ | 雙層��禦：ingress whitelist + Express middleware |
| Gemini API quota | 預設(未申請提升) | Pro 約 600 RPM/project |

---

## 2. 五個瓶頸 (依嚴重程度排序)

### ✅ P0-A:無真實 client IP → 無法做有意義的限流（已解決）

> **2026-04-12 已完成** — `externalTrafficPolicy: Local` 已套用

**原始狀況**:nginx-ingress 看到的 client IP 全部是 K8s NAT 後的 `10.244.3.0`。

**已執行的修法**:
```bash
kubectl patch svc -n ingress-nginx ingress-nginx-controller \
  -p '{"spec":{"externalTrafficPolicy":"Local"}}'
```

**驗證結果**（2026-04-12）:
- ingress access log 可見真實 client IP：`10.64.152.18`、`192.168.23.12`、`10.40.130.27`
- 外網公網 IP 也可見：`111.243.21.242`、`1.169.176.49`、`1.161.190.215`
- 確認 LB 健康檢查正常，無流量中斷

### ✅ P0-B:ingress controller 只有 1 replica = 單點故障（已解決）

> **已完成** — 目前 2 replicas，分布在 flgptn01 + flgptn03，0 restarts

```
ingress-nginx-controller-688dd5d8df-5c26f   1/1   Running   0   flgptn03
ingress-nginx-controller-688dd5d8df-fww69   1/1   Running   0   flgptn01
```

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
| ✅ P0 | `externalTrafficPolicy: Local` | DevOps | 30 min | ~~需確認 LB 行為~~ 已完成 2026-04-12 |
| ✅ P0 | ingress controller replicas=2 | DevOps | 10 min | 已完成 |
| ✅ P0 | 外網存取控制（webhook_only 模式） | DevOps | 2 hr | 已完成 2026-04-12 |
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
- ~~**`externalTrafficPolicy: Local` 切換**:可能造成短暫流量分布不均~~ → 已完成,運作正常
- **HPA 自動擴縮**:若 Gemini quota 沒提升,擴更多 pod 也只是更多 pod 一起 429
- ~~**Ingress controller 從 1 → 2 replicas**~~ → 已完成,運作正常
- **`externalTrafficPolicy` 被重設風險**:若 ingress-nginx 升級或重建 service 時 `externalTrafficPolicy` 被重設為 `Cluster`,所有外網 IP 會被判定為內網（10.244.x.x ⊂ 10.0.0.0/8）→ 存取控制失效。建議將 `externalTrafficPolicy: Local` 寫入 ingress-nginx service YAML 版控

### 假設

- 假設 K8s nodes 還有資源跑 12 pods × 2Gi RAM = 24Gi — **2026-04-12 確認**:4 node 都 CPU <3%, Memory <11%,資源充足
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

> **2026-04-12 已實施完成**

### 背景

為 Webex webhook 開通對外 port（8443）後，整站變成外網可存取。需限制為「只有 webhook 能從外網進來」，同時保留未來全面開放外網的彈性。

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

| 模式 | 外網看網頁 | 外網打 API | Webhook | `/uploads` | `/api/v1` |
|------|-----------|-----------|---------|-----------|-----------|
| `internal_only` | 403 | 403 | 403 | 403 | 403 |
| `webhook_only` ← **目前** | 403 | 403 | POST 放行 + HMAC | 403 | 403 |
| `full` | 可以 | 需 token | 放行 + HMAC | **永遠 403** | **永遠 403** |

### Env 參數

```env
# ─── External Access Control ───
EXTERNAL_ACCESS_MODE=webhook_only          # internal_only | webhook_only | full
INTERNAL_NETWORKS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
EXTERNAL_ALLOWED_PATHS=/api/webex/webhook  # webhook_only 模式放行的路徑
INTERNAL_ONLY_PATHS=/uploads,/api/v1       # 即使 full 模式也永遠限內網
EXTERNAL_LOGIN_RATE_LIMIT=10               # full 模式：login 防暴力（次/分鐘/IP）

# ─── CORS ───
CORS_ALLOWED_ORIGINS=https://flgpt.foxlink.com.tw:8443
```

### 2026-04-12 實施結果

| 驗證項目 | 結果 |
|---------|------|
| 內網 `GET /api/health` | ✅ 200 |
| 外網 `POST /api/webex/webhook` | ✅ 200（放行，HMAC 驗簽保護） |
| 外網 `GET /`（網頁） | ✅ 403（擋住） |
| 外網 `GET /uploads/*` | ✅ 403（擋住） |
| 外網 `GET /api/v1/*` | ✅ 403（擋住） |
| 外網 `GET /api/webex/webhook` | ✅ 403（只允許 POST） |
| 被擋外網 IP（驗證時觀察到） | `111.243.21.242`, `1.169.176.49`, `1.161.190.215`（公網用戶，預期行為） |
| 內網用戶 IP 範圍 | `10.64.x`, `10.40.x`, `192.168.23.x`（全部正常放行） |

### `full` 模式安全措施

當未來需要全面開放外網時，`full` 模式內建以下保護：

1. **`/uploads/*`, `/api/v1/*` 永遠限內網**（`INTERNAL_ONLY_PATHS`）— 靜態檔案和 external KB API 不對外
2. **`/api/auth/login` per-IP rate limit**（`EXTERNAL_LOGIN_RATE_LIMIT` 次/分鐘）— 防暴力破解
3. **所有其他 API 需 token**（`verifyToken` middleware）— 沒登入打不了
4. **CORS origin 限制**（`CORS_ALLOWED_ORIGINS`）— 防跨站請求偽造
5. **Webex webhook HMAC 驗簽**（`crypto.timingSafeEqual`）— 不受模式切換影響

### 未來開放外網 SOP

當決定讓外網用戶直接使用網頁版時，執行以下步驟：

**1. 修改 K8s server/.env**
```bash
# 在 flgptm01 上
cd ~/foxlink_gpt
vi server/.env
# 改 EXTERNAL_ACCESS_MODE=full
# 確認 CORS_ALLOWED_ORIGINS=https://flgpt.foxlink.com.tw:8443
# 確認 EXTERNAL_LOGIN_RATE_LIMIT=10（或更嚴格）
```

**2. 修改 ingress（移除內網 whitelist）**
```bash
# 把 ingress.yaml 的 whitelist-source-range 註解掉或移除
kubectl annotate ingress -n foxlink foxlink-gpt \
  nginx.ingress.kubernetes.io/whitelist-source-range-
```

**3. 重新部署**
```bash
./deploy.sh
```

**4. 驗證**
```bash
# 從外網瀏覽器開 https://flgpt.foxlink.com.tw:8443 → 應看到登入頁
# 確認 /uploads 仍然 403
curl -sk https://flgpt.foxlink.com.tw:8443/uploads/test -w "%{http_code}"
# 確認 login rate limit（連續快速打 > 10 次應 429）
```

**5. 回滾（如果出問題）**
```bash
# 改回 webhook_only
vi server/.env  # EXTERNAL_ACCESS_MODE=webhook_only
# 加回 whitelist
kubectl annotate ingress -n foxlink foxlink-gpt \
  nginx.ingress.kubernetes.io/whitelist-source-range="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
./deploy.sh
```

### 前置條件

**`externalTrafficPolicy: Local`** — 已於 2026-04-12 確認為 `Local`，真實 client IP 可見。若此值被重設為 `Cluster`，所有外網 IP 會顯示為 `10.244.x.x`，落在 `INTERNAL_NETWORKS` 範圍內 → 等於沒擋。

```bash
# 驗證指令
kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.spec.externalTrafficPolicy}'
# 應回傳 Local
```

### 檔案清單

| 檔案 | 用途 |
|------|------|
| `server/middleware/accessControl.js` | Express middleware（主控，env-driven） |
| `k8s/ingress.yaml` | 內網 ingress（`whitelist-source-range`） |
| `k8s/ingress-webhook.yaml` | Webhook ingress（對外，`pathType: Exact`） |

---

## 9. 已知問��

### TLS 證書警告

ingress controller log 持續出現：
```
Error getting SSL certificate "foxlink/foxlink-wildcard-tls": local SSL certificate foxlink/foxlink-wildcard-tls was not found. Using default certificate
```
目前使用的 TLS secret 是 `flgpt-tls`（ingress.yaml 中設定），`foxlink-wildcard-tls` 可能是其他服務的殘留設定。不影響功能但建議排查清除。

---

## 10. 後續追蹤

### 已完成
- [x] P0-A: `externalTrafficPolicy: Local` — 2026-04-12 確認已是 Local
- [x] P0-B: ingress controller replicas=2 — 2026-04-12 確認已是 2 replicas
- [x] 外網存取控制��webhook_only 模式 + 雙層防禦）— 2026-04-12 實施完成

### 待辦
- [ ] 跟 DBA 約討論時間 (週/日:____)
- [ ] 跟網管討論 LB / firewall 設定 (週/日:____)
- [ ] 申請 Gemini API quota 提升 (PM 負責,日期:____)
- [ ] HPA 上線預定日:____
- [ ] 第一次 stress test (k6 / Locust 模擬 500 用戶) 預定日:____
- [ ] 排查 `foxlink-wildcard-tls` 證書警告
