# K8s 部署說明

## 部署前必做

```bash
# 1. 建立 namespace
kubectl create namespace foxlink

# 2. 從 .env 建立 secret（包含 Oracle, Gemini, SMTP 等所有設定）
kubectl create secret generic foxlink-secrets \
  --from-env-file=server/.env \
  -n foxlink

# 3. 填入實際值（搜尋 TODO）
grep -r "TODO" k8s/
```

## 部署順序

```bash
# Step 1: 儲存層
kubectl apply -f k8s/nfs-pvc.yaml        # NFS 上傳檔案 PVC

# Step 2: 基礎服務
kubectl apply -f k8s/redis.yaml          # Token store

# Step 3: 主應用
kubectl apply -f k8s/deployment.yaml     # foxlink-gpt x3

# Step 4: 對外流量
kubectl apply -f k8s/ingress.yaml        # nginx-ingress

# Step 5: 監控（選配）
kubectl apply -f k8s/uptime-kuma.yaml    # HTTP uptime monitor
kubectl apply -f k8s/loki-stack.yaml     # Log 集中 (Loki+FluentBit+Grafana)
```

## 檢查狀態

```bash
kubectl get pods -n foxlink -w
kubectl get pvc -n foxlink
kubectl logs -n foxlink -l app=foxlink-gpt --tail=100 -f
```

## TODO 清單（部署前必填）

| 檔案 | TODO 項目 |
|------|-----------|
| `nfs-pvc.yaml` | Synology NAS IP、共用資料夾路徑 |
| `deployment.yaml` | Image registry URL、Oracle client 掛載方式 |
| `ingress.yaml` | 實際域名 |
| `uptime-kuma.yaml` | 監控用域名 |
| `loki-stack.yaml` | Log 查詢域名、Grafana admin 密碼 |
