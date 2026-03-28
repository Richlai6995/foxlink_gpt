# FOXLINK GPT — K8s 部署安裝步驟（Step-by-Step）

> 日期：2026-03-19
> 基於：[deployment-plan.md](./deployment-plan.md) v1.1
> Git 備份：tag `backup-before-k8s-migration-20260319` (commit `1630bdb`)

---

---

## 〇、Oracle DB Schema 初始化（空 DB 必做）

> [!IMPORTANT]
> 新環境空 DB 必須先建表，否則 server 啟動會報錯。Schema 建立有 **兩層機制**，都是 idempotent（重複跑安全）。

### 機制說明

| 層 | 機制 | 涵蓋 | 總計 |
|----|------|------|------|
| **Layer 1** | `server/scripts/create-schema.sql` | 核心業務表（roles, users, chat, token, KB, MCP 等） | ~32 張表 + 索引 |
| **Layer 2** | `server/database-oracle.js` → `runMigrations()` | AI 戰情表、Research、Report Dashboard 等 + 欄位遷移 | ~20 張表 + 大量 `addCol` |

Layer 2 在 **server 啟動時自動執行**，不需手動跑。

### Step 1: 建立 Oracle User/Schema（DBA 執行）

```sql
-- 在 Oracle 23 AI 以 SYS 或 DBA 身份執行
CREATE USER FLGPT IDENTIFIED BY "your_password"
  DEFAULT TABLESPACE users
  TEMPORARY TABLESPACE temp
  QUOTA UNLIMITED ON users;

GRANT CONNECT, RESOURCE TO FLGPT;
GRANT CREATE VIEW, CREATE SEQUENCE, CREATE TRIGGER TO FLGPT;
-- Oracle 23 AI Vector 功能
GRANT DB_DEVELOPER_ROLE TO FLGPT;
-- Oracle Text (全文檢索 CTXSYS.CONTEXT)
GRANT CTXAPP TO FLGPT;
GRANT EXECUTE ON CTXSYS.CTX_DDL TO FLGPT;
```

### Step 2: 建立核心表（Layer 1）

有兩種方式，擇一：

**方式 A：用 Node.js 跑（推薦，需要 server/.env 設好 DB 連線）**

```bash
cd server
# 確保 .env 有以下設定：
# SYSTEM_DB_HOST=<Oracle IP>
# SYSTEM_DB_PORT=1521
# SYSTEM_DB_SERVICE_NAME=<service name>
# SYSTEM_DB_USER=FLGPT
# SYSTEM_DB_USER_PASSWORD=<password>
# ORACLE_HOME=<path to instantclient>

node scripts/run-schema.js
# 輸出 [OK] / [SKIP] / [FAIL] 每個 CREATE TABLE
# 預期：全部 OK 或 SKIP，0 FAIL
```

**方式 B：用 SQL\*Plus / SQLcl 直接跑**

```bash
sqlplus FLGPT/password@hostname:1521/service_name @server/scripts/create-schema.sql
```

### Step 3: 啟動 Server（Layer 2 自動執行）

Server 首次啟動時，`database-oracle.js` 的 `runMigrations()` 會自動：
1. 建立 AI 相關表（`AI_SCHEMA_DEFINITIONS`, `AI_SELECT_DESIGNS`, `RESEARCH_JOBS`, `AI_REPORT_DASHBOARDS` 等 ~20 張表）
2. 補齊所有 `addCol` 欄位遷移
3. 建立 Vector Index / Full-text Index
4. **Seed 預設 admin 帳號**（帳號密碼由 `.env` 的 `DEFAULT_ADMIN_ACCOUNT` / `DEFAULT_ADMIN_PASSWORD` 決定，預設 `admin` / `123456`）

> [!TIP]
> 不需要手動 INSERT seed data。Server 啟動時 `ensureDefaultAdmin()` 會自動建立 admin 帳號。
> LLM Models（Gemini 模型選單）需要在後台管理介面手動新增。

### 驗證

```bash
# 確認表已建立
sqlplus FLGPT/password@hostname:1521/service_name
SQL> SELECT COUNT(*) FROM user_tables;
-- 預期：50+ 張表
SQL> SELECT username, role, status FROM users WHERE role='admin';
-- 預期：1 筆 admin
```

---

## 一、前置作業 Checklist

> [!CAUTION]
> 以下 TODO 項目必須在部署前填入實際值，否則 apply 會失敗或行為不正確。


| # | 項目 | 負責 | 影響檔案 | 填入值 |
|---|------|------|----------|--------|
| 1 | Container Image Registry URL | DevOps | `k8s/deployment.yaml:38` | `____` |
| 2 | Synology NAS IP | 基礎設施 | `k8s/nfs-pvc.yaml:12` | `____` |
| 3 | NFS 共用資料夾路徑 | 基礎設施 | `k8s/nfs-pvc.yaml:13` | `____` |
| 4 | Oracle Instant Client 版本 (19 or 23) | 基礎設施 | `Dockerfile:34`, `k8s/deployment.yaml:58-60` | `____` |
| 5 | Oracle Client K8s 掛載方式 (NFS PVC / hostPath) | 基礎設施 | `k8s/deployment.yaml:111-119` | `____` |
| 6 | 正式域名 (app) | 網路/DNS | `k8s/ingress.yaml:19` | `____` |
| 7 | 正式域名 (monitor) | 網路/DNS | `k8s/uptime-kuma.yaml` | `____` |
| 8 | 正式域名 (logs/grafana) | 網路/DNS | `k8s/loki-stack.yaml` | `____` |
| 9 | TLS 憑證 (Let's Encrypt / 內部 CA) | 網路 | `k8s/ingress.yaml:30-33` | `____` |
| 10 | Oracle DB PROCESSES 參數（建議 150） | DBA | Oracle VM | `____` |
| 11 | Grafana admin 密碼 | DevOps | `k8s/loki-stack.yaml` | `____` |
| 12 | server/.env 檔案準備好 | 開發 | K8s Secret | `____` |

---

## 一、Git 備份（已完成 ✅）

```powershell
# 已於 2026-03-19 執行
git add -A
git commit -m "chore: backup before k8s migration 2026-03-19"
git tag backup-before-k8s-migration-20260319
git push origin master --tags
```

恢復方式：
```bash
git checkout backup-before-k8s-migration-20260319
# 或
git reset --hard backup-before-k8s-migration-20260319
```

---

## 二、專案資料夾複製到新 Server

### 2.1 需要複製的檔案

```
foxlink_gpt/                ← 整個專案根目錄
├── client/                 ← ✅ 前端原始碼（Docker build 需要）
│   ├── src/
│   ├── package.json
│   └── ...
├── server/                 ← ✅ 後端原始碼
│   ├── server.js
│   ├── database-oracle.js
│   ├── routes/
│   ├── services/
│   ├── workers/
│   ├── config/
│   ├── scripts/            ← ✅ 包含 create-schema.sql, run-schema.js
│   ├── skill_runner_template/  ← ✅ Code skill 模板
│   ├── package.json
│   └── .env                ← ✅ 環境變數（手動建立或從舊 server 複製）
├── k8s/                    ← ✅ K8s YAML 檔案
├── docs/                   ← ✅ 文件
├── Dockerfile              ← ✅ Docker 建置檔
├── docker-compose.yml      ← ✅ 本機開發用
├── .dockerignore           ← ✅
├── .gitignore              ← ✅
└── CLAUDE.md               ← ✅ 專案說明
```

### 2.2 不需要複製（gitignore 已排除）

| 資料夾/檔案 | 原因 |
|-------------|------|
| `node_modules/` | `npm install` 重新安裝 |
| `client/dist/` | Docker build 時重新產生 |
| `server/uploads/` | 舊環境上傳檔案，遷移到 NAS（見下方） |
| `server/logs/` | 舊 log，不需搬 |
| `server/system.db` | SQLite 舊資料，新環境用 Oracle |
| `fonts/` | Docker build 自動下載，或走 NAS |
| `data/` `backups/` `tmp/` | runtime 產生，不需搬 |

### 2.3 最簡複製方式

```bash
# 方式 A：直接 git clone（推薦）
git clone https://github.com/Richlai6995/foxlink_gpt.git
cd foxlink_gpt
git checkout backup-before-k8s-migration-20260319  # 或 master

# 方式 B：從舊 server 打包複製
tar czf foxlink_gpt.tar.gz \
  --exclude=node_modules \
  --exclude='client/dist' \
  --exclude='server/uploads' \
  --exclude='server/logs' \
  --exclude='server/system.db' \
  --exclude='fonts' \
  foxlink_gpt/

scp foxlink_gpt.tar.gz user@new-server:/path/to/
```

### 2.4 複製後必做

```bash
cd foxlink_gpt

# 1. 建立 server/.env（從舊環境複製或手動建立）
cp server/.env.example server/.env
# 編輯填入正確的：
#   SYSTEM_DB_HOST, SYSTEM_DB_PORT, SYSTEM_DB_USER, SYSTEM_DB_USER_PASSWORD
#   GEMINI_API_KEY, SMTP_*, DEFAULT_ADMIN_*, REDIS_URL 等

# 2. 確認 .env 不會被 commit
git status  # .env 應該被 .gitignore 排除
```

---

## 三、NAS 掛載路徑設定（YAML 修正）

### 3.1 Container 內的目錄結構

Docker image 內 `/app` 下有以下 runtime 目錄：

| Container 路徑 | 用途 | 是否需要持久化 | 掛載來源 |
|----------------|------|---------------|---------|
| `/app/uploads` | 上傳檔案 + AI 生成檔案 | ✅ **必須** | NFS PVC |
| `/app/logs` | Server log 檔案 | ✅ 建議 | NFS PVC |
| `/app/backups` | DB 備份檔 | ⚠️ 選配 | NFS PVC |
| `/app/fonts` | CJK 中文字型（PDF 生成用） | ⚠️ 選配 | NFS PVC 或 image 內建 |
| `/app/skill_runners` | Code skill 執行環境 | ✅ 建議 | NFS PVC |
| `/opt/oracle/instantclient` | Oracle Instant Client | ✅ **必須** | NFS PVC 或 hostPath |

> [!IMPORTANT]
> `/app/uploads` 是**最關鍵**的 — 如果不掛 NFS，Pod 重啟或換 Pod 上傳檔案就會消失。
> `uploads/` 下有子目錄：`tmp/`、`generated/`、`user_images/`、`shared/`、`dashboard_icons/`（server 啟動時自動建立）。

### 3.2 Synology NAS 準備

在 NAS 上建立共用資料夾結構：

```
/volume1/foxlink-gpt/       ← NAS 根目錄
├── uploads/                ← 上傳 + 生成檔案
├── logs/                   ← Server logs
├── backups/                ← DB 備份
├── fonts/                  ← 放入 NotoSansTC-Regular.ttf
├── skill_runners/          ← Code skill 執行環境
└── oracle_client/          ← Oracle Instant Client（解壓後整個目錄放這）
```

### 3.2.1 CJK 中文字型上傳到 NAS（PDF 中文需要）

> ⚠️ **重要**：若不上傳字型，PDF 輸出的中文將顯示亂碼。`/app/fonts` 掛載自 NFS `subPath: fonts`，pod 啟動時必須已有字型才能載入。

**步驟：**

```bash
# 1. 掛載 NFS source 目錄
sudo mkdir -p /mnt/flgpt-source
sudo mount -t nfs <NAS_IP>:/volume1/flgpt-source /mnt/flgpt-source
# 本環境：sudo mount -t nfs 10.8.91.215:/volume1/flgpt-source /mnt/flgpt-source

# 2. 建立 fonts 目錄並上傳字型
sudo mkdir -p /mnt/flgpt-source/fonts
sudo cp NotoSansTC-Regular.ttf /mnt/flgpt-source/fonts/

# 3. 確認
ls -la /mnt/flgpt-source/fonts/
# 應看到：NotoSansTC-Regular.ttf（約 7MB）

# 4. 卸載
sudo umount -l /mnt/flgpt-source
```

> [!TIP]
> 字型檔可從 [Google Noto Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+TC) 下載，
> 或從 server 機器 `~/NotoSansTC-Regular.ttf` 取得。

**`k8s/deployment.yaml` volumeMount 對應設定**（已設定好，確認存在即可）：

```yaml
# containers[0].volumeMounts 中應有：
- name: nfs-source
  mountPath: /app/fonts
  subPath: fonts
```

---

### 3.2.2 Oracle Instant Client 上傳到 NAS（必做）

> ⚠️ **重要**：K8s pod 在 Thin mode 下無法連接密碼格式為 10G verifier 的 Oracle 帳號（如 ERP 的 `apps` 帳號），**必須掛載 Oracle Instant Client 啟用 Thick mode**。

**步驟：**

```bash
# 1. 從管理節點掛載 NFS source 目錄
sudo mkdir -p /mnt/flgpt-source
sudo mount -t nfs <NAS_IP>:/volume1/flgpt-source /mnt/flgpt-source
# 本環境：sudo mount -t nfs 10.8.91.215:/volume1/flgpt-source /mnt/flgpt-source

# 2. 解壓 Oracle Instant Client（instantclient_19_29.zip）
unzip instantclient_19_29.zip -d /tmp/

# 3. 複製到 NFS，目錄名稱必須是 oracle_client（對應 deployment.yaml subPath）
cp -r /tmp/instantclient_19_29 /mnt/flgpt-source/oracle_client

# 4. 確認 .so 檔在正確位置（不能有多餘的子目錄層）
ls /mnt/flgpt-source/oracle_client/libclntsh.so*
# 應看到：.../oracle_client/libclntsh.so  .../oracle_client/libclntsh.so.19.1 等

# 如果解壓多一層（oracle_client/instantclient_19_29/...），需要移平：
# mv /mnt/flgpt-source/oracle_client/instantclient_19_29/* /mnt/flgpt-source/oracle_client/
# rmdir /mnt/flgpt-source/oracle_client/instantclient_19_29
```

**`k8s/deployment.yaml` volumeMount 對應設定**（已設定好，確認存在即可）：

```yaml
# containers[0].volumeMounts 中應有：
- name: nfs-source
  mountPath: /opt/oracle/instantclient
  subPath: oracle_client
```

**驗證 Thick mode 啟動成功**：

```bash
kubectl logs -n foxlink deployment/foxlink-gpt --tail=20 | grep -i "oracle\|thick"
# 應看到：[Oracle] Thick mode, libDir: /opt/oracle/instantclient
```

> **為何需要 Thick mode？**
> - Oracle 23 AI（系統 DB）使用新版密碼 verifier → Thin mode 可連
> - ERP Oracle DB 的 `apps` 帳號使用舊版 10G verifier (0x939) → 僅 Thick mode 支援
> - 另一個解法：請 DBA 執行 `ALTER USER apps IDENTIFIED BY <原密碼>;` 重新 hash（不改密碼，只升級 verifier 格式）

> [!NOTE]
> 如果有舊環境的 `uploads/` 資料要遷移，直接 `scp` 或 `rsync` 到 NAS 的 `uploads/` 即可。

### 3.3 修改 `k8s/nfs-pvc.yaml`

原檔只有一組 PV/PVC（uploads），需要擴充成多組或用同一個 NFS 根目錄：

**方案 A：單一 NFS 根目錄，用 subPath 區分（推薦，簡單）**

`nfs-pvc.yaml` 改指向 NAS 根目錄：

```yaml
# k8s/nfs-pvc.yaml — 修改這兩處
spec:
  nfs:
    server: 192.168.x.x              # ← TODO: 改為 Synology NAS IP
    path: /volume1/foxlink-gpt        # ← TODO: 改為 NAS 共用資料夾根路徑
```

### 3.4 修改 `k8s/deployment.yaml` — Volume Mounts

目前 `deployment.yaml` 只掛了 `uploads` 和 `oracle-client` 兩個 volume。需要補上其他目錄的 `subPath` 掛載：

```yaml
# k8s/deployment.yaml — containers[0].volumeMounts 區段替換為：
          volumeMounts:
            # ── 持久化資料（全部走同一個 NFS PVC，用 subPath 區分）──
            - name: nfs-storage
              mountPath: /app/uploads
              subPath: uploads
            - name: nfs-storage
              mountPath: /app/logs
              subPath: logs
            - name: nfs-storage
              mountPath: /app/backups
              subPath: backups
            - name: nfs-storage
              mountPath: /app/fonts
              subPath: fonts
            - name: nfs-storage
              mountPath: /app/skill_runners
              subPath: skill_runners
            # ── Oracle Instant Client ──
            - name: nfs-storage
              mountPath: /opt/oracle/instantclient
              subPath: oracle_client
              readOnly: true
```

```yaml
# k8s/deployment.yaml — volumes 區段替換為：
      volumes:
        - name: nfs-storage
          persistentVolumeClaim:
            claimName: foxlink-nfs-pvc    # 對應 nfs-pvc.yaml
```

> [!WARNING]
> 原 `deployment.yaml` 有兩個 volume（`uploads` + `oracle-client`），改用 `subPath` 後合併成**一個 volume `nfs-storage`**。記得把舊的 `oracle-client` volume 定義移除。

### 3.5 環境變數確認

`deployment.yaml` 中的 Oracle 環境變數需對應 NAS 的 subPath 路徑：

```yaml
            - name: ORACLE_HOME
              value: "/opt/oracle/instantclient"   # 對應 subPath: oracle_client
            - name: LD_LIBRARY_PATH
              value: "/opt/oracle/instantclient"
            - name: UPLOAD_DIR
              value: "/app/uploads"                # 對應 subPath: uploads
```

### 3.6 修改前後對照

| 項目 | 原設定 | 修改後 |
|------|--------|--------|
| NFS PV path | `/volume1/foxlink-uploads` | `/volume1/foxlink-gpt` |
| uploads 掛載 | 獨立 PVC `foxlink-nfs-pvc` | 同一 PVC + `subPath: uploads` |
| logs 掛載 | ❌ 沒掛 | 新增 `subPath: logs` |
| backups 掛載 | ❌ 沒掛 | 新增 `subPath: backups` |
| fonts 掛載 | ❌ 沒掛 | 新增 `subPath: fonts` |
| skill_runners 掛載 | ❌ 沒掛 | 新增 `subPath: skill_runners` |
| Oracle client | 獨立 PVC `foxlink-oracle-pvc` | 同一 PVC + `subPath: oracle_client` |

---

## 四、Docker Image 建置與推送

### 2.1 填入 TODO 值

先用搜尋確認所有 TODO 已填入：
```bash
grep -rn "TODO" k8s/ Dockerfile docker-compose.yml
```

### 2.2 Build Image

```bash
# 在專案根目錄執行
docker build -t <REGISTRY_URL>/foxlink-gpt:latest .
# 範例
# docker build -t harbor.foxlink.com/foxlink/foxlink-gpt:latest .
```

> [!IMPORTANT]
> Dockerfile 使用 **multi-stage build**：Stage 1 (node:20-alpine) build 前端 → Stage 2 (node:20-slim) 裝 Oracle client dependency + server。
> Oracle Instant Client **不打進 image**，而是透過 volume mount 掛入。

### 2.3 Push to Registry

```bash
docker push <REGISTRY_URL>/foxlink-gpt:latest

# 建議同時打版本 tag
docker tag <REGISTRY_URL>/foxlink-gpt:latest <REGISTRY_URL>/foxlink-gpt:20260319
docker push <REGISTRY_URL>/foxlink-gpt:20260319
```

---

## 三、K8s Cluster 準備

### 3.1 確認 K8s 環境

```bash
kubectl cluster-info
kubectl get nodes -o wide
# 驗證 3 個 worker node 都 Ready
```

### 3.2 安裝 nginx-ingress controller（若尚未安裝）

```bash
# 使用 Helm
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

### 3.3 安裝 metrics-server（kubectl top 需要）

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

---

## 四、K8s 部署（按順序執行）

### Step 0: 建立 Namespace + Secrets

```bash
# Namespace（deployment.yaml 也有定義，但先建避免 apply 其他物件時出錯）
kubectl create namespace foxlink

# 從 server/.env 建立 Secret
# ⚠️ .env 內必須包含 Oracle, Gemini API key, SMTP 等所有環境變數
kubectl create secret generic foxlink-secrets \
  --from-env-file=server/.env \
  -n foxlink

# 驗證
kubectl get secret foxlink-secrets -n foxlink -o yaml
```

### Step 1: 儲存層 — NFS PVC

```bash
kubectl apply -f k8s/nfs-pvc.yaml
# 建立 PV + PVC (uploads 共用儲存)

# 驗證
kubectl get pv foxlink-nfs-pv
kubectl get pvc foxlink-nfs-pvc -n foxlink
# STATUS 應為 Bound
```

> [!WARNING]
> 確保 Synology NAS 已啟用 NFSv4.1，且 K8s Node IP 段有 NFS 存取權限。
> Squash 設定：`No mapping`。

### Step 2: 基礎服務 — Redis（完整安裝指引）

#### 為什麼需要 Redis

多 Pod 環境下，每個 Pod 有自己的記憶體。若 token 存在 Pod 本地 `Map`，不同 Pod 之間無法共享 → 使用者登入後打到另一個 Pod 就被踢出。Redis 作為**集中式 token store**，所有 Pod 共用同一個 Redis 存取 session。

```
驗證流程：
Client → Bearer token → Pod N → Redis GET sess:<token> → 找到 → 放行
                                                        → 找不到 → 401
```

#### 2a. 部署 Redis 到 K8s

```bash
kubectl apply -f k8s/redis.yaml
```

這會建立以下資源（都在 `foxlink` namespace）：

| 資源 | 名稱 | 說明 |
|------|------|------|
| Deployment | `redis` | 1 replica，`redis:7-alpine`（~30MB image） |
| Service | `redis` | ClusterIP，port 6379（只限 cluster 內部存取） |

> [!NOTE]
> `k8s/redis.yaml` 的關鍵設定：
> - `--save ""` → **關閉持久化**（token 丟失只需重新登入，不浪費磁碟 I/O）
> - `--loglevel warning` → 減少 log 噪音
> - Memory limit `256Mi` → token 場景完全足夠（10 萬筆 token ≈ 50MB）
> - 含 `livenessProbe` + `readinessProbe` → 自動偵測 Redis 異常並重啟

#### 2b. 驗證 Redis 運行

```bash
# 確認 pod running
kubectl get pods -n foxlink -l app=redis
# 預期：redis-xxxx   1/1   Running

# 測試 Redis 回應
kubectl exec -n foxlink $(kubectl get pod -n foxlink -l app=redis -o jsonpath='{.items[0].metadata.name}') -- redis-cli ping
# 預期：PONG

# 確認 Service DNS 解析正確
kubectl run redis-test --rm -it --restart=Never --image=redis:7-alpine -n foxlink -- redis-cli -h redis ping
# 預期：PONG（確認 service name "redis" 可被解析）
```

#### 2c. App 如何連 Redis

App 透過環境變數 `REDIS_URL` 連線：

- **K8s deployment.yaml** 已設定：`REDIS_URL=redis://redis:6379`
- `redis` 即 K8s Service 名稱，K8s 內部 DNS 自動解析
- App 使用 `ioredis` library，連線參數：`connectTimeout: 3000ms`，`maxRetriesPerRequest: 2`

> [!IMPORTANT]
> `REDIS_URL` 必須在 `k8s/deployment.yaml` 的 env 區段或 `server/.env`（K8s Secret）中設定。
> 如果 `REDIS_URL` 未設定，app 會 fallback 到 in-memory Map — **多 Pod 會壞掉**。

Token 存儲格式：
| Key | Value | TTL |
|-----|-------|-----|
| `sess:<uuid>` | `{"userId":1,"username":"admin","role":"admin"}` | 8 小時（`SESSION_TTL_SECONDS` 環境變數，預設 28800） |

#### 2d. Redis 安全性設定（選配）

目前 Redis **沒有設密碼**，因為 ClusterIP Service 本身就不對外暴露。如果需要額外安全性：

**加密碼：**

```yaml
# 修改 k8s/redis.yaml 的 args
args: ["--save", "", "--loglevel", "warning", "--requirepass", "YOUR_REDIS_PASSWORD"]
```

同時更新 app 的 `REDIS_URL`：
```
REDIS_URL=redis://:YOUR_REDIS_PASSWORD@redis:6379
```

**加 NetworkPolicy（限制只有 foxlink-gpt pod 能存取）：**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: redis-access
  namespace: foxlink
spec:
  podSelector:
    matchLabels:
      app: redis
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: foxlink-gpt
      ports:
        - port: 6379
```

#### 2e. Redis 故障排除

| 問題 | 檢查 | 解法 |
|------|------|------|
| Pod 起不來 | `kubectl describe pod -n foxlink -l app=redis` | 通常是 image pull 失敗，檢查網路 |
| App 連不到 Redis | `kubectl logs -n foxlink -l app=foxlink-gpt \| grep Redis` | 確認 `REDIS_URL` 有設定，Service name 正確 |
| 登入後被踢出 | `kubectl exec -n foxlink <redis-pod> -- redis-cli keys "sess:*"` | 確認有 token；若沒有，檢查 REDIS_URL |
| Redis OOM | `kubectl exec -n foxlink <redis-pod> -- redis-cli info memory` | 調高 memory limit 或檢查是否有 TTL 沒設 |

### Step 3: 主應用 — foxlink-gpt

```bash
kubectl apply -f k8s/deployment.yaml
# 建立 Deployment (3 replicas) + ClusterIP Service
# initContainer 會等 Redis 就緒才啟動主容器

# 監控啟動過程
kubectl get pods -n foxlink -w
# 等待 3 個 pod 都 Running & Ready (1/1)

# 檢查 logs
kubectl logs -n foxlink -l app=foxlink-gpt --tail=50 -f
```

### Step 4: 對外流量 — Ingress

```bash
kubectl apply -f k8s/ingress.yaml
# 建立 Ingress + custom-headers ConfigMap

# 驗證
kubectl get ingress -n foxlink
kubectl describe ingress foxlink-gpt -n foxlink
```

### Step 5: 監控（選配，建議裝）

```bash
# Uptime Kuma
kubectl apply -f k8s/uptime-kuma.yaml

# Loki + Fluent Bit + Grafana (Log 集中)
kubectl apply -f k8s/loki-stack.yaml
```

---

## 五、部署後驗證

### 5.1 Pod 健康檢查

```bash
# 所有 pod 狀態
kubectl get pods -n foxlink -o wide

# 各 pod 的 health endpoint
for pod in $(kubectl get pods -n foxlink -l app=foxlink-gpt -o jsonpath='{.items[*].metadata.name}'); do
  echo "--- $pod ---"
  kubectl exec -n foxlink $pod -- wget -qO- http://localhost:3007/api/health
  echo
done
```

### 5.2 Ingress 端到端測試

```bash
# 從外部或 K8s node 測試
curl -v https://foxlink-gpt.your-domain.com/api/health
# 預期回傳 {"status":"ok","timestamp":...}
```

### 5.3 SSE Streaming 測試

```bash
# 確認 SSE 不被 nginx timeout 切斷
# 在瀏覽器開啟聊天頁面，送一段長訊息，觀察串流是否完整
```

### 5.4 Redis Token 驗證

```bash
# 登入系統後，檢查 Redis 內有 token
kubectl exec -n foxlink $(kubectl get pod -n foxlink -l app=redis -o jsonpath='{.items[0].metadata.name}') -- redis-cli keys "token:*"
```

### 5.5 NFS 檔案持久化測試

```bash
# 上傳一個檔案後，刪除 pod 再建立，檔案仍存在
kubectl delete pod -n foxlink <任一 foxlink-gpt pod>
# 等新 pod 起來後，檢查上傳的檔案是否還在
```

### 5.6 Oracle DB 連線確認

```sql
-- 在 Oracle VM 執行，確認 PROCESSES 設定
SELECT name, value FROM v$parameter
WHERE name IN ('processes', 'sessions');
-- 建議：PROCESSES = 150（3 pods × poolMax 25 = 75 連線 + buffer）
```

### 5.7 Resource 使用量

```bash
kubectl top pods -n foxlink
kubectl top nodes
```

---

## 六、日常維運指令

### 更新部署（Rolling Update）

```bash
# 1. Build 新 image
docker build -t <REGISTRY_URL>/foxlink-gpt:<NEW_TAG> .
docker push <REGISTRY_URL>/foxlink-gpt:<NEW_TAG>

# 2. 更新 deployment image
kubectl set image deployment/foxlink-gpt \
  foxlink-gpt=<REGISTRY_URL>/foxlink-gpt:<NEW_TAG> \
  -n foxlink

# 3. 觀察 rolling update
kubectl rollout status deployment/foxlink-gpt -n foxlink

# 或直接改 deployment.yaml 的 image tag 後 apply
kubectl apply -f k8s/deployment.yaml
```

### 回滾

```bash
kubectl rollout undo deployment/foxlink-gpt -n foxlink
kubectl rollout history deployment/foxlink-gpt -n foxlink
```

### 查看 Logs

```bash
# 即時 logs（所有 pod）
kubectl logs -n foxlink -l app=foxlink-gpt -f --tail=100

# 單一 pod
kubectl logs -n foxlink <pod-name> --tail=200

# Grafana Loki 查詢（若已安裝）
# 查 ERROR：{app="foxlink-gpt"} |= "ERROR"
```

### 擴縮容

```bash
# 手動擴容
kubectl scale deployment foxlink-gpt --replicas=5 -n foxlink

# 縮回
kubectl scale deployment foxlink-gpt --replicas=3 -n foxlink
```

### Secret 更新（.env 變更時）

> ⚠️ **重要**：K8s pod 不讀取 `server/.env` 檔案，所有環境變數只來自 K8s Secret。
> 每次 `.env` 有任何新增或修改（API Key、Model 名稱、SMTP 等），都必須同步 Secret，
> 否則 pod 會用到舊值或缺少設定（例如翻譯功能用到廢棄的 LLM model）。

**`deploy.sh` 已自動化此步驟**，每次執行 `./deploy.sh` 都會自動同步 Secret。

手動同步方式：

```bash
kubectl delete secret foxlink-secrets -n foxlink --ignore-not-found
kubectl create secret generic foxlink-secrets \
  --from-env-file=server/.env \
  -n foxlink

# 重啟 pod 讓新 secret 生效
kubectl rollout restart deployment/foxlink-gpt -n foxlink
kubectl rollout status deployment/foxlink-gpt -n foxlink
```

---

## 七、架構摘要

```
Browser (HTTPS)
       ↓
nginx-ingress (SSE timeout 3600s, body-size 160m)
       ↓
K8s Service (ClusterIP, round-robin)
  ┌──────┬──────┬──────┐
 Pod1  Pod2  Pod3          ← Node.js 3007 (stateless, 3 replicas)
  └──────┴──────┴──────┘
     ↓          ↓            ↓
 Oracle DB    Redis        NFS PVC
 (主資料)    (Token)     (uploads/)
  32GB VM   7-alpine      Synology
```

### 相關檔案對照

| 用途 | 檔案 |
|------|------|
| Docker 建置 | `Dockerfile` |
| 本機 Docker 開發 | `docker-compose.yml` |
| K8s 主應用 | `k8s/deployment.yaml` |
| Redis | `k8s/redis.yaml` |
| NFS 儲存 | `k8s/nfs-pvc.yaml` |
| Ingress | `k8s/ingress.yaml` |
| 監控 | `k8s/uptime-kuma.yaml` |
| Log 集中 | `k8s/loki-stack.yaml` |
| 部署規劃說明 | `docs/deployment-plan.md` |

---

## 九、環境參數優化（500 在線 / 100 併發）

> 設計目標：**500 人同時在線瀏覽，100 人同時發問（SSE streaming）**

### 9.1 整體資源估算

#### 流量模型

| 指標 | 估算 | 說明 |
|------|------|------|
| 同時在線 | 500 人 | 登入後 idle + 瀏覽 |
| 同時問答 | 100 人 | 同時送出訊息、等待 SSE 回應 |
| SSE 連線持續時間 | 10~60 秒 | Gemini 回覆長度不同 |
| 每次問答 DB 查詢 | 3~5 次 | session、token、message insert 等 |
| 峰值 DB 併發連線 | ~100 | 100 人 × 1 連線（pool 快速歸還） |
| 峰值 Redis ops/sec | ~200 | 每次請求 2 次（驗 token + 延長 TTL） |
| Gemini API RPM | ~100 | 遠低於 Paid Tier 3 的 30,000 RPM |

#### VM / Node 配置建議

| 元件 | 規格 | 數量 | 說明 |
|------|------|------|------|
| **K8s Worker Node** | 8 vCPU, 32GB RAM, SSD | 3 台 | 預留 headroom 給 monitoring |
| **Oracle DB VM** | 4 vCPU, 32GB RAM, SSD 1TB | 1 台 | Single Instance，PROCESSES=200 |
| **Synology NAS** | NFS 4.1, SSD cache | 1 台 | uploads + Oracle client |

> [!TIP]
> 若 Worker Node 只有 16GB RAM 也可以跑，把 Pod limit 從 2Gi 降到 1.5Gi。但 PDF/PPTX 生成是 CPU 密集，CPU 不建議低於 4 vCPU/node。

### 9.2 K8s Pod 資源與副本數

#### 修改 `k8s/deployment.yaml`

```yaml
spec:
  replicas: 4    # ← 原本 3，改為 4（500 在線需要更多 event loop headroom）
```

```yaml
          resources:
            requests:
              memory: "768Mi"     # ← 原 512Mi，提高避免 OOM kill
              cpu: "500m"
            limits:
              memory: "2Gi"       # 維持不動，PDF 生成需要
              cpu: "2000m"        # 維持不動
```

#### 為什麼 4 個 Pod？

| 場景 | 3 pods | 4 pods |
|------|--------|--------|
| 每 Pod SSE 連線 | ~33 | ~25 |
| 每 Pod 記憶體壓力 | 中 | 低 |
| Rolling Update 時可用 Pod | 最少 2 | 最少 3 |
| 單 Pod 掛掉後剩餘容量 | 50 人/pod | 33 人/pod |

> 4 pods 在 rolling update 時更安全：`maxUnavailable: 0` + `maxSurge: 1` = 永遠有 4 個可用。

### 9.3 Oracle Connection Pool

#### 修改 `server/database-oracle.js`

```js
pool = await oracledb.createPool({
  poolAlias:     'system_db',
  user:          process.env.SYSTEM_DB_USER,
  password:      process.env.SYSTEM_DB_USER_PASSWORD,
  connectString,
  poolMin:          5,       // 維持
  poolMax:          30,      // ← 原 25，提高到 30
  poolIncrement:    5,       // 維持
  poolTimeout:      60,      // 維持
  poolPingInterval: 60,      // 維持
  queueTimeout:     30000,   // ← 新增：排隊超時 30 秒（避免 hang 住）
});
```

#### 連線數計算

| 項目 | 值 | 說明 |
|------|-----|------|
| 每 Pod poolMax | 30 | |
| Pod 數 | 4 | |
| **總連線上限** | **120** | 4 × 30 |
| Oracle PROCESSES 建議 | **200** | 120 + buffer（DB 自身 + DBA 連線） |
| Oracle SESSIONS | ~230 | 自動計算 ≈ 1.1 × PROCESSES + 5 |

#### Oracle DB 調整（在 Oracle VM 執行）

```sql
-- 確認現有值
SELECT name, value FROM v$parameter WHERE name IN ('processes', 'sessions');

-- 調整（需重啟 DB）
ALTER SYSTEM SET processes=200 SCOPE=SPFILE;
-- sessions 自動計算，不需手動設
SHUTDOWN IMMEDIATE;
STARTUP;

-- 驗證
SELECT name, value FROM v$parameter WHERE name IN ('processes', 'sessions');
```

### 9.4 Redis 優化

#### 修改 `k8s/redis.yaml`

```yaml
          resources:
            requests:
              memory: "128Mi"     # 維持
              cpu: "100m"
            limits:
              memory: "512Mi"     # ← 原 256Mi，500 人同時在線 token ≈ 100MB
              cpu: "300m"         # ← 原 200m，稍微提高
```

#### Redis 記憶體估算

| 項目 | 值 |
|------|-----|
| 每個 session token 大小 | ~200 bytes |
| 500 在線 × 200 bytes | ~100 KB |
| Redis overhead (index, metadata) | ~10x |
| **估計實際用量** | **~1 MB** |
| Memory limit 512Mi | 極度充裕 |

> 開 512Mi 的原因是防止意外：若有 bug 導致 token 沒過期、或大量 scan 操作，不會 OOM。

### 9.5 nginx-ingress 優化

#### 修改 `k8s/ingress.yaml` annotations

```yaml
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/proxy-body-size: "160m"
    # ── 新增：併發連線優化 ──
    nginx.ingress.kubernetes.io/upstream-keepalive-connections: "100"   # ← 新增
    nginx.ingress.kubernetes.io/proxy-next-upstream-timeout: "5"       # ← 新增：failover 限時
    nginx.ingress.kubernetes.io/limit-connections: "50"                # ← 新增：每 IP 最大連線數
```

| 參數 | 值 | 說明 |
|------|-----|------|
| `upstream-keepalive-connections` | 100 | ingress 到 Pod 的 keepalive 連線數，減少 TCP handshake |
| `proxy-next-upstream-timeout` | 5 | Pod 不回應時，5 秒內 failover 到另一個 Pod |
| `limit-connections` | 50 | 單一 IP 最大同時連線，防止惡意佔用 |

### 9.6 Node.js 應用層

#### 環境變數（`server/.env` 或 K8s Secret）

```bash
# Node.js memory limit（配合 Pod limit 2Gi）
NODE_OPTIONS=--max-old-space-size=1536

# Session TTL（8 小時夠用，不需調）
SESSION_TTL_SECONDS=28800

# Express body size limit（已在 server.js 設 100mb，夠用）
```

> [!IMPORTANT]
> `NODE_OPTIONS=--max-old-space-size=1536` 必須設！Node.js 預設 heap 最大只有 ~1.5GB，但在 Pod limit 2Gi 的情況下，如果不設，GC 壓力大會導致 latency spike。

#### 修改 `k8s/deployment.yaml` 加入 NODE_OPTIONS

```yaml
          env:
            - name: NODE_OPTIONS
              value: "--max-old-space-size=1536"
```

### 9.7 HPA 自動擴縮容（選配）

手動 4 replicas 對 500 人已足夠。但若擔心忽然暴增，可加 HPA：

```yaml
# k8s/hpa.yaml（新創）
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: foxlink-gpt-hpa
  namespace: foxlink
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: foxlink-gpt
  minReplicas: 4
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70   # CPU 用量 > 70% 就擴
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300   # 縮容前等 5 分鐘穩定
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
```

```bash
kubectl apply -f k8s/hpa.yaml
kubectl get hpa -n foxlink -w
```

### 9.8 參數修改彙總

| 檔案 | 參數 | 原值 | 新值 | 原因 |
|------|------|------|------|------|
| `k8s/deployment.yaml` | `replicas` | 3 | **4** | 500 在線需更多 headroom |
| `k8s/deployment.yaml` | `requests.memory` | 512Mi | **768Mi** | 避免 OOM |
| `k8s/deployment.yaml` | `env.NODE_OPTIONS` | 未設定 | **`--max-old-space-size=1536`** | Node.js heap 上限 |
| `server/database-oracle.js` | `poolMax` | 25 | **30** | 100 併發 DB 查詢 headroom |
| `server/database-oracle.js` | `queueTimeout` | 未設定 | **30000** | 排隊超時保護 |
| Oracle DB | `PROCESSES` | 150 | **200** | 4 pod × 30 = 120 + buffer |
| `k8s/redis.yaml` | `limits.memory` | 256Mi | **512Mi** | 防意外 OOM |
| `k8s/redis.yaml` | `limits.cpu` | 200m | **300m** | 稍微提高 |
| `k8s/ingress.yaml` | keepalive | 未設定 | **100** | 減少 TCP overhead |
| `k8s/hpa.yaml` | — | 不存在 | **新建** | 自動擴縮容（選配） |

---

## 十、Troubleshooting

| 問題 | 檢查方式 | 解法 |
|------|----------|------|
| Pod CrashLoopBackOff | `kubectl describe pod <name> -n foxlink` | 查 Events，通常是 env 缺失或 Oracle client 找不到 |
| ImagePullBackOff | `kubectl describe pod <name> -n foxlink` | 確認 image registry URL 和 imagePullSecrets |
| PVC Pending | `kubectl describe pvc -n foxlink` | NAS IP 不對、NFS 未啟用、防火牆擋住 |
| 502 Bad Gateway | `kubectl get endpoints -n foxlink` | Pod 還沒 Ready，或 readinessProbe 失敗 |
| SSE 串流斷線 | 檢查 ingress annotation | 確認 `proxy-read-timeout: 3600` 有設定 |
| 登入後被踢出 | `redis-cli keys "token:*"` | 確認 REDIS_URL 正確、Redis pod 是否 Running |
| 上傳檔案消失 | `kubectl exec -n foxlink <pod> -- ls /app/uploads` | 確認 NFS PVC 有正確 mount |
| Oracle 連線耗盡 | Oracle: `SELECT count(*) FROM v$session;` | 調大 PROCESSES，或降低 poolMax |
| Pods 跑舊 image | `sudo ctr -n k8s.io images list \| grep foxlink` 比對 SHA | Worker 沒收到新 image，重新執行第十一節推送流程 |
| Skill Runner 重啟消失 | pod log: `Failed to restore skill` | 後台 → 技能管理 → 重新儲存代碼；或配置 skill_runners PVC |

---

## 十一、程式版本更新流程（Local Registry）

> **採用 Local Registry 方式**：flgptm01:5000 作為內部 image registry。
> 一次性設定完成後，每次更版只需 `./deploy.sh`，約 1 分鐘，零停機。
>
> **已驗證環境**（2026-03-21）

### 11.1 環境節點 IP 對照

| 節點 | IP | 角色 |
|------|-----|------|
| flgptm01 | 10.8.93.11 | Control Plane（kubectl / docker build / registry） |
| flgptn01 | 10.8.93.12 | Worker |
| flgptn02 | 10.8.93.13 | Worker + Ingress（https://flgpt.foxlink.com.tw:8443） |
| flgptn03 | 10.8.93.14 | Worker |

> Worker node 只有 containerd，**沒有 docker CLI**。

---

### 11.2 一次性初始設定（新環境必做）

#### Step 1：設定 fldba 免密碼 sudo（所有 worker，SSH 逐台執行）

> **為什麼要做**：後續所有 containerd / systemctl 操作需要 sudo，非互動式 SSH 無法輸入密碼。

分別 SSH 到每個 worker，各執行一次：

```bash
# SSH 到 flgptn01
ssh fldba@10.8.93.12
echo "fldba ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/fldba
exit

# SSH 到 flgptn02
ssh fldba@10.8.93.13
echo "fldba ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/fldba
exit

# SSH 到 flgptn03
ssh fldba@10.8.93.14
echo "fldba ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/fldba
exit
```

#### Step 2：在 flgptm01 啟動 Local Registry

```bash
# 啟動 registry container（永久 restart，資料存於 /opt/registry）
docker run -d \
  -p 5000:5000 \
  --restart=always \
  --name registry \
  -v /opt/registry:/var/lib/registry \
  registry:2

# 確認啟動
curl http://localhost:5000/v2/_catalog
# 預期：{"repositories":[]}
```

#### Step 3：設定 flgptm01 docker 允許 insecure registry

> docker push 預設用 HTTPS，本地 registry 是 HTTP，需明確允許。

```bash
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "insecure-registries": ["10.8.93.11:5000"]
}
EOF

sudo systemctl restart docker

# 確認 registry container 還在（docker 重啟後 container 自動起來）
docker ps | grep registry
```

#### Step 4：設定每個 Worker 的 containerd insecure registry

> Step 1 完成（免密碼 sudo）後，可從 flgptm01 一次對三台執行。

```bash
for node_ip in 10.8.93.12 10.8.93.13 10.8.93.14; do
  echo "=== Configuring $node_ip ==="
  ssh fldba@${node_ip} "
    # 建立 hosts.toml（告訴 containerd 這個 registry 用 HTTP）
    sudo mkdir -p /etc/containerd/certs.d/10.8.93.11:5000
    sudo tee /etc/containerd/certs.d/10.8.93.11:5000/hosts.toml > /dev/null <<'EOF'
server = \"http://10.8.93.11:5000\"
[host.\"http://10.8.93.11:5000\"]
  capabilities = [\"pull\", \"resolve\"]
  skip_verify = true
EOF

    # 產生完整 containerd config.toml（預設可能不存在）
    sudo containerd config default | sudo tee /etc/containerd/config.toml > /dev/null

    # 設定 config_path 讓 containerd 讀取 certs.d
    sudo sed -i 's|config_path = \"\"|config_path = \"/etc/containerd/certs.d\"|' /etc/containerd/config.toml

    # 重啟 containerd 套用設定
    sudo systemctl restart containerd
    echo 'done: '\$HOSTNAME
  "
done
```

確認設定正確：

```bash
for node_ip in 10.8.93.12 10.8.93.13 10.8.93.14; do
  echo "=== $node_ip ==="
  ssh fldba@${node_ip} "
    grep config_path /etc/containerd/config.toml
    cat /etc/containerd/certs.d/10.8.93.11:5000/hosts.toml
  "
done
```

#### Step 5：設定 deploy.sh 執行權限

> `git clone` 後 shell script 預設沒有執行權限，必須手動設定，否則 `./deploy.sh` 會報 `Permission denied`。

```bash
cd ~/foxlink_gpt
chmod +x deploy.sh
```

若要讓 git 記住這個權限（避免其他環境 clone 後又要重設）：

```bash
# 在開發機（Windows/Mac）執行一次即可
git update-index --chmod=+x deploy.sh
git commit -m "chore: set deploy.sh executable"
git push
```

#### Step 6：Build 並 Push 初始 image

```bash
# 在 flgptm01
cd ~/foxlink_gpt
docker build -t 10.8.93.11:5000/foxlink-gpt:latest .
docker push 10.8.93.11:5000/foxlink-gpt:latest

# 確認 registry 有收到
curl http://10.8.93.11:5000/v2/foxlink-gpt/tags/list
# 預期：{"name":"foxlink-gpt","tags":["latest"]}
```

#### Step 7：套用 deployment.yaml 並確認 rollout

```bash
cd ~/foxlink_gpt
git pull
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/foxlink-gpt -n foxlink
# 等待：deployment "foxlink-gpt" successfully rolled out
```

---

### 11.3 日常程式更版流程

**每次更版只需三行：**

```bash
ssh fldba@10.8.93.11
cd ~/foxlink_gpt && git pull && ./deploy.sh
```

`deploy.sh` 自動執行：
1. `docker build` → 新 image
2. `docker push` → 推到 10.8.93.11:5000
3. `kubectl rollout restart` → K8s 從 registry pull 新 image，rolling update（零停機）
4. `kubectl rollout status` → 等待所有 pod 更新完成

---

### 11.4 常用 kubectl 指令

```bash
# 查看所有 pod 狀態與所在 node
kubectl get pods -n foxlink -o wide

# 查看 pod 啟動 log（確認版本）
kubectl logs -n foxlink $(kubectl get pod -n foxlink -l app=foxlink-gpt \
  -o jsonpath='{.items[0].metadata.name}') --tail=30

# 查看 pod 異常原因
kubectl describe pod <pod-name> -n foxlink | tail -20

# 查看 node IP
kubectl get nodes -o wide

# 查看 rollout 歷史
kubectl rollout history deployment/foxlink-gpt -n foxlink

# 查看 registry 中的 image tag
curl http://10.8.93.11:5000/v2/foxlink-gpt/tags/list
```

---

### 11.5 Troubleshooting — Image Pull 失敗

| 錯誤訊息 | 原因 | 解法 |
|----------|------|------|
| `http: server gave HTTP response to HTTPS client`（flgptm01） | docker daemon 未設定 insecure registry | 執行 Step 3 |
| `http: server gave HTTP response to HTTPS client`（worker pod） | containerd 未設定 hosts.toml 或 config_path | 執行 Step 4 |
| `sudo: a terminal is required` | fldba 未設定免密碼 sudo | 執行 Step 1 |
| `NAME_UNKNOWN: repository name not known` | image 未 push 到 registry | 執行 Step 5 |

---

### 11.6 Skill Runner 在 K8s 的注意事項

K8s pod 的 filesystem 是 ephemeral，每次 pod 重啟後 `skill_runners/<id>/user_code.js` 消失。
（目前 `pvc-flgpt-source` 的 `skill_runners` subPath 已掛載，重啟後應保留。）

若 skill 仍失效，手動復原：後台 → 技能管理 → 找到 Code Runner 技能 → 點「儲存代碼」。

---

---

## 十二、系統監控模組部署

系統監控功能需要額外的 K8s RBAC 權限與 Docker Socket 掛載，相關資源已寫入 `k8s/deployment.yaml`。

### 12.1 已包含的 K8s 資源

| 資源類型            | 名稱                    | 用途                                               |
|--------------------|-------------------------|---------------------------------------------------|
| ServiceAccount     | `foxlink-gpt`           | Pod 身份，用於存取 K8s API                          |
| ClusterRole        | `foxlink-gpt-monitor`   | 唯讀權限：nodes / pods / events / namespaces + pods/log |
| ClusterRoleBinding | `foxlink-gpt-monitor`   | 綁定 SA 到 ClusterRole                             |

### 12.2 Deployment 中的監控設定

- **`serviceAccountName: foxlink-gpt`** — K8s 自動掛載 token 到 `/var/run/secrets/kubernetes.io/serviceaccount/`，程式透過 K8s API 讀取 nodes/pods/events
- **Docker Socket Volume Mount** — `/var/run/docker.sock`（readOnly），用於監控 Docker 容器與映像

### 12.3 首次啟用監控的部署步驟

```bash
# 1. 先 build 新 image（含監控程式碼）
cd ~/foxlink_gpt
git pull && ./deploy.sh

# 2. Apply deployment.yaml（含 RBAC + 新 volume mount）
kubectl apply -f k8s/deployment.yaml

# 3. 重啟讓新 SA 和 volume 生效
kubectl rollout restart deployment foxlink-gpt -n foxlink

# 4. 確認 rollout 完成
kubectl rollout status deployment/foxlink-gpt -n foxlink
```

> [!NOTE]
> 順序很重要：先 `deploy.sh` build 新 image，再 `kubectl apply` 套用 RBAC 與 volume，最後 `rollout restart` 讓 pod 用新 SA 啟動。

### 12.4 監控功能說明

| 功能區塊           | 資料來源                              | 前置條件                        |
|-------------------|--------------------------------------|--------------------------------|
| K8s Nodes         | K8s API `/api/v1/nodes`              | ServiceAccount RBAC            |
| K8s Pods          | K8s API `/api/v1/pods`               | ServiceAccount RBAC            |
| K8s Events        | K8s API `/api/v1/events`             | ServiceAccount RBAC            |
| Pod Logs          | K8s API `/api/v1/namespaces/{ns}/pods/{pod}/log` | ServiceAccount RBAC |
| Docker Containers | Docker Socket API `/containers/json` | `/var/run/docker.sock` 掛載    |
| Docker Images     | Docker Socket API `/images/json`     | `/var/run/docker.sock` 掛載    |
| 主機指標          | `/proc/loadavg`, `/proc/meminfo` 等  | Linux 容器（自動可用）          |
| 磁碟 / NAS        | `df -h` 指令                         | Linux 容器（自動可用）          |
| 線上人數          | Redis session 列舉                   | Redis（自動可用）               |

### 12.5 注意事項

- **不需要安裝 kubectl CLI**：程式自動讀取 service account token 直接呼叫 K8s API
- **containerd 環境**：Worker node 若使用 containerd（非 dockerd），`/var/run/docker.sock` 不存在，Docker 區塊會顯示空資料（不報錯）
- **磁碟監控**：容器內 `df` 顯示容器視角的檔案系統，包含 overlay（根目錄）與 NFS 掛載
- **工具不可用時**：所有監控 API 採用 soft-fail 設計，工具不可用時返回空資料而非 500 錯誤

---

## 第十三節：Webex Bot 整合部署

### 13.1 事前準備

1. 至 [Webex Developer Portal](https://developer.webex.com/my-apps) 建立 Bot，取得 **Bot Access Token**
2. 確認 `https://flgpt.foxlink.com.tw:8443` 可從公網存取（Webex webhook 需要回撥）

### 13.2 設定環境變數

在 `server/.env` 中新增（或 K8s Secret）：

```env
# Webex Bot
WEBEX_BOT_TOKEN=<Bot Access Token>
WEBEX_WEBHOOK_SECRET=<自定任意字串，用於 HMAC-SHA1 驗簽>
WEBEX_PUBLIC_URL=https://flgpt.foxlink.com.tw:8443
```

若使用 K8s Secret 管理：

```bash
kubectl create secret generic foxlink-gpt-secret \
  --from-literal=WEBEX_BOT_TOKEN=<token> \
  --from-literal=WEBEX_WEBHOOK_SECRET=<secret> \
  -n foxlink --dry-run=client -o yaml | kubectl apply -f -
```

### 13.3 部署新版本

```bash
# 1. 拉最新程式碼並 build image
git pull && ./deploy.sh

# 2. 確認新端點可達（回應 200 表示 route 已載入）
curl -X POST https://flgpt.foxlink.com.tw:8443/api/webex/webhook \
  -H "Content-Type: application/json" -d '{}'
```

### 13.4 登記 Webhook（一次性，部署後執行一次）

```bash
cd /home/fldba/foxlink_gpt/server
npm install                          # 確保 axios、form-data 已安裝
node scripts/registerWebhook.js
```

預期輸出：

```
🔍 查詢現有 webhooks...
   找到 0 個 webhook
➕ 建立 webhook → https://flgpt.foxlink.com.tw:8443/api/webex/webhook

✅ Webhook 建立成功！
   ID:         Y2lzY29zcGFyazovL...
   Name:       FOXLINK GPT Webhook
   Target URL: https://flgpt.foxlink.com.tw:8443/api/webex/webhook
   Status:     active

🤖 Bot 資訊：
   名稱: Foxlink GPT Service
   Email: Foxlink_GPT_Service@webex.bot
```

> [!NOTE]
> 每次 `WEBEX_PUBLIC_URL` 變更（如換 domain 或 port）時需重新執行此腳本，舊 webhook 會自動刪除並重建。

### 13.5 驗證測試

在 Webex 搜尋 Bot Email（`Foxlink_GPT_Service@webex.bot`）開啟 DM，依序測試：

| 指令 | 預期回應 |
|---|---|
| `?` | 列出該帳號授權的工具清單 |
| `/help` | 顯示使用說明 |
| `/new` | 開啟新對話，清除記憶 |
| 一般問題 | AI 回答（簡化格式） |

### 13.6 Log 監控

```bash
# 查看 Webex 相關 log
kubectl logs -f deployment/foxlink-gpt -n foxlink | grep "\[Webex\]"
```

正常運作時的 log 範例：

```
[Webex] DM from alice@foxlink.com room=Y2lzY29z...
[Webex] User resolved: id=42 name=Alice
[Webex] Session reused: 3fa85f64-5717-4562-b3fc-2c963f66afa6
[Webex] Calling AI model=gemini-3-pro-preview user=alice session=... tools=5
[Webex] AI response generated: 342 chars
```

### 13.7 DB Migration

首次啟動新版本時，`runMigrations()` 會自動執行：

```sql
ALTER TABLE CHAT_SESSIONS ADD WEBEX_ROOM_ID VARCHAR2(200);
```

無需手動操作。

### 13.8 注意事項

- **Email 正規化**：Webex 帳號為 `@foxlink.com`，LDAP 帳號可能為 `@foxlink.com.tw`，系統自動對應，不分大小寫
- **未知 email**：非系統用戶發訊時，Bot 回覆拒絕訊息並要求聯絡管理員
- **群組 Room**：需 @Bot 才觸發，群組 session 永久保存（不按日切割）
- **DM Session**：每日自動新 session，同一天的對話共用記憶
- **檔案上傳**：依各用戶 DB 設定的 `allow_*_upload` / `*_max_mb` 限制
- **Webhook Secret**：務必設定 `WEBEX_WEBHOOK_SECRET`，否則任何人可偽造 webhook 呼叫

---

*文件產出日期：2026-03-19 | 更新：2026-03-29（新增第十三節：Webex Bot 整合部署）*
*Git tag: `backup-before-k8s-migration-20260319`*
