#!/bin/bash
# FOXLINK GPT — K8s 部署腳本
# 使用方式: ./deploy.sh [tag] [--no-pull]
# 範例:     ./deploy.sh          → 用 git short hash 當 tag(預設、推薦)
#           ./deploy.sh v1.2.3   → 用指定 tag
#           ./deploy.sh latest   → 強制走 latest(legacy,不推薦)
#
# 2026-05-28 改動:預設 tag 從 `latest` 改成 git short hash。
# 原因:用 `latest` + `kubectl rollout restart` 走滾動更新時,即使 imagePullPolicy=Always,
#   有過機率拉到舊 cache(本次踩到 — pod 跑舊 image digest=890284 但 registry 上是新的)。
# 改用 immutable tag + `kubectl set image` 強制每次 deploy 都換 image reference,k8s 一定重拉。

set -e

REGISTRY="10.8.93.11:5000"
IMAGE="foxlink-gpt"
NAMESPACE="foxlink"
DEPLOY="foxlink-gpt"

# ── 先 git pull(避免 prod server 本地 source 落後 origin 害 docker build 打到舊版)
# 可用 --no-pull 旗標跳過(離線部署 / 已手動 sync 過時用)
if [ "$1" = "--no-pull" ] || [ "$2" = "--no-pull" ]; then
  echo "▶ Skipping git pull (--no-pull 旗標)"
else
  cd "$(dirname "$0")"
  if [ -d .git ]; then
    echo "▶ Pulling latest from origin/$(git rev-parse --abbrev-ref HEAD)"
    BEFORE=$(git rev-parse --short HEAD)
    git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)" || {
      echo "  ⚠️  git pull failed(衝突 / 本地未 commit?)— abort,請手動處理"
      exit 1
    }
    AFTER=$(git rev-parse --short HEAD)
    if [ "$BEFORE" = "$AFTER" ]; then
      echo "  本地已是最新 ($AFTER)"
    else
      echo "  Pulled: $BEFORE → $AFTER"
    fi
  else
    echo "  ⚠️  非 git repo,跳過 pull"
  fi
fi

# Build-time version — 同 image 全 pod 共用,client 端 /api/version polling 才會穩定
APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"

# Tag 解析:第 1 個非 --no-pull 旗標的參數當 tag;沒給就用 APP_VERSION(git hash)
# 之前預設 `latest` 害我們踩到 k8s rolling update 拉不到新 digest 的雷
TAG=""
for arg in "$@"; do
  if [ "$arg" != "--no-pull" ] && [ -z "$TAG" ]; then
    TAG="$arg"
  fi
done
TAG="${TAG:-${APP_VERSION}}"
FULL_IMAGE="${REGISTRY}/${IMAGE}:${TAG}"

# BUILD_DATE — scheduler 啟動 gate 用,擋 > 30 天的 image 跑排程(防 ghost container)
BUILD_DATE="$(date -u +%Y-%m-%d)"

echo "▶ Building: ${FULL_IMAGE}  (APP_VERSION=${APP_VERSION}, BUILD_DATE=${BUILD_DATE})"
docker build --build-arg APP_VERSION="${APP_VERSION}" --build-arg BUILD_DATE="${BUILD_DATE}" -t "${FULL_IMAGE}" .

echo "▶ Pushing to registry: ${FULL_IMAGE}"
docker push "${FULL_IMAGE}"

# 同時 tag 為 latest 維持外部兼容(其他工具還在用 :latest 引用)
if [ "${TAG}" != "latest" ]; then
  docker tag "${FULL_IMAGE}" "${REGISTRY}/${IMAGE}:latest"
  docker push "${REGISTRY}/${IMAGE}:latest"
  echo "▶ Also tagged as latest"
fi

echo "▶ Syncing K8s Secret from server/.env"
ENV_FILE="$(dirname "$0")/server/.env"
if [ -f "${ENV_FILE}" ]; then
  kubectl delete secret foxlink-secrets -n ${NAMESPACE} --ignore-not-found
  kubectl create secret generic foxlink-secrets \
    --from-env-file="${ENV_FILE}" \
    -n ${NAMESPACE}
  echo "  Secret foxlink-secrets updated"
else
  echo "  ⚠️  server/.env not found, skipping Secret sync"
fi

# ── MCP JWT key pair(RS256 X-User-Token 簽發用)───────────────────────────
# pem 是 gitignore 的,不在 image 內 → 改走 K8s Secret 掛成檔案到 /app/certs
CERTS_DIR="$(dirname "$0")/server/certs"
PRIV_KEY="${CERTS_DIR}/mcp-jwt-private.pem"
PUB_KEY="${CERTS_DIR}/foxlink-gpt-public.pem"
echo "▶ Syncing MCP JWT Secret"
if [ -f "${PRIV_KEY}" ] && [ -f "${PUB_KEY}" ]; then
  kubectl delete secret mcp-jwt-keys -n ${NAMESPACE} --ignore-not-found
  kubectl create secret generic mcp-jwt-keys \
    --from-file=mcp-jwt-private.pem="${PRIV_KEY}" \
    --from-file=foxlink-gpt-public.pem="${PUB_KEY}" \
    -n ${NAMESPACE}
  echo "  Secret mcp-jwt-keys updated (2 pem files)"
else
  echo "  ⚠️  server/certs/*.pem not found — skipping (MCP X-User-Token 功能將失效)"
  echo "      產生方式: cd server/certs && openssl genrsa -out mcp-jwt-private.pem 2048"
  echo "                openssl rsa -in mcp-jwt-private.pem -pubout -out foxlink-gpt-public.pem"
fi

# ── GCP Vertex AI Service Account JSON (Gemini 企業級認證)───────────────────
VERTEX_SA_JSON="${CERTS_DIR}/vertex-ai-sa.json"
echo "▶ Syncing GCP Vertex AI Secret"
if [ -f "${VERTEX_SA_JSON}" ]; then
  kubectl delete secret gcp-vertex-sa -n ${NAMESPACE} --ignore-not-found
  kubectl create secret generic gcp-vertex-sa \
    --from-file=key.json="${VERTEX_SA_JSON}" \
    -n ${NAMESPACE}
  echo "  Secret gcp-vertex-sa updated"
else
  echo "  ⚠️  server/certs/vertex-ai-sa.json not found — GEMINI_PROVIDER=vertex 會失敗；"
  echo "      GCP Console > IAM > Service Accounts 下載 JSON 到此路徑"
fi

echo "▶ Applying K8s manifests (RBAC, Deployment, Service...)"
kubectl apply -f "$(dirname "$0")/k8s/deployment.yaml"
kubectl apply -f "$(dirname "$0")/k8s/scheduler-deployment.yaml"

# 用 set image 強制換 image reference — 保證 k8s 拉新 image 不會用 cache
# (跟 rollout restart 的差別:後者只重啟 pod 用同 image,Always policy 有時也會用 layer cache)
echo "▶ Rolling update web (set image ${FULL_IMAGE}, maxUnavailable=0 → 零停機)"
kubectl -n ${NAMESPACE} set image deployment/${DEPLOY} ${DEPLOY}=${FULL_IMAGE}
kubectl -n ${NAMESPACE} rollout status deployment/${DEPLOY} --timeout=300s

echo "▶ Restart scheduler (set image ${FULL_IMAGE}, Recreate → 30-60s 空窗)"
kubectl -n ${NAMESPACE} set image deployment/${DEPLOY}-scheduler ${DEPLOY}-scheduler=${FULL_IMAGE}
kubectl -n ${NAMESPACE} rollout status deployment/${DEPLOY}-scheduler --timeout=300s

# 收尾:把舊 ReplicaSet 殘留的 pod 清乾淨(deployment history 留太多會撐住舊 pod)
echo "▶ Cleaning up orphan ReplicaSets(desired=0 但仍有 pod 殘留)"
for rs in $(kubectl -n ${NAMESPACE} get rs -l app=${DEPLOY} \
              -o jsonpath='{range .items[?(@.spec.replicas==0)]}{.metadata.name}{"\n"}{end}'); do
  pods=$(kubectl -n ${NAMESPACE} get pods --field-selector=status.phase=Running \
           -l app=${DEPLOY} -o name 2>/dev/null | xargs -I{} kubectl -n ${NAMESPACE} get {} \
           -o jsonpath='{.metadata.ownerReferences[0].name}{"\n"}' 2>/dev/null | grep -c "^${rs}$" || true)
  if [ "$pods" -gt 0 ]; then
    echo "  ⚠️  RS ${rs} desired=0 卻仍有 ${pods} 個 pod,刪除"
    kubectl -n ${NAMESPACE} delete rs ${rs} --wait=false 2>/dev/null || true
  fi
done

echo ""
echo "✓ 部署完成！Image: ${FULL_IMAGE}"
echo "  kubectl get pods -n ${NAMESPACE} -o wide"
echo "  kubectl -n ${NAMESPACE} get pods -l app=${DEPLOY} -o jsonpath='{range .items[*]}{.metadata.name}{\"\\t\"}{.spec.containers[0].image}{\"\\n\"}{end}'"
echo ""
echo "  ⓘ 確認所有 pod image tag 都是 ${TAG}(不是 :latest 或舊 hash)"
