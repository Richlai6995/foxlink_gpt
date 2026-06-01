#!/usr/bin/env bash
# K8s 異常 Pod 自動採證
# 用法:crontab 每 5 分鐘跑一次,偵測到 foxlink-gpt pod CPU 超標就 dump 完整證據
#
# 安裝:
#   chmod +x ~/foxlink_gpt/scripts/k8s-evidence-collector.sh
#   crontab -e
#   */5 * * * * /home/fldba/foxlink_gpt/scripts/k8s-evidence-collector.sh >> /var/log/foxlink-evidence/collector.log 2>&1
#
# 證據存放:/var/log/foxlink-evidence/YYYYMMDD-HHMMSS-<podname>/
# 保留:7 天(超過自動清)

set -uo pipefail

NS="${NAMESPACE:-foxlink}"
LABEL="${LABEL:-app=foxlink-gpt}"
CPU_THRESHOLD_MILLI="${CPU_THRESHOLD_MILLI:-1200}"   # >1200m 視為異常(正常 600-700m)
MEM_THRESHOLD_PCT="${MEM_THRESHOLD_PCT:-80}"        # heap snapshot 前確認 memory < 80%(避免 OOM)
EVIDENCE_DIR="${EVIDENCE_DIR:-/var/log/foxlink-evidence}"
COOLDOWN_MIN="${COOLDOWN_MIN:-30}"                  # 同 pod 採證冷卻(分鐘)
RETENTION_DAYS="${RETENTION_DAYS:-7}"

mkdir -p "$EVIDENCE_DIR"

TS=$(date '+%Y%m%d-%H%M%S')
LOG_TAG="[$TS]"

log() { echo "$LOG_TAG $*"; }

# ── 1. 找出異常 pod ──
# kubectl top 輸出格式:NAME CPU(cores) MEMORY(bytes)
# CPU 可能是 "1557m" 或 "1" (=1000m),memory 是 "1033Mi"
mapfile -t TOP_LINES < <(
  kubectl top pods -n "$NS" -l "$LABEL" --no-headers 2>/dev/null
)

if [ "${#TOP_LINES[@]}" -eq 0 ]; then
  log "kubectl top 無資料(metrics-server 沒回應?),跳過"
  exit 0
fi

HOT_PODS=()
for line in "${TOP_LINES[@]}"; do
  pod_name=$(echo "$line" | awk '{print $1}')
  cpu_str=$(echo "$line" | awk '{print $2}')
  # 轉成 milli:1557m → 1557、1 → 1000、500m → 500
  if [[ "$cpu_str" =~ ^([0-9]+)m$ ]]; then
    cpu_milli="${BASH_REMATCH[1]}"
  elif [[ "$cpu_str" =~ ^([0-9]+)$ ]]; then
    cpu_milli=$(( ${BASH_REMATCH[1]} * 1000 ))
  else
    continue
  fi
  if [ "$cpu_milli" -gt "$CPU_THRESHOLD_MILLI" ]; then
    HOT_PODS+=("$pod_name|$cpu_milli")
  fi
done

if [ "${#HOT_PODS[@]}" -eq 0 ]; then
  log "所有 pod 都在 ${CPU_THRESHOLD_MILLI}m 以下,正常"
  exit 0
fi

log "偵測到 ${#HOT_PODS[@]} 顆異常 pod"

# ── 2. 過濾冷卻期內的 pod ──
COOLDOWN_SEC=$(( COOLDOWN_MIN * 60 ))
NOW_EPOCH=$(date +%s)

for entry in "${HOT_PODS[@]}"; do
  POD="${entry%|*}"
  CPU="${entry#*|}"

  # 檢查最近是否已採證
  LAST_DIR=$(find "$EVIDENCE_DIR" -maxdepth 1 -type d -name "*-${POD}" 2>/dev/null | sort -r | head -1)
  if [ -n "$LAST_DIR" ]; then
    LAST_TS=$(basename "$LAST_DIR" | cut -d- -f1,2)
    LAST_EPOCH=$(date -d "${LAST_TS:0:8} ${LAST_TS:9:2}:${LAST_TS:11:2}:${LAST_TS:13:2}" +%s 2>/dev/null || echo 0)
    AGE=$(( NOW_EPOCH - LAST_EPOCH ))
    if [ "$AGE" -lt "$COOLDOWN_SEC" ]; then
      log "  跳過 $POD (上次採證 $((AGE/60)) 分鐘前)"
      continue
    fi
  fi

  # ── 3. 開始採證 ──
  OUTDIR="$EVIDENCE_DIR/${TS}-${POD}"
  mkdir -p "$OUTDIR"
  log "  採證 $POD (CPU=${CPU}m) → $OUTDIR"

  # 3a. 全集群 top 快照(對照組)
  {
    echo "=== kubectl top pods (sorted by cpu) ==="
    kubectl top pods -n "$NS" -l "$LABEL" --sort-by=cpu 2>&1
    echo
    echo "=== kubectl top nodes ==="
    kubectl top nodes 2>&1
  } > "$OUTDIR/00-cluster-snapshot.txt"

  # 3b. pod describe(events / restart / probe 結果)
  kubectl describe pod -n "$NS" "$POD" > "$OUTDIR/01-pod-describe.txt" 2>&1

  # 3c. pod log(現任 + 前任)
  kubectl logs -n "$NS" "$POD" --tail=2000 > "$OUTDIR/02-pod-log.txt" 2>&1
  kubectl logs -n "$NS" "$POD" --tail=2000 --previous > "$OUTDIR/02-pod-log-previous.txt" 2>&1 || true

  # 3d. log 統計(找 hot pattern)
  {
    echo "=== Top 30 unique log lines (去時間戳 + 變數) ==="
    grep -oE '\[[A-Z][a-zA-Z]+\][^"0-9]+' "$OUTDIR/02-pod-log.txt" 2>/dev/null \
      | sort | uniq -c | sort -rn | head -30
    echo
    echo "=== 各路由出現次數 ==="
    grep -oE '/api/[a-z/_-]+' "$OUTDIR/02-pod-log.txt" 2>/dev/null \
      | sort | uniq -c | sort -rn | head -20
    echo
    echo "=== 重點關鍵字 ==="
    grep -ciE "research|transcribe|deep|long-audio|thinking|embedding|ORA-|timeout|ECONN|stuck" "$OUTDIR/02-pod-log.txt" 2>/dev/null
  } > "$OUTDIR/03-log-analysis.txt"

  # 3e. pod 內部狀態
  kubectl exec -n "$NS" "$POD" -c foxlink-gpt -- sh -c '
    echo "=== /proc/1/cmdline ===";
    cat /proc/1/cmdline | tr "\0" " "; echo;
    echo;
    echo "=== /proc/1/status (selected) ===";
    grep -E "^(State|VmPeak|VmRSS|VmSize|Threads|FDSize):" /proc/1/status;
    echo;
    echo "=== open FD count ===";
    ls /proc/1/fd 2>/dev/null | wc -l;
    echo;
    echo "=== TCP connections ===";
    cat /proc/1/net/tcp 2>/dev/null | wc -l;
    echo "ESTABLISHED:";
    awk '\''$4=="01" {print $2,$3}'\'' /proc/1/net/tcp 2>/dev/null | wc -l;
    echo;
    echo "=== cgroup cpu.stat ===";
    cat /sys/fs/cgroup/cpu.stat 2>/dev/null || cat /sys/fs/cgroup/cpu/cpu.stat 2>/dev/null;
    echo;
    echo "=== memory.stat (selected) ===";
    grep -E "^(rss|cache|swap|file|anon)" /sys/fs/cgroup/memory.stat 2>/dev/null \
      || grep -E "^(rss|cache|swap)" /sys/fs/cgroup/memory/memory.stat 2>/dev/null;
  ' > "$OUTDIR/04-pod-internals.txt" 2>&1

  # 3f. Node.js heap snapshot(memory < 80% 才做,避免 OOM)
  MEM_LINE=$(echo "${TOP_LINES[@]}" | tr ' ' '\n' | grep -A0 "^${POD}$" || true)
  # 改用直接抓 limit 比較精準
  MEM_OK=true
  POD_MEM_BYTES=$(kubectl exec -n "$NS" "$POD" -c foxlink-gpt -- cat /sys/fs/cgroup/memory.current 2>/dev/null || echo 0)
  POD_MEM_LIMIT=$(kubectl exec -n "$NS" "$POD" -c foxlink-gpt -- cat /sys/fs/cgroup/memory.max 2>/dev/null || echo 0)
  if [ "$POD_MEM_BYTES" -gt 0 ] && [ "$POD_MEM_LIMIT" -gt 0 ] && [ "$POD_MEM_LIMIT" != "max" ]; then
    PCT=$(( POD_MEM_BYTES * 100 / POD_MEM_LIMIT ))
    echo "memory: ${PCT}% (${POD_MEM_BYTES} / ${POD_MEM_LIMIT})" > "$OUTDIR/05-heap-skipped-or-taken.txt"
    if [ "$PCT" -gt "$MEM_THRESHOLD_PCT" ]; then
      MEM_OK=false
      echo "SKIPPED: memory too high (>${MEM_THRESHOLD_PCT}%), heap snapshot would risk OOM" >> "$OUTDIR/05-heap-skipped-or-taken.txt"
    fi
  fi

  if [ "$MEM_OK" = true ]; then
    kubectl exec -n "$NS" "$POD" -c foxlink-gpt -- sh -c '
      node -e "const v8=require(\"v8\"); const f=v8.writeHeapSnapshot(\"/tmp/heap-'$TS'.heapsnapshot\"); console.log(f);"
    ' > "$OUTDIR/05-heap-write.log" 2>&1

    HEAP_FILE=$(kubectl exec -n "$NS" "$POD" -c foxlink-gpt -- ls -1 /tmp/ 2>/dev/null | grep "heap-${TS}" | head -1)
    if [ -n "$HEAP_FILE" ]; then
      kubectl cp "${NS}/${POD}:/tmp/${HEAP_FILE}" "$OUTDIR/heap.heapsnapshot" -c foxlink-gpt 2>>"$OUTDIR/05-heap-write.log" || true
      kubectl exec -n "$NS" "$POD" -c foxlink-gpt -- rm -f "/tmp/${HEAP_FILE}" 2>/dev/null || true
      [ -f "$OUTDIR/heap.heapsnapshot" ] && gzip "$OUTDIR/heap.heapsnapshot"
    fi
  fi

  # 3g. 採證後不刪 pod(由你決定要不要 delete),但提示
  echo "$POD" > "$OUTDIR/POD_NAME"
  echo "${CPU}" > "$OUTDIR/CPU_MILLI"
  log "  完成 → ls $OUTDIR"
done

# ── 4. 過期清理 ──
find "$EVIDENCE_DIR" -maxdepth 1 -type d -name "20*" -mtime "+${RETENTION_DAYS}" -exec rm -rf {} \; 2>/dev/null

log "done"
