/**
 * Metrics Collector — node-cron based periodic collection
 *
 * Schedule:
 *   Every 1 min  — health check runner
 *   Every 5 min  — node metrics, host metrics, online user snapshots, alert checks
 *   Every 1 hour — disk metrics
 *   Daily 02:00  — retention cleanup
 */
const cron = require('node-cron');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const { collectHostMetrics, parseNodeDescribe, getK8sResource } = require('../routes/monitor');
const { notifyAlert, isInCooldown } = require('./webhookNotifier');

let db = null;
let jobs = [];

async function getSetting(key, fallback) {
  try {
    const row = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get(key);
    return row?.value ?? fallback;
  } catch { return fallback; }
}

function runCmd(cmd, args = [], timeout = 15000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn(cmd, args, { shell: true, timeout });
    proc.stdout.on('data', d => chunks.push(d));
    proc.stderr.on('data', d => chunks.push(d));
    proc.on('close', code => {
      const out = Buffer.concat(chunks).toString('utf8');
      if (code === 0) resolve(out);
      else reject(new Error(`Exit ${code}: ${out.slice(0, 500)}`));
    });
    proc.on('error', reject);
  });
}

// ─── Health Check Runner (every 1 min) ──────────────────────────────────────
async function runHealthChecks() {
  try {
    const checks = await db.prepare(`SELECT * FROM health_checks WHERE enabled=1`).all();
    for (const check of checks) {
      const startTime = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), check.timeout_ms || 5000);
        const res = await fetch(check.url, {
          method: check.method || 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const responseMs = Date.now() - startTime;
        const isUp = res.status === (check.expected_status || 200) ? 1 : 0;

        await db.prepare(
          `INSERT INTO health_check_results (check_id, status_code, response_ms, is_up) VALUES (?,?,?,?)`
        ).run(check.id, res.status, responseMs, isUp);

        if (!isUp) {
          await checkHealthFailure(check);
        }
      } catch (e) {
        const responseMs = Date.now() - startTime;
        await db.prepare(
          `INSERT INTO health_check_results (check_id, status_code, response_ms, is_up, error_msg) VALUES (?,?,?,?,?)`
        ).run(check.id, 0, responseMs, 0, e.message?.slice(0, 500));
        await checkHealthFailure(check);
      }
    }
  } catch (e) {
    console.error('[MetricsCollector] Health check error:', e.message);
  }
}

async function checkHealthFailure(check) {
  // Check if last 2 results are failures
  const recent = await db.prepare(
    `SELECT is_up FROM health_check_results WHERE check_id=? ORDER BY checked_at DESC FETCH FIRST 2 ROWS ONLY`
  ).all(check.id);

  if (recent.length >= 2 && recent.every(r => !r.is_up)) {
    const cooldown = parseInt(await getSetting('monitor_alert_cooldown', '30'));
    const inCooldown = await isInCooldown(db, 'service_down', check.name, cooldown);
    if (!inCooldown) {
      await notifyAlert({
        db,
        alertType: 'service_down',
        severity: 'critical',
        resourceName: check.name,
        message: `Health check failed: ${check.name} (${check.url}) — 連續 2 次失敗`,
      });
    }
  }
}

// ─── Node Metrics Collection (every 5 min) ──────────────────────────────────
async function collectNodeMetrics() {
  try {
    const nodes = await getK8sResource('/api/v1/nodes', ['get', 'nodes', '-o', 'json']);

    const cooldown = parseInt(await getSetting('monitor_alert_cooldown', '30'));
    const cpuThreshold = parseFloat(await getSetting('monitor_cpu_threshold', '90'));
    const memThreshold = parseFloat(await getSetting('monitor_mem_threshold', '85'));
    const alertEnabled = await getSetting('monitor_alert_enabled', 'true');

    for (const node of (nodes.items || [])) {
      const name = node.metadata?.name;
      try {
        const desc = await runCmd('kubectl', ['describe', 'node', name]);
        const detail = parseNodeDescribe(name, node, desc);

        await db.prepare(
          `INSERT INTO node_metrics (node_name, role, status, cpu_alloc, cpu_req, cpu_req_pct, mem_alloc, mem_req, mem_req_pct, pod_count)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).run(
          name, detail.role, detail.status,
          detail.allocatable.cpu, detail.requests.cpu, detail.cpuReqPct,
          detail.allocatable.memory, detail.requests.memory, detail.memReqPct,
          detail.podCount
        );

        // Alert checks
        if (alertEnabled !== 'true') continue;

        // Node NotReady
        if (detail.status !== 'Ready') {
          if (!await isInCooldown(db, 'node_not_ready', name, cooldown)) {
            await notifyAlert({
              db, alertType: 'node_not_ready', severity: 'emergency',
              resourceName: name,
              message: `Node ${name} status: ${detail.status}`,
            });
          }
        } else {
          // Auto-resolve
          await db.prepare(
            `UPDATE monitor_alerts SET resolved_at=SYSTIMESTAMP
             WHERE alert_type='node_not_ready' AND resource_name=? AND resolved_at IS NULL`
          ).run(name);
        }

        // CPU overload
        if (detail.cpuReqPct > cpuThreshold) {
          if (!await isInCooldown(db, 'resource_high', `${name}/cpu`, cooldown)) {
            await notifyAlert({
              db, alertType: 'resource_high', severity: 'critical',
              resourceName: `${name}/cpu`,
              message: `Node ${name} CPU request ${detail.cpuReqPct}% > ${cpuThreshold}%`,
            });
          }
        }

        // Memory overload
        if (detail.memReqPct > memThreshold) {
          if (!await isInCooldown(db, 'resource_high', `${name}/memory`, cooldown)) {
            await notifyAlert({
              db, alertType: 'resource_high', severity: 'critical',
              resourceName: `${name}/memory`,
              message: `Node ${name} Memory request ${detail.memReqPct}% > ${memThreshold}%`,
            });
          }
        }
      } catch (e2) {
        // kubectl 未安裝時靜音（不影響核心功能）
        if (!e2.message?.includes('not found') && !e2.message?.includes('ENOENT') && !e2.message?.includes('127')) {
          console.warn(`[MetricsCollector] Node ${name} error:`, e2.message);
        }
      }
    }
  } catch (e) {
    // kubectl not available — skip silently
    if (!e.message?.includes('not found') && !e.message?.includes('ENOENT')) {
      console.warn('[MetricsCollector] collectNodeMetrics:', e.message);
    }
  }
}

// ─── Pod Alert Checks ───────────────────────────────────────────────────────
async function checkPodAlerts() {
  try {
    const alertEnabled = await getSetting('monitor_alert_enabled', 'true');
    if (alertEnabled !== 'true') return;

    const pods = await getK8sResource('/api/v1/pods', ['get', 'pods', '--all-namespaces', '-o', 'json']);
    const cooldown = parseInt(await getSetting('monitor_alert_cooldown', '30'));
    const restartLimit = parseInt(await getSetting('monitor_pod_restart_limit', '5'));
    const pendingMinutes = parseInt(await getSetting('monitor_pod_pending_minutes', '10'));

    for (const pod of (pods.items || [])) {
      const podName = `${pod.metadata?.namespace}/${pod.metadata?.name}`;

      // CrashLoopBackOff check — incremental: only alert when restart count INCREASES
      const containers = pod.status?.containerStatuses || [];
      for (const c of containers) {
        if (c.restartCount > restartLimit) {
          const resourceKey = `${podName}/${c.name}`;
          // Check last known restart count from existing unresolved alert
          const lastAlert = await db.prepare(
            `SELECT last_known_value FROM monitor_alerts
             WHERE alert_type='pod_crash' AND resource_name=? AND resolved_at IS NULL
             ORDER BY notified_at DESC FETCH FIRST 1 ROW ONLY`
          ).get(resourceKey);
          const lastKnown = lastAlert ? parseInt(lastAlert.last_known_value) || 0 : 0;

          if (c.restartCount > lastKnown) {
            // Auto-resolve previous alerts for same resource (dedup)
            await db.prepare(
              `UPDATE monitor_alerts SET resolved_at=SYSTIMESTAMP
               WHERE alert_type='pod_crash' AND resource_name=? AND resolved_at IS NULL`
            ).run(resourceKey);

            await notifyAlert({
              db, alertType: 'pod_crash', severity: 'critical',
              resourceName: resourceKey,
              message: `Pod ${podName} container ${c.name} restarts: ${c.restartCount} (> ${restartLimit})`,
              lastKnownValue: c.restartCount,
            });
          }
        }
      }

      // Pending too long
      if (pod.status?.phase === 'Pending') {
        const startTime = new Date(pod.metadata?.creationTimestamp);
        const pendingMin = (Date.now() - startTime.getTime()) / 60000;
        if (pendingMin > pendingMinutes) {
          if (!await isInCooldown(db, 'pod_pending', podName, cooldown)) {
            await notifyAlert({
              db, alertType: 'pod_pending', severity: 'warning',
              resourceName: podName,
              message: `Pod ${podName} has been Pending for ${Math.round(pendingMin)} minutes`,
            });
          }
        }
      }
    }
  } catch (e) {
    if (!e.message?.includes('not found') && !e.message?.includes('ENOENT')) {
      console.warn('[MetricsCollector] checkPodAlerts:', e.message);
    }
  }
}

// ─── Host Metrics Collection (every 5 min) ──────────────────────────────────
async function collectAndStoreHostMetrics() {
  try {
    const metrics = await collectHostMetrics();
    await db.prepare(
      `INSERT INTO host_metrics (load_1m, load_5m, load_15m, mem_total_mb, mem_used_mb, mem_cached_mb, swap_used_mb, net_rx_mb, net_tx_mb, disk_read_mb, disk_write_mb, uptime_sec)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      metrics.load_1m, metrics.load_5m, metrics.load_15m,
      metrics.mem_total_mb, metrics.mem_used_mb, metrics.mem_cached_mb, metrics.swap_used_mb,
      metrics.net_rx_mb, metrics.net_tx_mb,
      metrics.disk_read_mb, metrics.disk_write_mb,
      metrics.uptime_sec
    );

    // Host-level alerts
    const alertEnabled = await getSetting('monitor_alert_enabled', 'true');
    if (alertEnabled !== 'true') return;

    const cooldown = parseInt(await getSetting('monitor_alert_cooldown', '30'));

    // CPU load check
    const loadThreshold = parseFloat(await getSetting('monitor_load_threshold', '0.9'));
    const cpuCount = os.cpus().length || 1;
    if (metrics.load_1m / cpuCount > loadThreshold) {
      if (!await isInCooldown(db, 'host_load_high', 'host', cooldown)) {
        await notifyAlert({
          db, alertType: 'host_load_high', severity: 'warning',
          resourceName: 'host',
          message: `Host CPU load ${metrics.load_1m} / ${cpuCount} cores = ${(metrics.load_1m / cpuCount).toFixed(2)} > ${loadThreshold}`,
        });
      }
    }

    // Memory check
    const memThreshold = parseFloat(await getSetting('monitor_mem_threshold', '85'));
    if (metrics.mem_total_mb > 0) {
      const memPct = (metrics.mem_used_mb / metrics.mem_total_mb) * 100;
      if (memPct > memThreshold) {
        if (!await isInCooldown(db, 'host_mem_high', 'host', cooldown)) {
          await notifyAlert({
            db, alertType: 'host_mem_high', severity: 'warning',
            resourceName: 'host',
            message: `Host memory usage ${memPct.toFixed(1)}% > ${memThreshold}%`,
          });
        }
      }
    }
  } catch (e) {
    console.error('[MetricsCollector] collectHostMetrics error:', e.message);
  }
}

// ─── Online Users Snapshot (every 5 min) ────────────────────────────────────
async function snapshotOnlineUsers() {
  try {
    const redis = require('./redisClient');
    let sessions = [];
    try { sessions = await redis.getAllSessions() || []; } catch {}
    const userIds = sessions.map(s => s.id).filter(Boolean);
    await db.prepare(
      `INSERT INTO online_user_snapshots (online_count, user_ids) VALUES (?,?)`
    ).run(userIds.length, JSON.stringify(userIds));
  } catch (e) {
    console.error('[MetricsCollector] snapshotOnlineUsers error:', e.message);
  }
}

// ─── Online Dept Snapshot (every N minutes, configurable) ───────────────────
async function snapshotOnlineDept() {
  try {
    const redis = require('./redisClient');
    const dbOracle = require('../database-oracle').db;
    let sessions = [];
    try { sessions = await redis.getAllSessions() || []; } catch {}

    // Deduplicate by user ID
    const seen = new Map();
    for (const s of sessions) {
      if (!s.id || seen.has(s.id)) continue;
      seen.set(s.id, s);
    }

    // Enrich with DB data for org fields
    const userIds = Array.from(seen.keys());
    const userMap = new Map();
    if (userIds.length > 0) {
      try {
        const ph = userIds.map(() => '?').join(',');
        const rows = await dbOracle.prepare(
          `SELECT id, dept_code, profit_center, org_section, org_group_name FROM users WHERE id IN (${ph})`
        ).all(...userIds);
        for (const r of rows) userMap.set(r.id, r);
      } catch {}
    }

    // Load org code→name from FL_ORG_EMP_DEPT_MV (authoritative, 20-min cached).
    // Fallback to empty maps if ERP is unavailable — names will be null in snapshot
    // and the history API will backfill them on query.
    let pcMap = new Map(), osMap = new Map();
    try {
      const { getOrgCodeNameMaps } = require('./orgHierarchyService');
      const { getErpPool }         = require('./dashboardService');
      ({ pcMap, osMap } = await getOrgCodeNameMaps(getErpPool));
    } catch { /* ERP unavailable — names left empty, backfilled at query time */ }

    // Aggregate by (profit_center, org_section, org_group_name, dept_code)
    const agg = {};
    for (const [uid, sess] of seen) {
      const dbUser = userMap.get(uid) || {};
      const profit_center  = dbUser.profit_center  || sess.profit_center  || 'Unknown';
      const org_section    = dbUser.org_section    || sess.org_section    || '';
      const org_group_name = dbUser.org_group_name || '';
      const dept_code      = dbUser.dept_code      || sess.dept_code      || '';
      // Names from MV (authoritative); fallback to session/db values
      const profit_center_name = pcMap.get(profit_center) || '';
      const org_section_name   = osMap.get(org_section)   || '';
      const key = JSON.stringify({ profit_center, org_section, org_group_name, dept_code });
      if (!agg[key]) agg[key] = { count: 0, profit_center_name, org_section_name };
      agg[key].count++;
    }

    // snapshot_id = 5 分鐘邊界（同一視窗內所有 pods 共用相同 key），搭配 MERGE 去重
    const snapId = Math.floor(Date.now() / 300000) * 300; // Unix seconds rounded to 5-min
    const totalAgg = Object.values(agg).reduce((s, v) => s + v.count, 0);
    console.log(`[DeptSnapshot] sessions=${sessions.length} uniqueUsers=${seen.size} aggTotal=${totalAgg} snapId=${snapId}`);
    for (const [key, { count, profit_center_name, org_section_name }] of Object.entries(agg)) {
      const { profit_center, org_section, org_group_name, dept_code } = JSON.parse(key);
      // MERGE：同 snapshot + dept 組合只保留一筆，多 pod 並發只有第一個寫入，後續 UPDATE（值相同不影響）
      await db.prepare(`
        MERGE INTO online_dept_snapshots dst
        USING (SELECT ? AS snap_id, ? AS pc, ? AS os, ? AS og, ? AS dc, ? AS pc_name, ? AS os_name, ? AS cnt FROM dual) src
        ON (dst.snapshot_id = src.snap_id
            AND NVL(dst.profit_center,'~')  = NVL(src.pc,'~')
            AND NVL(dst.org_section,'~')    = NVL(src.os,'~')
            AND NVL(dst.org_group_name,'~') = NVL(src.og,'~')
            AND NVL(dst.dept_code,'~')      = NVL(src.dc,'~'))
        WHEN NOT MATCHED THEN
          INSERT (snapshot_id, profit_center, org_section, org_group_name, dept_code, profit_center_name, org_section_name, user_count)
          VALUES (src.snap_id, src.pc, src.os, src.og, src.dc, src.pc_name, src.os_name, src.cnt)
        WHEN MATCHED THEN
          UPDATE SET dst.user_count = src.cnt, dst.collected_at = SYSTIMESTAMP,
                     dst.profit_center_name = src.pc_name, dst.org_section_name = src.os_name
      `).run(snapId, profit_center || null, org_section || null, org_group_name || null, dept_code || null, profit_center_name || null, org_section_name || null, count);
    }
  } catch (e) {
    console.error('[MetricsCollector] snapshotOnlineDept error:', e.message);
  }
}

// ─── Disk Metrics Collection (every 1 hour) ─────────────────────────────────
async function collectDiskMetrics() {
  if (os.platform() !== 'linux') return;
  try {
    const dfOut = await runCmd('df', ['-B1', '--output=source,target,size,used,pcent']);
    // df -i 與 --output 在部分 Linux 版本互斥，改用標準 df -i 輸出解析
    // 標準格式: Filesystem Inodes IUsed IFree IUse% Mounted
    const inodeMap = {};
    try {
      const diOut = await runCmd('df', ['-i']);
      for (const line of diOut.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        // 欄位: Filesystem Inodes IUsed IFree IUse% Mounted
        if (parts.length >= 6) inodeMap[parts[5]] = parts[4]; // key=mount, val=IUse%
      }
    } catch (_) { /* inode 資料非必要，取不到就跳過 */ }

    const alertEnabled = await getSetting('monitor_alert_enabled', 'true');
    const cooldown = parseInt(await getSetting('monitor_alert_cooldown', '30'));
    const diskThreshold = parseFloat(await getSetting('monitor_disk_threshold', '85'));

    for (const line of dfOut.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const device = parts[0];
      const mount = parts[1];
      if (['tmpfs', 'devtmpfs'].includes(device)) continue;
      if (mount.startsWith('/sys') || mount.startsWith('/proc') || mount.startsWith('/dev/shm') || mount.startsWith('/run')) continue;

      const totalBytes = parseInt(parts[2]) || 0;
      const usedBytes = parseInt(parts[3]) || 0;
      const usePct = parseFloat(parts[4]?.replace('%', '')) || 0;
      const inodePct = parseFloat((inodeMap[mount] || '0').replace('%', '')) || 0;

      const totalGb = Math.round(totalBytes / 1073741824 * 100) / 100;
      const usedGb = Math.round(usedBytes / 1073741824 * 100) / 100;

      await db.prepare(
        `INSERT INTO disk_metrics (mount, device, total_gb, used_gb, use_pct, inode_pct, is_mounted) VALUES (?,?,?,?,?,?,?)`
      ).run(mount, device, totalGb, usedGb, usePct, inodePct, 1);

      // Disk usage alert
      if (alertEnabled === 'true' && usePct > diskThreshold) {
        if (!await isInCooldown(db, 'disk_high', mount, cooldown)) {
          await notifyAlert({
            db, alertType: 'disk_high', severity: 'critical',
            resourceName: mount,
            message: `Disk ${mount} usage ${usePct}% > ${diskThreshold}% (${usedGb}GB / ${totalGb}GB)`,
          });
        }
      }
    }

    // NAS mount check — check if expected mounts are missing
    // (Compare with previous known mounts)
    try {
      const prevMounts = await db.prepare(
        `SELECT DISTINCT mount FROM disk_metrics WHERE is_mounted=1
         AND collected_at > SYSTIMESTAMP - INTERVAL '2' HOUR`
      ).all();

      const currentMounts = new Set();
      for (const line of dfOut.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) currentMounts.add(parts[1]);
      }

      for (const prev of prevMounts) {
        if (!currentMounts.has(prev.mount) && prev.mount.includes('/nas')) {
          // NAS dropped
          await db.prepare(
            `INSERT INTO disk_metrics (mount, device, total_gb, used_gb, use_pct, inode_pct, is_mounted) VALUES (?,?,?,?,?,?,?)`
          ).run(prev.mount, '', 0, 0, 0, 0, 0);

          if (!await isInCooldown(db, 'nas_down', prev.mount, cooldown)) {
            await notifyAlert({
              db, alertType: 'nas_down', severity: 'emergency',
              resourceName: prev.mount,
              message: `NAS mount ${prev.mount} is no longer accessible!`,
            });
          }
        }
      }
    } catch {}
  } catch (e) {
    console.error('[MetricsCollector] collectDiskMetrics error:', e.message);
  }
}

// ─── Docker Container Alerts ────────────────────────────────────────────────
async function checkContainerAlerts() {
  try {
    const alertEnabled = await getSetting('monitor_alert_enabled', 'true');
    if (alertEnabled !== 'true') return;

    let containerList = [];
    // Try docker CLI first
    try {
      const out = await runCmd('docker', ['ps', '-a', '--format', '{{json .}}']);
      containerList = out.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {
      // Fallback: Docker socket API
      const { hasDockerSocket, dockerApiGet } = (() => {
        try { return require('../routes/monitor'); } catch { return {}; }
      })();
      if (typeof hasDockerSocket === 'function' && hasDockerSocket()) {
        try {
          const raw = await dockerApiGet('/containers/json?all=true');
          containerList = (raw || []).map(c => ({
            Names: (c.Names || []).map(n => n.replace(/^\//, '')).join(', '),
            State: c.State || '',
            Status: c.Status || '',
          }));
        } catch {}
      }
    }

    const cooldown = parseInt(await getSetting('monitor_alert_cooldown', '30'));
    for (const c of containerList) {
      if (c.State === 'exited' && c.Status && !c.Status.includes('Exited (0)')) {
        if (!await isInCooldown(db, 'container_exit', c.Names, cooldown)) {
          await notifyAlert({
            db, alertType: 'container_exit', severity: 'critical',
            resourceName: c.Names,
            message: `Container ${c.Names} exited unexpectedly: ${c.Status}`,
          });
        }
      }
    }
  } catch (e) {
    if (!e.message?.includes('not found') && !e.message?.includes('ENOENT')) {
      console.warn('[MetricsCollector] checkContainerAlerts:', e.message);
    }
  }
}

// ─── Retention Cleanup (daily 02:00) ────────────────────────────────────────
async function cleanupOldData() {
  try {
    const metricsRetention = parseInt(await getSetting('monitor_metrics_retention_days', '7'));
    const diskRetention = parseInt(await getSetting('monitor_disk_retention_days', '30'));
    const onlineRetention = parseInt(await getSetting('monitor_online_retention_days', '30'));
    const healthRetention = parseInt(await getSetting('monitor_health_check_retention', '7'));
    const logRetention = parseInt(await getSetting('monitor_log_retention_days', '30'));

    await db.prepare(`DELETE FROM node_metrics WHERE collected_at < SYSTIMESTAMP - INTERVAL '${metricsRetention}' DAY`).run();
    await db.prepare(`DELETE FROM host_metrics WHERE collected_at < SYSTIMESTAMP - INTERVAL '${metricsRetention}' DAY`).run();
    await db.prepare(`DELETE FROM disk_metrics WHERE collected_at < SYSTIMESTAMP - INTERVAL '${diskRetention}' DAY`).run();
    await db.prepare(`DELETE FROM online_user_snapshots WHERE collected_at < SYSTIMESTAMP - INTERVAL '${onlineRetention}' DAY`).run();
    const deptRetention = await getSetting('monitor_dept_retention_days', '30');
    await db.prepare(`DELETE FROM online_dept_snapshots WHERE collected_at < SYSTIMESTAMP - INTERVAL '${deptRetention}' DAY`).run();
    await db.prepare(`DELETE FROM health_check_results WHERE checked_at < SYSTIMESTAMP - INTERVAL '${healthRetention}' DAY`).run();
    await db.prepare(`DELETE FROM monitor_alerts WHERE resolved_at IS NOT NULL AND notified_at < SYSTIMESTAMP - INTERVAL '${logRetention}' DAY`).run();

    console.log('[MetricsCollector] Retention cleanup completed');
  } catch (e) {
    console.error('[MetricsCollector] cleanup error:', e.message);
  }
}

// ─── Init ───────────────────────────────────────────────────────────────────
function startMetricsCollector(_db) {
  db = _db;
  console.log('[MetricsCollector] Starting...');

  // Every 1 minute — health checks
  jobs.push(cron.schedule('*/1 * * * *', () => {
    runHealthChecks().catch(e => console.error('[MetricsCollector] health check cron error:', e.message));
  }));

  // Every 5 minutes — node, host, online users, alerts
  jobs.push(cron.schedule('*/5 * * * *', () => {
    collectNodeMetrics().catch(e => console.error('[MetricsCollector] node metrics cron error:', e.message));
    collectAndStoreHostMetrics().catch(e => console.error('[MetricsCollector] host metrics cron error:', e.message));
    snapshotOnlineUsers().catch(e => console.error('[MetricsCollector] online users cron error:', e.message));
    snapshotOnlineDept().catch(e => console.error('[MetricsCollector] online dept cron error:', e.message));
    checkPodAlerts().catch(e => console.error('[MetricsCollector] pod alerts cron error:', e.message));
    checkContainerAlerts().catch(e => console.error('[MetricsCollector] container alerts cron error:', e.message));
  }));

  // Every 1 hour — disk metrics
  jobs.push(cron.schedule('0 * * * *', () => {
    collectDiskMetrics().catch(e => console.error('[MetricsCollector] disk metrics cron error:', e.message));
  }));

  // Daily 02:00 — cleanup
  jobs.push(cron.schedule('0 2 * * *', () => {
    cleanupOldData().catch(e => console.error('[MetricsCollector] cleanup cron error:', e.message));
  }));

  // Run initial collections (delayed 10s to allow server to fully start)
  setTimeout(async () => {
    try {
      await collectAndStoreHostMetrics();
      await snapshotOnlineUsers();
      await collectNodeMetrics();
      await collectDiskMetrics();
      console.log('[MetricsCollector] Initial collection completed');
    } catch (e) {
      console.warn('[MetricsCollector] Initial collection partial error:', e.message);
    }
  }, 10000);

  console.log('[MetricsCollector] Started (health=1min, metrics=5min, disk=1h, cleanup=daily@02:00)');
}

function stopMetricsCollector() {
  for (const job of jobs) job.stop();
  jobs = [];
  console.log('[MetricsCollector] Stopped');
}

module.exports = { startMetricsCollector, stopMetricsCollector };
