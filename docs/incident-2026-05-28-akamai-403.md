# 2026-05-28 外網「整頁全白 / 移除失敗」事故 Postmortem

> **影響**:外網 user(經 Akamai)時好時壞 — 進站全白、刪除信任裝置失敗、部分模組載不出來。內網完全正常。
> **持續**:當天 08:00 ~ 18:00(~10 小時)
> **嚴重度**:P0(外網全公司影響)
> **修法 commits**:`817f643` `2520178` `71001d5` `f662b51` `48eeb36`

---

## TL;DR

外網報「整頁全白」+「刪除信任裝置失敗 (501)」,WAF 那邊先排除 Akamai 並把工單踢回後端。實際**三個獨立根因疊加**:

1. 後端自動 IP 黑名單把 **Akamai edge IP** 當 client IP → 同 edge 後面 10 個 user 各失敗 1 次 → 整 edge 進黑名單 24h → 該 edge 後面**全公司 user 中槍**(就是「全白」)
2. Akamai Bot Manager 預設**擋 DELETE/PUT/PATCH method** 回 501 → 任何「移除」按鈕外網都炸(就是「移除失敗」)
3. Scheduler pod 啟動 11 個 setImmediate seed 同時並發 → OOMKilled 137(這個沒影響 user,只是 alert 一直響)

修法分別 ship,並順手做三個硬化避免再撞。

---

## 一、Timeline

| 時間 | 事件 |
|---|---|
| ~08:00 | 外網 user 開始反映「整頁全白」、「部分功能載不出來」 |
| ~10:00 | WAF/Akamai 那邊抓到 4 個請求都回 25 bytes JSON / 同 etag,排除 Akamai,工單踢給後端 |
| ~14:00 | scheduler-deployment pod_crash alert 觸發(OOMKilled 12 次/10min) |
| ~15:00 | 開始追,確認 25 bytes JSON = `{"error":"Access denied"}`(accessControl middleware 回的) |
| ~15:30 | 找到根因 1:authThrottle 用 Akamai edge IP 計數 → 連坐 |
| ~16:00 | commit `2520178` ship 三層修法(True-Client-IP / UA hash / SPA static skip) |
| ~16:30 | deploy 後 user 還報「移除失敗」,但 server log 完全沒訊息 |
| ~17:00 | 抓到根因 2:user 看到 **501 Not Implemented** = Akamai 擋 DELETE method |
| ~17:15 | commit `f662b51` 加 POST alias 兜底 |
| ~17:30 | deploy 後仍失敗 → 發現 user 瀏覽器 cache 卡舊 bundle,強制清快取後 OK |
| ~18:00 | commit `48eeb36` 三個硬化 ship 完成,事故收尾 |

---

## 二、Root cause 1:Akamai edge IP 被當 client IP → 連坐黑名單

### 證據鏈

1. WAF 文件抓到 `/`、`/assets/markdown-Cx3M6Ywu.js` 等 4 個請求**全部回 25 bytes JSON、同 etag**
2. 後端搜:`{"error":"Access denied"}` = 正好 25 字元
3. 出處:[server/middleware/accessControl.js](../server/middleware/accessControl.js) — 5 條 path 全部用這串 JSON 回 403
4. DB 查 `ip_blacklist`:有 `23.51.15.12` / `23.51.15.4` — `23.51.0.0/16` = **Akamai Technologies 官方段**
5. blocked log 統計:36 次 `/api/version`、`/sw.js`、`/assets/*` 全是同 edge IP 命中黑名單

### 根因

```
client → Akamai (WAF) → nginx-ingress → pod
                            ↑
                  TRUST_PROXY=1 只信 1 跳
                  req.ip = Akamai edge IP(不是真實 user IP)
```

[server/services/authThrottle.js](../server/services/authThrottle.js) 同 IP 1 小時 ≥ 10 次失敗 → 自動加入黑名單 24 小時。

實際當天**某姓 Wu/吳 user** 在外網忘記帳號格式,試了 9 次(`wu_yan@`、`wuyan@`、`132365`、`晏式`、`Wu Yan`、`Wu_Yan`),觸發 `ipCount=10` → **整個 Akamai edge `23.51.15.12` 進黑名單 24h** → 該 edge 後面**全公司外網 user 全部 403**(連 `/` HTML 都拿不到 → 整頁全白)。Akamai 多 edge IP rotation → 不同 user 命中不同 edge → 「時好時壞」。

### 修法(commit `2520178`)

三層防線:

| 層 | 改動 | 檔案 |
|---|---|---|
| A | SPA static path 完全 skip access control(`/`、`/assets/*`、`/favicon.ico` 等) | [accessControl.js](../server/middleware/accessControl.js) `ALWAYS_ALLOWED` / `ALWAYS_ALLOWED_PREFIXES` |
| B | `getClientIp` 優先讀 `True-Client-IP` / `CF-Connecting-IP` header | [accessControl.js `getClientIp`](../server/middleware/accessControl.js) |
| C | authThrottle 失敗計數 key 從 `ip` → `ip + uaHash` 防同 IP 不同 user 連坐 | [authThrottle.js](../server/services/authThrottle.js) `uaHash()` |

### ⚠️ 部署前提

**Akamai 後台必須開「Forward True-Client-IP」behavior**(Property Manager → Behavior),否則 B 失效,只靠 A+C 兜底。

---

## 三、Root cause 2:Akamai 擋 DELETE method

### 證據鏈

1. user 報「移除失敗 (HTTP 501)」
2. `kubectl logs` 完全沒對應訊息 → request 沒到 backend
3. Express 不會自己回 501,**501 = 上游(Akamai)回的**
4. Akamai Bot Manager 預設策略視 `DELETE / PUT / PATCH` 為 API 寫入攻擊 → 直接擋

### 修法(commit `f662b51`)

兩條 route 同個 handler:
- `DELETE /api/auth/webauthn/credentials/:id` (原)
- `POST /api/auth/webauthn/credentials/:id/delete` (新 alias)
- `DELETE /api/auth/me/devices/:deviceId` (原)
- `POST /api/auth/me/devices/:deviceId/delete` (新 alias)

前端 `deleteMyCredential` / `handleRemove` 改打 POST alias。

### 治本(待 WAF 處理)

專案內**還有 ~61 個前端檔用 `api.delete`**:
```bash
grep -rl 'api\.delete\|axios\.delete' client/src | wc -l   # 61
```

目前 admin 介面多在內網用,沒踩到。一旦外網 user 編輯 admin → 全部會中。

**請 Akamai 那邊放行 `DELETE / PUT / PATCH` for `/api/*` path**。

---

## 四、Root cause 3:Scheduler OOMKilled

### 證據鏈

- `kubectl describe pod ... | grep -A5 'Last State'`:`Reason: OOMKilled / Exit Code: 137`
- 啟動 39 秒就被砍,但 idle baseline 只 230Mi(穩態沒問題,純 startup spike)
- [server/server.js](../server/server.js) 啟動序裡 11+ 個 `setImmediate(autoSeed)` 同時 fire-and-forget(helpKbSync 全量 embed、pmDashboardSeed、pmKnowledgeBaseSeed...)瞬間 RSS 破 1.5G

### 修法(commit `817f643`)

| 層 | 改動 |
|---|---|
| A | 記憶體 limit 1536Mi → **3Gi**;NODE_OPTIONS heap 1024 → **2560**([scheduler-deployment.yaml](../k8s/scheduler-deployment.yaml)) |
| B | startup seed 序列化:`queueStartupSeed` 把 6 個 autoSeed 排隊跑,delay 10s + 2s gap 給 GC([server.js](../server/server.js)) |

A + B 雙保險。

---

## 五、過程中踩到的雷(留給以後同事查)

### 雷 1:`./deploy.sh` 用 `:latest` tag,k8s 拉不到新 image

`kubectl rollout restart` + `imagePullPolicy: Always` 理論該重拉,但**registry 上 latest 對應的 manifest digest** 跟 **pod 已 cached image digest** 比對行為視 containerd 版本而定,本次踩到「pod 跑舊 image digest 但 registry 上 latest 是新的」。

**治本**:commit `48eeb36` 改 `deploy.sh` 預設用 **git short hash 當 tag** + 用 `kubectl set image` 強制換 image reference。

### 雷 2:curl manifest 拿到的是 config blob digest,不是 image digest

```bash
# ❌ 錯:這串 digest 列表第一個是 config blob,不是 image
curl -s http://10.8.93.11:5000/v2/foxlink-gpt/manifests/latest ... | grep digest

# ✅ 對:image manifest 的 digest 在 response header
curl -sI http://10.8.93.11:5000/v2/foxlink-gpt/manifests/latest \
  -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
  | grep -i docker-content-digest
```

用錯 digest 部署 → containerd 拉到 raw blob → `unexpected media type application/octet-stream` → pod 永遠 `ImagePullBackOff`。

### 雷 3:SQL DELETE ip_blacklist 不會清 Redis cache

[ipBlacklist.js `isBlacklisted`](../server/services/ipBlacklist.js) 是 cache-first;只有走 `ipBlacklist.remove()` (admin UI) 才會同步刷 cache。直接 SQL DELETE → cache 仍 BLOCKED 24h。

**治本**:commit `48eeb36` 把 BLOCKED cache TTL 從 **24h 砍到 5 分鐘**。

SOP:DB 改完 cache 想立刻生效就手動 `redis-cli DEL bl:ip:<那個IP>`,或等 5 分鐘自動。

### 雷 4:user 瀏覽器 cache 卡舊 SPA bundle

Vite 對 `/assets/*` 帶 content hash 可長 cache,但 **`index.html` 沒 hash**。瀏覽器 cache 住舊 index.html → 永遠 reference 舊 bundle hash → 即使 deploy 完仍用舊 code。

當天 user 一直「移除失敗」,真因就是這個 — backend 修了、bundle 也 build 進 image 了,但 user 端 cache 沒清。

**治本**:commit `48eeb36` server 對 `index.html` / `sw.js` / `manifest*` 設 `Cache-Control: no-store`;`/assets/*` 設 `immutable max-age=1yr`。之後 deploy user 不用手動清快取。

### 雷 5:Deploy 過程出現 orphan ReplicaSet,新舊版 pod 並存

過去多次 `set image` / `rollout undo` / `set image` 連環操作,**舊 RS 沒被 scale 到 0** → service round-robin 到新+舊 pod → user 仍有機率打到舊 code。

**治本**:commit `48eeb36` `deploy.sh` 加收尾步驟,自動偵測 desired=0 但仍有 pod 殘留的 RS 並刪掉。

---

## 六、應急 SOP(下次再遇)

### 症狀「外網 user 大量 403,內網正常」

```bash
# 1. 確認黑名單是不是把 CDN edge 當 client IP
SELECT ip, source, reason, created_at, expires_at FROM ip_blacklist
WHERE source = 'auto_failure'
  AND (expires_at IS NULL OR expires_at > SYSTIMESTAMP)
ORDER BY created_at DESC;

# 看 ip 是不是落在 Akamai 段(23.x.x.x / 104.x / 170.72.x / ...)
# 若是 → 100% 是這個事故的延伸,跑 SOP 1.1

# SOP 1.1 緊急止血
DELETE FROM ip_blacklist WHERE source='auto_failure';  -- DB
COMMIT;
# Redis 也要清(SQL DELETE 不會自動清 cache,雖然 48eeb36 後最多卡 5 分鐘)
kubectl -n foxlink exec -it deploy/redis -- sh -c \
  "redis-cli --scan --pattern 'bl:ip:*' | xargs -r redis-cli DEL"

# SOP 1.2 確認 commit 2520178 之後的 code 已 deploy(防再次連坐)
kubectl -n foxlink get pods -l app=foxlink-gpt -o jsonpath=\
  '{range .items[*]}{.spec.containers[0].image}{"\n"}{end}' | sort -u

# SOP 1.3 確認 Akamai 後台 True-Client-IP 開了
curl -sI https://flgpt.foxlink.com.tw/api/health -H 'X-Test-Probe: 1'
# 應該看到 server log [AccessControl] 拿到真實 user IP 而非 Akamai edge
```

### 症狀「外網點刪除按鈕回 501」

100% 是 Akamai 擋 method。確認:
```bash
kubectl -n foxlink logs -l app=foxlink-gpt --tail=0 -f | grep -iE "delete|webauthn"
# user 點刪除 5 秒內若 log 完全沒訊息 → request 沒到 backend → Akamai 擋 method
```

短期:後端對該 endpoint 加 POST alias(對齊 [webauthn.js](../server/routes/webauthn.js) `deleteCredentialHandler` pattern)。
長期:**請 Akamai 那邊放行 `DELETE / PUT / PATCH`**(根治)。

### 症狀「deploy 完 pod 還跑舊 image」

```bash
# 1. 比對 pod image digest 跟 registry 上 manifest 真實 digest
kubectl -n foxlink get pods -l app=foxlink-gpt -o jsonpath=\
  '{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[0].imageID}{"\n"}{end}'

curl -sI http://10.8.93.11:5000/v2/foxlink-gpt/manifests/latest \
  -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
  | grep -i docker-content-digest

# 2. 若 deploy 用的是 `./deploy.sh`(48eeb36 後預設 git hash),不該再撞
#    若還是撞,強制用 set image:
GIT_SHA=$(git rev-parse --short HEAD)
kubectl -n foxlink set image deployment/foxlink-gpt foxlink-gpt=10.8.93.11:5000/foxlink-gpt:$GIT_SHA
```

### 症狀「deploy 完 user 仍用舊 UI / 行為」

```bash
# 1. 確認 bundle 真的 build 進 image
POD=$(kubectl -n foxlink get pods -l app=foxlink-gpt -o jsonpath='{.items[0].metadata.name}')
kubectl -n foxlink exec $POD -- sh -c \
  "grep -ohE '<某個新加的字串>' /app/public/assets/*.js | head -5"

# 2. bundle 沒新字串 → docker build cache → 強制 no-cache 重 build
docker build --no-cache -t ...

# 3. bundle 有新字串 → 100% user 瀏覽器 cache
#    48eeb36 之後新 deploy 不會再撞,但舊 user 仍可能拿到 cache
#    讓 user 開無痕模式試,或清 cache(設定 → 隱私 → 清快取)
```

---

## 七、檔案 / commit 索引

| 主題 | Commit | 主要檔案 |
|---|---|---|
| Akamai edge IP 連坐黑名單(三層修法) | `2520178` | [accessControl.js](../server/middleware/accessControl.js) `getClientIp` / `ALWAYS_ALLOWED*`,[authThrottle.js](../server/services/authThrottle.js) `uaHash` |
| Akamai 擋 DELETE method | `f662b51` | [webauthn.js](../server/routes/webauthn.js) `deleteCredentialHandler`,[auth.js](../server/routes/auth.js) `revokeDeviceHandler`,[webauthn.ts](../client/src/lib/webauthn.ts),[MyDevicesModal.tsx](../client/src/components/MyDevicesModal.tsx) |
| Scheduler OOM + 4 個 ORA bug | `817f643` | [scheduler-deployment.yaml](../k8s/scheduler-deployment.yaml),[server.js](../server/server.js) `queueStartupSeed`,[research.js](../server/routes/research.js),[trainingCronService.js](../server/services/trainingCronService.js),[excelQueryJobService.js](../server/services/excelQueryJobService.js) |
| MyDevices 錯誤訊息 + 文案 | `71001d5` | [MyDevicesModal.tsx](../client/src/components/MyDevicesModal.tsx) |
| 三個硬化(cache / TTL / deploy) | `48eeb36` | [server.js](../server/server.js) SPA cache headers,[ipBlacklist.js](../server/services/ipBlacklist.js) `BLOCKED_CACHE_TTL`,[deploy.sh](../deploy.sh) |

---

## 八、教訓 / 不可重複的錯

1. **Reverse proxy / CDN 後面的服務,IP-based 限流 / 黑名單必須讀 X-Forwarded-For / True-Client-IP**,絕不能用 `req.ip` 直接擋。對前面有 N 跳 proxy 的場景 `TRUST_PROXY=N` 也不夠 — 不同 CDN/WAF 有自己的 client IP header,要顯式 prefer 那個 header。
2. **Auto-blacklist 計數至少加 UA hash**,單純 per-IP 在 CDN/NAT 後容易連坐。更安全做法是同時要求「同 username」(不要全 IP 共用 quota)。
3. **WAF / Bot Manager 預設策略多半擋 DELETE/PUT/PATCH**,部署到外網的 API 設計階段就要考慮 — 用 POST + body op 比 RESTful method 更穩,或同 endpoint 兩條 route alias。
4. **Cache TTL ≠ DB TTL**。任何「cache + DB」雙層 storage,cache 寫入時務必想清楚「DB 後續異動如何同步」。長 TTL 配上 admin SQL 直改 DB 是經典反 pattern。
5. **`:latest` tag 不適合生產**。Immutable tag(git hash / semver)+ 顯式 `kubectl set image` 才能保證每次 deploy 真的換 image。
6. **SPA `index.html` 必須 no-store**,否則 deploy 永遠有人卡在 cache 看舊版。`/assets/*` 帶 hash 可長 cache。
7. **Debug 時 server log 完全沒訊息 = request 沒到 backend**,要往上游(ingress / WAF / CDN)查,不要在 backend 內鑽。本次浪費 30 分鐘在 backend 找,後來 user 提到 501 才意識到是 method 被擋。
