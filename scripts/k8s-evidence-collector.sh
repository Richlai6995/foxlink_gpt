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
LABEL="${LABEL:-app in (foxlink-gpt,foxlink-gpt-scheduler)}"   # 同時掃 chat + scheduler
CPU_THRESHOLD_MILLI="${CPU_THRESHOLD_MILLI:-1200}"   # >1200m 視為 CPU 燒(正常 600-700m)
# Event loop block 的徵兆:CPU 不高但 readiness/liveness probe 一直 fail
# 2026-06-02 事故就是這條 — scheduler 被 ExcelJob 273s sync 卡死,CPU 只 26m 但 probe fail 85 次
UNHEALTHY_THRESHOLD="${UNHEALTHY_THRESHOLD:-10}"     # 近 10 分鐘 Unhealthy event 次數
MEM_THRESHOLD_PCT="${MEM_THRESHOLD_PCT:-80}"        # heap snapshot 前確認 memory < 80%(避免 OOM)
EVIDENCE_DIR="${EVIDENCE_DIR:-/var/log/foxlink-evidence}"
COOLDOWN_MIN="${COOLDOWN_MIN:-30}"                  # 同 pod 採證冷卻(分鐘)
RETENTION_DAYS="${RETENTION_DAYS:-7}"

mkdir -p "$EVIDENCE_DIR"

TS=$(date '+%Y%m%d-%H%M%S')
LOG_TAG="[$TS]"

log() { echo "$LOG_TAG $*"; }

# ── 1a. CPU 高的 pod(top metric) ──
# kubectl top 輸出格式:NAME CPU(cores) MEMORY(bytes)
# CPU 可能是 "1557m" 或 "1" (=1000m),memory 是 "1033Mi"
mapfile -t TOP_LINES < <(
  kubectl top pods -n "$NS" -l "$LABEL" --no-headers 2>/dev/null
)

declare -A HOT_REASON   # pod_name → "cpu=1500m" or "unhealthy=42" or "cpu=1500m,unhealthy=42"

if [ "${#TOP_LINES[@]}" -gt 0 ]; then
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
      HOT_REASON["$pod_name"]="cpu=${cpu_milli}m"
    fi
  done
else
  log "kubectl top 無資料(metrics-server 沒回應?)— 仍會掃 Unhealthy events"
fi

# ── 1b. Event loop block 偵測:Unhealthy event 累積次數 ──
# 2026-06-02 事故:scheduler CPU 才 26m 但 readiness probe fail 85 次。
# 純 CPU 門檻抓不到 event loop block,要靠 K8s 自己觀察到的 probe failure 數。
# kubectl get events 看 reason=Unhealthy,計近 10 分鐘 count(對齊 cron 5 分鐘 + 緩衝)
mapfile -t UNHEALTHY_LINES < <(
  kubectl get events -n "$NS" \
    --field-selector reason=Unhealthy \
    -o jsonpath='{range .items[*]}{.involvedObject.name}{"|"}{.count}{"|"}{.lastTimestamp}{"\n"}{end}' 2>/dev/null
)

NOW_EPOCH=$(date +%s)
for ev in "${UNHEALTHY_LINES[@]}"; do
  IFS='|' read -r pod_name count last_ts <<< "$ev"
  [ -z "$pod_name" ] && continue
  [ -z "$count" ] && continue
  # 只看近 10 分鐘有發生過的(K8s event TTL 預設 1h,但我們不要看一小時前的舊事件)
  if [ -n "$last_ts" ]; then
    last_epoch=$(date -d "$last_ts" +%s 2>/dev/null || echo 0)
    age=$(( NOW_EPOCH - last_epoch ))
    [ "$age" -gt 600 ] && continue
  fi
  if [ "$count" -ge "$UNHEALTHY_THRESHOLD" ]; then
    existing="${HOT_REASON[$pod_name]:-}"
    new="unhealthy=${count}"
    if [ -n "$existing" ]; then
      HOT_REASON["$pod_name"]="${existing},${new}"
    else
      HOT_REASON["$pod_name"]="$new"
    fi
  fi
done

# 沒命中任何 pod → 正常
if [ "${#HOT_REASON[@]}" -eq 0 ]; then
  log "所有 pod 都正常(CPU<${CPU_THRESHOLD_MILLI}m, Unhealthy<${UNHEALTHY_THRESHOLD})"
  exit 0
fi

HOT_PODS=()
for pod_name in "${!HOT_REASON[@]}"; do
  HOT_PODS+=("$pod_name|${HOT_REASON[$pod_name]}")
done

log "偵測到 ${#HOT_PODS[@]} 顆異常 pod"

# ── 2. 過濾冷卻期內的 pod ──
COOLDOWN_SEC=$(( COOLDOWN_MIN * 60 ))
NOW_EPOCH=$(date +%s)

for entry in "${HOT_PODS[@]}"; do
  POD="${entry%|*}"
  REASON="${entry#*|}"   # e.g. "cpu=1500m", "unhealthy=42", or "cpu=1500m,unhealthy=42"

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
  log "  採證 $POD (${REASON}) → $OUTDIR"

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
  # container 名稱動態抓(foxlink-gpt pod 跟 foxlink-gpt-scheduler pod 容器名不同)
  MAIN_C=$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.spec.containers[0].name}' 2>/dev/null)
  [ -z "$MAIN_C" ] && MAIN_C="foxlink-gpt"   # fallback
  kubectl exec -n "$NS" "$POD" -c "$MAIN_C" -- sh -c '
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
  MEM_OK=true
  POD_MEM_BYTES=$(kubectl exec -n "$NS" "$POD" -c "$MAIN_C" -- cat /sys/fs/cgroup/memory.current 2>/dev/null || echo 0)
  POD_MEM_LIMIT=$(kubectl exec -n "$NS" "$POD" -c "$MAIN_C" -- cat /sys/fs/cgroup/memory.max 2>/dev/null || echo 0)
  if [ "$POD_MEM_BYTES" -gt 0 ] && [ "$POD_MEM_LIMIT" -gt 0 ] && [ "$POD_MEM_LIMIT" != "max" ]; then
    PCT=$(( POD_MEM_BYTES * 100 / POD_MEM_LIMIT ))
    echo "memory: ${PCT}% (${POD_MEM_BYTES} / ${POD_MEM_LIMIT})" > "$OUTDIR/05-heap-skipped-or-taken.txt"
    if [ "$PCT" -gt "$MEM_THRESHOLD_PCT" ]; then
      MEM_OK=false
      echo "SKIPPED: memory too high (>${MEM_THRESHOLD_PCT}%), heap snapshot would risk OOM" >> "$OUTDIR/05-heap-skipped-or-taken.txt"
    fi
  fi

  if [ "$MEM_OK" = true ]; then
    kubectl exec -n "$NS" "$POD" -c "$MAIN_C" -- sh -c '
      node -e "const v8=require(\"v8\"); const f=v8.writeHeapSnapshot(\"/tmp/heap-'$TS'.heapsnapshot\"); console.log(f);"
    ' > "$OUTDIR/05-heap-write.log" 2>&1

    HEAP_FILE=$(kubectl exec -n "$NS" "$POD" -c "$MAIN_C" -- ls -1 /tmp/ 2>/dev/null | grep "heap-${TS}" | head -1)
    if [ -n "$HEAP_FILE" ]; then
      kubectl cp "${NS}/${POD}:/tmp/${HEAP_FILE}" "$OUTDIR/heap.heapsnapshot" -c "$MAIN_C" 2>>"$OUTDIR/05-heap-write.log" || true
      kubectl exec -n "$NS" "$POD" -c "$MAIN_C" -- rm -f "/tmp/${HEAP_FILE}" 2>/dev/null || true
      [ -f "$OUTDIR/heap.heapsnapshot" ] && gzip "$OUTDIR/heap.heapsnapshot"
    fi
  fi

  # 3g. metadata(下次採證可看為什麼被選中)
  echo "$POD" > "$OUTDIR/POD_NAME"
  echo "${REASON}" > "$OUTDIR/REASON"
  log "  完成 → ls $OUTDIR"
done

# ── 4. 過期清理 ──
find "$EVIDENCE_DIR" -maxdepth 1 -type d -name "20*" -mtime "+${RETENTION_DAYS}" -exec rm -rf {} \; 2>/dev/null

log "done"
