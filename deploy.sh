#!/bin/bash
# FOXLINK GPT — K8s 部署腳本
# 使用方式: ./deploy.sh [tag]
# 範例:     ./deploy.sh          → push latest
#           ./deploy.sh v1.2.3   → push 指定 tag

set -e

REGISTRY="10.8.93.11:5000"
IMAGE="foxlink-gpt"
TAG="${1:-latest}"
FULL_IMAGE="${REGISTRY}/${IMAGE}:${TAG}"
NAMESPACE="foxlink"
DEPLOY="foxlink-gpt"

echo "▶ Building: ${FULL_IMAGE}"
docker build -t "${FULL_IMAGE}" .

echo "▶ Pushing to registry: ${FULL_IMAGE}"
docker push "${FULL_IMAGE}"

# 同時 tag 為 latest（如果指定了特定 tag）
if [ "${TAG}" != "latest" ]; then
  docker tag "${FULL_IMAGE}" "${REGISTRY}/${IMAGE}:latest"
  docker push "${REGISTRY}/${IMAGE}:latest"
  echo "▶ Also tagged as latest"
fi

echo "▶ Rolling update (maxUnavailable=0 → 零停機)"
kubectl rollout restart deployment/${DEPLOY} -n ${NAMESPACE}
kubectl rollout status deployment/${DEPLOY} -n ${NAMESPACE}

echo ""
echo "✓ 部署完成！Image: ${FULL_IMAGE}"
echo "  kubectl get pods -n ${NAMESPACE} -o wide"
