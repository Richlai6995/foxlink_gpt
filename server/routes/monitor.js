const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');
const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

router.use(verifyToken);
router.use(verifyAdmin);

// ─── Helper: run shell command and return stdout ─────────────────────────────
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

// helper: safe JSON parse
function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

// ─── K8s API helper (use service account token, fallback from kubectl) ───────
const K8S_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const K8S_CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
const K8S_NS_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';

function hasK8sServiceAccount() {
  try { return fs.existsSync(K8S_TOKEN_PATH); } catch { return false; }
}

async function k8sApiGet(path) {
  const token = fs.readFileSync(K8S_TOKEN_PATH, 'utf8').trim();
  const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  const url = `https://${host}:${port}${path}`;

  // Use Node native https with CA cert to avoid TLS issues
  const https = require('https');
  let ca;
  try { ca = fs.readFileSync(K8S_CA_PATH); } catch {}

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      ca,
      rejectUnauthorized: !!ca,
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`K8s API ${res.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('K8s API timeout')); });
  });
}

// Try kubectl first, fallback to K8s API
async function getK8sResource(apiPath, kubectlArgs) {
  // Try kubectl CLI first
  try {
    const out = await runCmd('kubectl', kubectlArgs);
    return JSON.parse(out);
  } catch {}

  // Fallback: K8s service account API
  if (hasK8sServiceAccount()) {
    return await k8sApiGet(apiPath);
  }

  throw new Error('kubectl 無法連線且無 K8s service account');
}

// ─── Docker API helper (via /var/run/docker.sock, fallback from docker CLI) ──
const DOCKER_SOCKET = '/var/run/docker.sock';

function hasDockerSocket() {
  try { return fs.existsSync(DOCKER_SOCKET); } catch { return false; }
}

async function dockerApiGet(path) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const req = http.get({
      socketPath: DOCKER_SOCKET,
      path,
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Docker API timeout')); });
  });
}

async function dockerApiPost(path) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: DOCKER_SOCKET,
      path,
      method: 'POST',
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(tryParseJSON(body) || body);
        } else {
          reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Docker API timeout')); });
    req.end();
  });
}

// ─── Dashboard Summary ──────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const redis = require('../services/redisClient');

    // Unresolved alerts count
    const alertRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM monitor_alerts WHERE resolved_at IS NULL`
    ).get();

    // Online users (deduplicated by user ID, same as /online-users endpoint)
    let onlineCount = 0;
    try {
      const sessions = await redis.getAllSessions();
      if (sessions) {
        const seen = new Set();
        for (const s of sessions) { if (s.id) seen.add(s.id); }
        onlineCount = seen.size;
      }
    } catch { /* redis may not support getAllSessions */ }

    // Latest host metrics
    const hostRow = await db.prepare(
      `SELECT * FROM host_metrics ORDER BY collected_at DESC FETCH FIRST 1 ROW ONLY`
    ).get();

    // Latest disk metrics (all mounts)
    const diskRows = await db.prepare(
      `SELECT * FROM (
        SELECT d.*, ROW_NUMBER() OVER (PARTITION BY mount ORDER BY collected_at DESC) rn
        FROM disk_metrics d
      ) WHERE rn = 1`
    ).all();

    // Node statuses
    let nodesSummary = { total: 0, ready: 0 };
    try {
      const nodes = await getK8sResource('/api/v1/nodes', ['get', 'nodes', '-o', 'json']);
      nodesSummary.total = nodes.items?.length || 0;
      nodesSummary.ready = (nodes.items || []).filter(n =>
        n.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True')
      ).length;
    } catch { /* K8s not available */ }

    // Pod statuses
    let podsSummary = { running: 0, error: 0, total: 0 };
    try {
      const pods = await getK8sResource('/api/v1/pods', ['get', 'pods', '--all-namespaces', '-o', 'json']);
      podsSummary.total = pods.items?.length || 0;
      podsSummary.running = (pods.items || []).filter(p => p.status?.phase === 'Running').length;
      // Succeeded (Job 完成) 不算 Error，只有 Failed / Unknown / Pending 才算
      podsSummary.error = (pods.items || []).filter(p => {
        const phase = p.status?.phase;
        return phase !== 'Running' && phase !== 'Succeeded';
      }).length;
    } catch { /* K8s not available */ }

    res.json({
      nodes: nodesSummary,
      pods: podsSummary,
      onlineUsers: onlineCount,
      unresolvedAlerts: alertRow?.cnt || 0,
      host: hostRow || null,
      disks: diskRows || [],
    });
  } catch (e) {
    console.error('[Monitor] summary error:', e.message);
    res.json({ nodes: { total: 0, ready: 0 }, pods: { running: 0, error: 0, total: 0 }, onlineUsers: 0, unresolvedAlerts: 0, host: null, disks: [] });
  }
});

// ─── Nodes ──────────────────────────────────────────────────────────────────
router.get('/nodes', async (req, res) => {
  try {
    const data = await getK8sResource('/api/v1/nodes', ['get', 'nodes', '-o', 'json']);
    res.json(data);
  } catch {
    res.json({ items: [] });
  }
});

router.get('/nodes/detail', async (req, res) => {
  try {
    const nodes = await getK8sResource('/api/v1/nodes', ['get', 'nodes', '-o', 'json']);
    const details = [];

    // Pre-fetch all pods for resource calculation (K8s API fallback)
    let allPods = [];
    try {
      const podData = await getK8sResource('/api/v1/pods', ['get', 'pods', '--all-namespaces', '-o', 'json']);
      allPods = podData.items || [];
    } catch {}

    for (const node of (nodes.items || [])) {
      const name = node.metadata?.name;
      try {
        const desc = await runCmd('kubectl', ['describe', 'node', name]);
        const detail = parseNodeDescribe(name, node, desc);
        details.push(detail);
      } catch {
        const detail = parseNodeFromApi(name, node, allPods);
        details.push(detail);
      }
    }
    res.json(details);
  } catch {
    res.json([]);
  }
});

function parseNodeDescribe(name, nodeObj, descText) {
  const result = {
    name,
    status: 'Unknown',
    role: 'worker',
    allocatable: { cpu: '', memory: '' },
    requests: { cpu: '', memory: '' },
    cpuReqPct: 0,
    memReqPct: 0,
    podCount: 0,
  };

  // Status from node object
  const readyCond = nodeObj.status?.conditions?.find(c => c.type === 'Ready');
  result.status = readyCond?.status === 'True' ? 'Ready' : 'NotReady';

  // Role
  const labels = nodeObj.metadata?.labels || {};
  if (labels['node-role.kubernetes.io/master'] !== undefined ||
      labels['node-role.kubernetes.io/control-plane'] !== undefined) {
    result.role = 'master';
  }

  // Parse Allocatable section
  const allocMatch = descText.match(/Allocatable:\s*\n([\s\S]*?)(?=System Info:|---)/);
  if (allocMatch) {
    const cpuM = allocMatch[1].match(/cpu:\s*(.+)/);
    const memM = allocMatch[1].match(/memory:\s*(.+)/);
    if (cpuM) result.allocatable.cpu = cpuM[1].trim();
    if (memM) result.allocatable.memory = memM[1].trim();
  }

  // Parse Allocated resources
  const reqMatch = descText.match(/Allocated resources[\s\S]*?Resource[\s\S]*?[-]+\s*\n([\s\S]*?)(?=Events:|$)/);
  if (reqMatch) {
    const lines = reqMatch[1].split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'cpu') {
        result.requests.cpu = parts[1] || '';
        const pctMatch = parts[2]?.match(/\((\d+)%\)/);
        if (pctMatch) result.cpuReqPct = parseInt(pctMatch[1]);
      } else if (parts[0] === 'memory') {
        result.requests.memory = parts[1] || '';
        const pctMatch = parts[2]?.match(/\((\d+)%\)/);
        if (pctMatch) result.memReqPct = parseInt(pctMatch[1]);
      }
    }
  }

  // Pod count from Non-terminated Pods
  const podMatch = descText.match(/Non-terminated Pods:\s*\((\d+)/);
  if (podMatch) result.podCount = parseInt(podMatch[1]);

  return result;
}

// ── Helpers: parse K8s resource quantities ──────────────────────────────────
function parseCpuQuantity(str) {
  if (!str) return 0;
  str = String(str).trim();
  if (str.endsWith('m')) return parseInt(str) || 0;       // millicores
  if (str.endsWith('n')) return (parseInt(str) || 0) / 1e6; // nanocores → millicores
  return (parseFloat(str) || 0) * 1000;                   // cores → millicores
}

function parseMemQuantity(str) {
  if (!str) return 0;
  str = String(str).trim();
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  for (const [suffix, mult] of Object.entries(units)) {
    if (str.endsWith(suffix)) return (parseFloat(str) || 0) * mult;
  }
  return parseFloat(str) || 0; // bytes
}

function formatCpuMillis(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}` : `${Math.round(m)}m`;
}

function formatMemBytes(b) {
  if (b >= 1024 ** 3) return `${(b / (1024 ** 3)).toFixed(1)}Gi`;
  if (b >= 1024 ** 2) return `${Math.round(b / (1024 ** 2))}Mi`;
  return `${Math.round(b / 1024)}Ki`;
}

// Fallback: build node detail from K8s API object + pods (when kubectl describe unavailable)
function parseNodeFromApi(name, nodeObj, allPods = []) {
  const labels = nodeObj.metadata?.labels || {};
  const readyCond = nodeObj.status?.conditions?.find(c => c.type === 'Ready');
  const alloc = nodeObj.status?.allocatable || {};
  const cap = nodeObj.status?.capacity || {};

  // Filter running pods on this node
  const nodePods = allPods.filter(p =>
    p.spec?.nodeName === name && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed'
  );

  // Sum resource requests from all containers on this node
  let totalCpuReqMillis = 0;
  let totalMemReqBytes = 0;
  for (const pod of nodePods) {
    for (const c of (pod.spec?.containers || [])) {
      totalCpuReqMillis += parseCpuQuantity(c.resources?.requests?.cpu);
      totalMemReqBytes += parseMemQuantity(c.resources?.requests?.memory);
    }
  }

  const allocCpuMillis = parseCpuQuantity(alloc.cpu || cap.cpu);
  const allocMemBytes = parseMemQuantity(alloc.memory || cap.memory);

  const cpuReqPct = allocCpuMillis > 0 ? Math.round((totalCpuReqMillis / allocCpuMillis) * 100) : 0;
  const memReqPct = allocMemBytes > 0 ? Math.round((totalMemReqBytes / allocMemBytes) * 100) : 0;

  return {
    name,
    status: readyCond?.status === 'True' ? 'Ready' : 'NotReady',
    role: (labels['node-role.kubernetes.io/master'] !== undefined ||
           labels['node-role.kubernetes.io/control-plane'] !== undefined) ? 'master' : 'worker',
    allocatable: { cpu: alloc.cpu || cap.cpu || '', memory: alloc.memory || cap.memory || '' },
    requests: { cpu: formatCpuMillis(totalCpuReqMillis), memory: formatMemBytes(totalMemReqBytes) },
    cpuReqPct,
    memReqPct,
    podCount: nodePods.length,
  };
}

router.get('/nodes/history', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const hours = parseInt(req.query.hours) || 24;
    let rows;
    if (hours <= 24) {
      rows = await db.prepare(
        `SELECT * FROM node_metrics
         WHERE collected_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
         ORDER BY collected_at ASC`
      ).all();
    } else {
      const bucketHours = hours <= 168 ? 1 : 4;
      rows = await db.prepare(
        `SELECT node_name,
                TRUNC(collected_at, 'HH') - NUMTODSINTERVAL(MOD(EXTRACT(HOUR FROM collected_at), ${bucketHours}), 'HOUR') AS collected_at,
                AVG(cpu_req_pct) AS cpu_req_pct, AVG(mem_req_pct) AS mem_req_pct,
                AVG(pod_count) AS pod_count
         FROM node_metrics
         WHERE collected_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
         GROUP BY node_name,
                  TRUNC(collected_at, 'HH') - NUMTODSINTERVAL(MOD(EXTRACT(HOUR FROM collected_at), ${bucketHours}), 'HOUR')
         ORDER BY 2 ASC, 1 ASC`
      ).all();
    }
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// ─── Pods ───────────────────────────────────────────────────────────────────
router.get('/pods', async (req, res) => {
  try {
    const data = await getK8sResource('/api/v1/pods', ['get', 'pods', '--all-namespaces', '-o', 'json']);
    res.json(data);
  } catch {
    res.json({ items: [] });
  }
});

// ─── K8s Events ─────────────────────────────────────────────────────────────
router.get('/events', async (req, res) => {
  try {
    const data = await getK8sResource('/api/v1/events', ['get', 'events', '--all-namespaces', '-o', 'json']);
    res.json(data);
  } catch {
    res.json({ items: [] });
  }
});

// ─── Host Metrics (current, from /proc) ─────────────────────────────────────
router.get('/host/current', async (req, res) => {
  try {
    const metrics = await collectHostMetrics();
    res.json(metrics);
  } catch {
    res.json({ load_1m: 0, load_5m: 0, load_15m: 0, mem_total_mb: 0, mem_used_mb: 0, uptime_sec: 0 });
  }
});

async function collectHostMetrics() {
  const result = {
    load_1m: 0, load_5m: 0, load_15m: 0,
    mem_total_mb: 0, mem_used_mb: 0, mem_cached_mb: 0, swap_used_mb: 0,
    net_rx_mb: 0, net_tx_mb: 0,
    disk_read_mb: 0, disk_write_mb: 0,
    uptime_sec: 0,
  };

  if (os.platform() === 'linux') {
    try {
      // Load average
      const loadavg = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
      result.load_1m = parseFloat(loadavg[0]) || 0;
      result.load_5m = parseFloat(loadavg[1]) || 0;
      result.load_15m = parseFloat(loadavg[2]) || 0;
    } catch {}

    try {
      // Memory info
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const memTotal = meminfo.match(/MemTotal:\s+(\d+)/);
      const memFree = meminfo.match(/MemFree:\s+(\d+)/);
      const memAvailable = meminfo.match(/MemAvailable:\s+(\d+)/);
      const cached = meminfo.match(/Cached:\s+(\d+)/);
      const swapTotal = meminfo.match(/SwapTotal:\s+(\d+)/);
      const swapFree = meminfo.match(/SwapFree:\s+(\d+)/);

      if (memTotal) result.mem_total_mb = Math.round(parseInt(memTotal[1]) / 1024);
      if (memTotal && memAvailable) {
        result.mem_used_mb = Math.round((parseInt(memTotal[1]) - parseInt(memAvailable[1])) / 1024);
      } else if (memTotal && memFree) {
        result.mem_used_mb = Math.round((parseInt(memTotal[1]) - parseInt(memFree[1])) / 1024);
      }
      if (cached) result.mem_cached_mb = Math.round(parseInt(cached[1]) / 1024);
      if (swapTotal && swapFree) {
        result.swap_used_mb = Math.round((parseInt(swapTotal[1]) - parseInt(swapFree[1])) / 1024);
      }
    } catch {}

    try {
      // Uptime
      const uptime = fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/);
      result.uptime_sec = Math.round(parseFloat(uptime[0]) || 0);
    } catch {}

    try {
      // Network I/O (aggregate all non-lo interfaces)
      const netdev = fs.readFileSync('/proc/net/dev', 'utf8');
      const lines = netdev.split('\n').slice(2);
      let totalRx = 0, totalTx = 0;
      for (const line of lines) {
        const parts = line.trim().split(/[\s:]+/);
        if (parts.length < 11 || parts[0] === 'lo') continue;
        totalRx += parseInt(parts[1]) || 0;
        totalTx += parseInt(parts[9]) || 0;
      }
      result.net_rx_mb = Math.round(totalRx / 1024 / 1024 * 100) / 100;
      result.net_tx_mb = Math.round(totalTx / 1024 / 1024 * 100) / 100;
    } catch {}

    try {
      // Disk I/O
      const diskstats = fs.readFileSync('/proc/diskstats', 'utf8');
      let totalRead = 0, totalWrite = 0;
      for (const line of diskstats.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 14) continue;
        const devName = parts[2];
        // Only major devices (sda, vda, nvme0n1, etc.)
        if (/^(sd|vd|nvme|xvd)[a-z0-9]+$/.test(devName) && !/\d+$/.test(devName.replace(/nvme\d+n\d+/, ''))) {
          totalRead += parseInt(parts[5]) || 0;   // sectors read
          totalWrite += parseInt(parts[9]) || 0;  // sectors written
        }
      }
      // sectors are typically 512 bytes
      result.disk_read_mb = Math.round(totalRead * 512 / 1024 / 1024 * 100) / 100;
      result.disk_write_mb = Math.round(totalWrite * 512 / 1024 / 1024 * 100) / 100;
    } catch {}
  } else {
    // Windows / other: use os module fallbacks
    result.uptime_sec = Math.round(os.uptime());
    result.mem_total_mb = Math.round(os.totalmem() / 1024 / 1024);
    result.mem_used_mb = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
    const loadavg = os.loadavg();
    result.load_1m = loadavg[0];
    result.load_5m = loadavg[1];
    result.load_15m = loadavg[2];
  }

  return result;
}

router.get('/host/history', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const hours = parseInt(req.query.hours) || 24;
    let rows;
    if (hours <= 24) {
      // 原始 5 分鐘粒度
      rows = await db.prepare(
        `SELECT * FROM host_metrics
         WHERE collected_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
         ORDER BY collected_at ASC`
      ).all();
    } else {
      // 7d → 每小時平均；30d → 每 4 小時平均
      const bucketHours = hours <= 168 ? 1 : 4;
      rows = await db.prepare(
        `SELECT TRUNC(collected_at, 'HH') - NUMTODSINTERVAL(MOD(EXTRACT(HOUR FROM collected_at), ${bucketHours}), 'HOUR') AS collected_at,
                AVG(load_1m) AS load_1m, AVG(load_5m) AS load_5m, AVG(load_15m) AS load_15m,
                AVG(mem_total_mb) AS mem_total_mb, AVG(mem_used_mb) AS mem_used_mb,
                AVG(mem_cached_mb) AS mem_cached_mb, AVG(swap_used_mb) AS swap_used_mb,
                AVG(net_rx_mb) AS net_rx_mb, AVG(net_tx_mb) AS net_tx_mb,
                AVG(disk_read_mb) AS disk_read_mb, AVG(disk_write_mb) AS disk_write_mb
         FROM host_metrics
         WHERE collected_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
         GROUP BY TRUNC(collected_at, 'HH') - NUMTODSINTERVAL(MOD(EXTRACT(HOUR FROM collected_at), ${bucketHours}), 'HOUR')
         ORDER BY 1 ASC`
      ).all();
    }
    res.json(rows);
  } catch {
    res.json([]);
  }
});

router.get('/host/processes', async (req, res) => {
  try {
    let processes = [];
    if (os.platform() === 'linux') {
      try {
        const out = await runCmd('ps', ['aux', '--sort=-%cpu'], 5000);
        const lines = out.split('\n').slice(1, 21); // top 20
        processes = lines.filter(l => l.trim()).map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            user: parts[0], pid: parts[1],
            cpu: parseFloat(parts[2]) || 0,
            mem: parseFloat(parts[3]) || 0,
            command: parts.slice(10).join(' '),
          };
        });
      } catch {}
    }
    res.json(processes);
  } catch {
    res.json([]);
  }
});

// ─── Docker Images ──────────────────────────────────────────────────────────
router.get('/images', async (req, res) => {
  try {
    // Try docker CLI first
    try {
      const out = await runCmd('docker', ['images', '--format', '{{json .}}']);
      const images = out.trim().split('\n').filter(Boolean).map(l => tryParseJSON(l)).filter(Boolean);
      return res.json(images);
    } catch {}

    // Fallback: Docker socket API
    if (hasDockerSocket()) {
      const raw = await dockerApiGet('/images/json');
      const images = (raw || []).map(img => ({
        Repository: (img.RepoTags?.[0] || '<none>:<none>').split(':')[0],
        Tag: (img.RepoTags?.[0] || '<none>:<none>').split(':')[1] || '<none>',
        ID: (img.Id || '').replace('sha256:', '').slice(0, 12),
        Size: `${Math.round((img.Size || 0) / 1024 / 1024)}MB`,
        CreatedAt: img.Created ? new Date(img.Created * 1000).toISOString() : '',
      }));
      return res.json(images);
    }
    res.json([]);
  } catch {
    res.json([]);
  }
});

router.post('/images/prune', async (req, res) => {
  try {
    try {
      const out = await runCmd('docker', ['image', 'prune', '-f'], 60000);
      return res.json({ message: 'Prune completed', output: out });
    } catch {}
    if (hasDockerSocket()) {
      const result = await dockerApiPost('/images/prune');
      return res.json({ message: 'Prune completed', output: JSON.stringify(result) });
    }
    res.status(500).json({ error: 'Docker not available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Docker Containers ──────────────────────────────────────────────────────
router.get('/containers', async (req, res) => {
  try {
    // Try docker CLI first
    try {
      const out = await runCmd('docker', ['ps', '-a', '--format', '{{json .}}']);
      const containers = out.trim().split('\n').filter(Boolean).map(l => tryParseJSON(l)).filter(Boolean);
      return res.json(containers);
    } catch {}

    // Fallback: Docker socket API
    if (hasDockerSocket()) {
      const raw = await dockerApiGet('/containers/json?all=true');
      const containers = (raw || []).map(c => ({
        ID: (c.Id || '').slice(0, 12),
        Names: (c.Names || []).map(n => n.replace(/^\//, '')).join(', '),
        Image: c.Image || '',
        Status: c.Status || '',
        State: c.State || '',
        RunningFor: c.Status || '',
        Ports: (c.Ports || []).map(p => p.PublicPort ? `${p.PublicPort}->${p.PrivatePort}/${p.Type}` : `${p.PrivatePort}/${p.Type}`).join(', '),
      }));
      return res.json(containers);
    }
    res.json([]);
  } catch {
    res.json([]);
  }
});

router.get('/containers/:id/stats', async (req, res) => {
  try {
    try {
      const out = await runCmd('docker', ['stats', '--no-stream', '--format', '{{json .}}', req.params.id]);
      return res.json(tryParseJSON(out.trim()) || {});
    } catch {}
    if (hasDockerSocket()) {
      const stats = await dockerApiGet(`/containers/${req.params.id}/stats?stream=false`);
      return res.json(stats || {});
    }
    res.status(500).json({ error: 'Docker not available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/containers/:id/restart', async (req, res) => {
  try {
    try {
      await runCmd('docker', ['restart', req.params.id], 30000);
      return res.json({ message: `Container ${req.params.id} restarted` });
    } catch {}
    if (hasDockerSocket()) {
      await dockerApiPost(`/containers/${req.params.id}/restart`);
      return res.json({ message: `Container ${req.params.id} restarted` });
    }
    res.status(500).json({ error: 'Docker not available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/containers/:id/stop', async (req, res) => {
  try {
    try {
      await runCmd('docker', ['stop', req.params.id], 30000);
      return res.json({ message: `Container ${req.params.id} stopped` });
    } catch {}
    if (hasDockerSocket()) {
      await dockerApiPost(`/containers/${req.params.id}/stop`);
      return res.json({ message: `Container ${req.params.id} stopped` });
    }
    res.status(500).json({ error: 'Docker not available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/containers/:id/start', async (req, res) => {
  try {
    try {
      await runCmd('docker', ['start', req.params.id]);
      return res.json({ message: `Container ${req.params.id} started` });
    } catch {}
    if (hasDockerSocket()) {
      await dockerApiPost(`/containers/${req.params.id}/start`);
      return res.json({ message: `Container ${req.params.id} started` });
    }
    res.status(500).json({ error: 'Docker not available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Helper: stream pod logs via K8s API ────────────────────────────────────
function streamPodLogViaApi(req, res, ns, pod, tail, since) {
  const https = require('https');
  const token = fs.readFileSync(K8S_TOKEN_PATH, 'utf8').trim();
  const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  let ca; try { ca = fs.readFileSync(K8S_CA_PATH); } catch {}
  const params = new URLSearchParams({ follow: 'true', timestamps: 'true' });
  if (since && /^\d{4}-\d{2}-\d{2}/.test(since)) {
    params.set('sinceTime', since);
  } else if (since) {
    // 轉 duration 到秒 (e.g. "1h" → 3600)
    const match = since.match(/^(\d+)(s|m|h|d)$/);
    if (match) {
      const units = { s: 1, m: 60, h: 3600, d: 86400 };
      params.set('sinceSeconds', String(parseInt(match[1]) * (units[match[2]] || 1)));
    }
  } else if (tail > 0) {
    params.set('tailLines', String(tail));
  } else {
    params.set('sinceSeconds', '3600'); // 預設 1 小時
  }
  const url = `https://${host}:${port}/api/v1/namespaces/${ns}/pods/${pod}/log?${params}`;

  const apiReq = https.get(url, {
    headers: { Authorization: `Bearer ${token}` }, ca, rejectUnauthorized: !!ca,
  }, (apiRes) => {
    apiRes.on('data', d => {
      const lines = d.toString('utf8').split('\n');
      for (const line of lines) {
        if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
      }
    });
    apiRes.on('end', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });
  });
  apiReq.on('error', (e) => {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  });
  req.on('close', () => { apiReq.destroy(); });
}

// ─── Log Streaming (SSE) ────────────────────────────────────────────────────
router.get('/logs/pod/:ns/:pod', (req, res) => {
  const { ns, pod } = req.params;
  const since = req.query.since || '';  // ISO date string or duration like "1h"
  const tail = parseInt(req.query.tail) || 0;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // If K8s service account available, use API directly (no kubectl needed)
  if (hasK8sServiceAccount()) {
    return streamPodLogViaApi(req, res, ns, pod, tail, since);
  }

  // Fallback: try kubectl
  const args = ['logs', '-f', '--timestamps', '-n', ns, pod];
  if (since) {
    // ISO date → --since-time; otherwise --since (e.g. "1h", "30m")
    if (/^\d{4}-\d{2}-\d{2}/.test(since)) {
      args.push('--since-time', since);
    } else {
      args.push('--since', since);
    }
  } else if (tail > 0) {
    args.push('--tail', String(tail));
  } else {
    // 預設顯示最近 1 小時
    args.push('--since', '1h');
  }
  const proc = spawn('kubectl', args, { shell: true });

  proc.stdout.on('data', d => {
    const lines = d.toString('utf8').split('\n');
    for (const line of lines) {
      if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
  });
  proc.stderr.on('data', d => {
    res.write(`data: ${JSON.stringify({ error: d.toString('utf8') })}\n\n`);
  });
  proc.on('error', () => {});
  proc.on('close', (code) => {
    res.write(`data: ${JSON.stringify({ done: true, exitCode: code })}\n\n`);
    res.end();
  });

  req.on('close', () => {
    proc.kill();
  });
});

router.get('/logs/container/:id', (req, res) => {
  const since = req.query.since || '';
  const tail = parseInt(req.query.tail) || 0;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Try docker CLI first
  const args = ['logs', '-f', '--timestamps'];
  if (since) {
    args.push('--since', since); // Docker accepts ISO date or duration like "1h"
  } else if (tail > 0) {
    args.push('--tail', String(tail));
  } else {
    args.push('--since', '1h');
  }
  args.push(req.params.id);
  const proc = spawn('docker', args, { shell: true });
  let dockerFailed = false;

  proc.stdout.on('data', d => {
    const lines = d.toString('utf8').split('\n');
    for (const line of lines) {
      if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
  });
  proc.stderr.on('data', d => {
    const lines = d.toString('utf8').split('\n');
    for (const line of lines) {
      if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
  });
  proc.on('error', () => { dockerFailed = true; });
  proc.on('close', async (code) => {
    if (code !== 0 && dockerFailed && hasDockerSocket()) {
      // Fallback: Docker socket API for logs
      try {
        const http = require('http');
        const apiReq = http.get({
          socketPath: DOCKER_SOCKET,
          path: `/containers/${req.params.id}/logs?stdout=true&stderr=true&follow=true&tail=${tail}`,
        }, (apiRes) => {
          apiRes.on('data', d => {
            // Docker log API prepends 8-byte header per frame; strip it
            let buf = d;
            while (buf.length > 8) {
              const frameLen = buf.readUInt32BE(4);
              const text = buf.slice(8, 8 + frameLen).toString('utf8');
              for (const line of text.split('\n')) {
                if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
              }
              buf = buf.slice(8 + frameLen);
            }
          });
          apiRes.on('end', () => {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
          });
        });
        apiReq.on('error', (e) => {
          res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
          res.end();
        });
        req.on('close', () => { apiReq.destroy(); });
      } catch (e) {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      }
    } else {
      res.write(`data: ${JSON.stringify({ done: true, exitCode: code })}\n\n`);
      res.end();
    }
  });

  req.on('close', () => {
    proc.kill();
  });
});

// ─── Disk / NAS ─────────────────────────────────────────────────────────────
router.get('/disk', async (req, res) => {
  let disks = [];
  try {
    if (os.platform() === 'linux') {
      try {
        const dfOut = await runCmd('df', ['-h', '--output=source,target,size,used,avail,pcent']);
        const diOut = await runCmd('df', ['-i', '--output=source,target,ipcent']).catch(() => '');

        const inodeMap = {};
        for (const line of (diOut || '').split('\n').slice(1)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) inodeMap[parts[1]] = parts[2];
        }

        for (const line of dfOut.split('\n').slice(1)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 6) continue;
          const mount = parts[1];
          const device = parts[0];
          if (['tmpfs', 'devtmpfs'].includes(device)) continue;
          if (mount.startsWith('/sys') || mount.startsWith('/proc') || mount.startsWith('/dev/shm') || mount.startsWith('/run')) continue;

          disks.push({
            device,
            mount,
            total: parts[2],
            used: parts[3],
            available: parts[4],
            use_pct: parseFloat(parts[5].replace('%', '')) || 0,
            inode_pct: parseFloat((inodeMap[mount] || '0').replace('%', '')) || 0,
            is_mounted: true,
          });
        }
      } catch (e) {
        console.warn('[Monitor] df failed:', e.message);
      }
    }
  } catch {}
  res.json(disks);
});

router.get('/disk/history', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const days = parseInt(req.query.days) || 7;
    const mount = req.query.mount || null;
    let rows;
    if (days <= 7) {
      // 每小時原始資料
      let sql = `SELECT * FROM disk_metrics WHERE collected_at > SYSTIMESTAMP - INTERVAL '${days}' DAY`;
      const binds = [];
      if (mount) { sql += ` AND mount = ?`; binds.push(mount); }
      sql += ` ORDER BY collected_at ASC`;
      rows = await db.prepare(sql).all(...binds);
    } else {
      // 30d → 每 6 小時平均
      const mountFilter = mount ? `AND mount = ?` : '';
      const binds = mount ? [mount] : [];
      rows = await db.prepare(
        `SELECT mount,
                TRUNC(collected_at, 'HH') - NUMTODSINTERVAL(MOD(EXTRACT(HOUR FROM collected_at), 6), 'HOUR') AS collected_at,
                AVG(use_pct) AS use_pct, AVG(inode_pct) AS inode_pct, MIN(is_mounted) AS is_mounted
         FROM disk_metrics
         WHERE collected_at > SYSTIMESTAMP - INTERVAL '${days}' DAY ${mountFilter}
         GROUP BY mount,
                  TRUNC(collected_at, 'HH') - NUMTODSINTERVAL(MOD(EXTRACT(HOUR FROM collected_at), 6), 'HOUR')
         ORDER BY 2 ASC, 1 ASC`
      ).all(...binds);
    }
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// ─── Online Users ───────────────────────────────────────────────────────────
router.get('/online-users', async (req, res) => {
  try {
    const redis = require('../services/redisClient');
    const db = require('../database-oracle').db;
    let users = [];
    try {
      const sessions = await redis.getAllSessions();
      if (sessions) {
        const seen = new Map();
        for (const s of sessions) {
          if (!s.id) continue;
          if (!seen.has(s.id)) {
            seen.set(s.id, {
              id: s.id,
              username: s.username,
              name: s.name,
              employee_id: s.employee_id,
              email: s.email || null,
              role: s.role || 'user',
              loginTime: s.loginTime || null,
              dept_code: s.dept_code || null,
              profit_center: s.profit_center || null,
              org_section: s.org_section || null,
              org_group_name: null, // will fill from DB
              current_page: s.current_page || null,
              current_page_title: s.current_page_title || null,
              current_page_at: s.current_page_at || null,
            });
          }
        }
        // Batch-fill org_group_name from DB for all online user IDs
        const userIds = Array.from(seen.keys());
        if (userIds.length > 0) {
          try {
            const placeholders = userIds.map(() => '?').join(',');
            const rows = await db.prepare(
              `SELECT id, dept_code, profit_center, org_section, org_group_name FROM users WHERE id IN (${placeholders})`
            ).all(...userIds);
            for (const row of rows) {
              const u = seen.get(row.id);
              if (u) {
                u.org_group_name = row.org_group_name || null;
                // Backfill from DB if session didn't have these
                if (!u.dept_code) u.dept_code = row.dept_code || null;
                if (!u.profit_center) u.profit_center = row.profit_center || null;
                if (!u.org_section) u.org_section = row.org_section || null;
              }
            }
          } catch {}
        }
        users = Array.from(seen.values());
      }
    } catch {}
    res.json({ count: users.length, users });
  } catch {
    res.json({ count: 0, users: [] });
  }
});

router.get('/online-users/history', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const hours = parseInt(req.query.hours) || 24;
    const rows = await db.prepare(
      `SELECT * FROM online_user_snapshots
       WHERE collected_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
       ORDER BY collected_at ASC`
    ).all();
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// ─── Health Checks ──────────────────────────────────────────────────────────
router.get('/health-checks', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const checks = await db.prepare(`SELECT * FROM health_checks ORDER BY id`).all();

    // Attach latest result + 30-day uptime for each
    for (const check of checks) {
      const latest = await db.prepare(
        `SELECT * FROM health_check_results WHERE check_id = ? ORDER BY checked_at DESC FETCH FIRST 1 ROW ONLY`
      ).get(check.id);
      check.latestResult = latest || null;

      const uptimeRow = await db.prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN is_up = 1 THEN 1 ELSE 0 END) AS up_count
         FROM health_check_results
         WHERE check_id = ? AND checked_at > SYSTIMESTAMP - INTERVAL '30' DAY`
      ).get(check.id);
      check.uptime30d = uptimeRow?.total > 0
        ? Math.round((uptimeRow.up_count / uptimeRow.total) * 10000) / 100
        : null;
    }
    res.json(checks);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/health-checks', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, url, method, expected_status, timeout_ms } = req.body;
    const result = await db.prepare(
      `INSERT INTO health_checks (name, url, method, expected_status, timeout_ms) VALUES (?,?,?,?,?)`
    ).run(name, url, method || 'GET', expected_status || 200, timeout_ms || 5000);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/health-checks/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, url, method, expected_status, timeout_ms, enabled } = req.body;
    await db.prepare(
      `UPDATE health_checks SET name=?, url=?, method=?, expected_status=?, timeout_ms=?, enabled=? WHERE id=?`
    ).run(name, url, method, expected_status, timeout_ms, enabled ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/health-checks/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM health_checks WHERE id=?`).run(req.params.id);
    await db.prepare(`DELETE FROM health_check_results WHERE check_id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/health-checks/:id/results', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const hours = parseInt(req.query.hours) || 24;
    const rows = await db.prepare(
      `SELECT * FROM health_check_results
       WHERE check_id = ? AND checked_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
       ORDER BY checked_at ASC`
    ).all(req.params.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Deploy ─────────────────────────────────────────────────────────────────
router.post('/deploy', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const db = require('../database-oracle').db;
  const userId = req.user.id;
  let gitBefore = '', gitAfter = '', logText = '';

  try {
    gitBefore = execSync('git rev-parse HEAD', { cwd: process.env.DEPLOY_DIR || process.cwd() }).toString().trim();
  } catch {}

  res.write(`data: ${JSON.stringify({ status: 'starting', gitBefore })}\n\n`);

  const deployDir = process.env.DEPLOY_DIR || process.cwd();
  const proc = spawn('bash', ['-c', `cd ${deployDir} && git pull && ./deploy.sh`], { shell: true });

  proc.stdout.on('data', d => {
    const text = d.toString('utf8');
    logText += text;
    res.write(`data: ${JSON.stringify({ line: text })}\n\n`);
  });
  proc.stderr.on('data', d => {
    const text = d.toString('utf8');
    logText += text;
    res.write(`data: ${JSON.stringify({ line: text })}\n\n`);
  });
  proc.on('close', async (code) => {
    try {
      gitAfter = execSync('git rev-parse HEAD', { cwd: deployDir }).toString().trim();
    } catch {}

    // Save deploy history
    try {
      await db.prepare(
        `INSERT INTO deploy_history (triggered_by, git_before, git_after, exit_code, log_text) VALUES (?,?,?,?,?)`
      ).run(userId, gitBefore, gitAfter, code, logText.slice(0, 32000));
    } catch (e) {
      console.error('[Monitor] Failed to save deploy history:', e.message);
    }

    res.write(`data: ${JSON.stringify({ done: true, exitCode: code, gitBefore, gitAfter })}\n\n`);
    res.end();
  });

  req.on('close', () => {
    proc.kill();
  });
});

router.get('/deploy/history', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(
      `SELECT d.*, u.name AS triggered_by_name, u.username AS triggered_by_username
       FROM deploy_history d
       LEFT JOIN users u ON d.triggered_by = u.id
       ORDER BY d.deployed_at DESC
       FETCH FIRST 50 ROWS ONLY`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Alerts ─────────────────────────────────────────────────────────────────
router.get('/alerts', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const resolved = req.query.resolved;
    const days = parseInt(req.query.days) || 7;
    const conditions = [`notified_at > SYSTIMESTAMP - INTERVAL '${days}' DAY`];
    if (resolved === 'false') conditions.push('resolved_at IS NULL');
    else if (resolved === 'true') conditions.push('resolved_at IS NOT NULL');
    const sql = `SELECT * FROM monitor_alerts WHERE ${conditions.join(' AND ')} ORDER BY notified_at DESC FETCH FIRST 500 ROWS ONLY`;
    const rows = await db.prepare(sql).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/:id/resolve', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(
      `UPDATE monitor_alerts SET resolved_at = SYSTIMESTAMP WHERE id = ?`
    ).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Batch resolve all unresolved alerts
router.post('/alerts/resolve-all', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(
      `UPDATE monitor_alerts SET resolved_at = SYSTIMESTAMP WHERE resolved_at IS NULL`
    ).run();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Snooze an alert for N days
router.post('/alerts/:id/snooze', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const days = parseInt(req.body.days) || 7;
    await db.prepare(
      `UPDATE monitor_alerts SET snoozed_until = SYSTIMESTAMP + INTERVAL '${days}' DAY WHERE id = ?`
    ).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Monitor Settings ───────────────────────────────────────────────────────
const MONITOR_SETTING_KEYS = [
  'monitor_log_retention_days', 'monitor_metrics_retention_days',
  'monitor_disk_retention_days', 'monitor_online_retention_days',
  'monitor_health_check_retention',
  'monitor_alert_enabled', 'monitor_alert_cooldown',
  'monitor_cpu_threshold', 'monitor_mem_threshold', 'monitor_disk_threshold',
  'monitor_pod_restart_limit', 'monitor_pod_pending_minutes',
  'monitor_load_threshold',
  'monitor_alert_webhook_url', 'monitor_alert_webhook_enabled',
  'monitor_alert_webhook_type',
  'monitor_ai_model',
  'monitor_dept_snapshot_interval',
  'monitor_dept_retention_days',
];

router.get('/settings', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const placeholders = MONITOR_SETTING_KEYS.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT key, value FROM system_settings WHERE key IN (${placeholders})`
    ).all(...MONITOR_SETTING_KEYS);
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      if (!MONITOR_SETTING_KEYS.includes(key)) continue;
      const existing = await db.prepare(`SELECT key FROM system_settings WHERE key=?`).get(key);
      if (existing) {
        await db.prepare(`UPDATE system_settings SET value=? WHERE key=?`).run(String(value), key);
      } else {
        await db.prepare(`INSERT INTO system_settings (key, value) VALUES (?,?)`).run(key, String(value));
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI Diagnose ─────────────────────────────────────────────────────────────
router.post('/alerts/:id/diagnose', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const alert = await db.prepare(`SELECT * FROM monitor_alerts WHERE id=?`).get(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    // Get AI model from settings
    const modelSetting = await db.prepare(`SELECT value FROM system_settings WHERE key='monitor_ai_model'`).get();
    const modelKey = modelSetting?.value || 'flash';
    const modelName = modelKey === 'pro'
      ? (process.env.GEMINI_MODEL_PRO || 'gemini-2.5-pro-preview-05-06')
      : (process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash-preview-05-20');

    // Collect context
    let podDetail = '';
    let podLogs = '';
    const resourceName = alert.resource_name || '';

    if (alert.alert_type === 'pod_crash' || alert.alert_type === 'pod_pending') {
      // resource_name format: "ns/podname/container" or "ns/podname"
      const parts = resourceName.split('/');
      const ns = parts[0] || 'default';
      const podPrefix = parts[1] || '';

      // Get pod detail from K8s API
      try {
        const podData = await getK8sResource(`/api/v1/namespaces/${ns}/pods`, ['get', 'pods', '-n', ns, '-o', 'json']);
        const matchPod = (podData.items || []).find(p => p.metadata?.name?.startsWith(podPrefix));
        if (matchPod) {
          podDetail = JSON.stringify({
            name: matchPod.metadata?.name,
            namespace: ns,
            phase: matchPod.status?.phase,
            conditions: matchPod.status?.conditions,
            containerStatuses: matchPod.status?.containerStatuses,
            nodeName: matchPod.spec?.nodeName,
          }, null, 2);

          // Get pod logs (last 50 lines)
          try {
            const https = require('https');
            const token = fs.readFileSync(K8S_TOKEN_PATH, 'utf8').trim();
            const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
            const port = process.env.KUBERNETES_SERVICE_PORT || '443';
            let ca; try { ca = fs.readFileSync(K8S_CA_PATH); } catch {}
            const logUrl = `https://${host}:${port}/api/v1/namespaces/${ns}/pods/${matchPod.metadata.name}/log?tailLines=50`;
            podLogs = await new Promise((resolve) => {
              const apiReq = https.get(logUrl, {
                headers: { Authorization: `Bearer ${token}` }, ca, rejectUnauthorized: !!ca,
              }, (apiRes) => {
                let body = '';
                apiRes.on('data', d => body += d.toString());
                apiRes.on('end', () => resolve(body));
              });
              apiReq.on('error', () => resolve('(unable to fetch logs)'));
              setTimeout(() => { apiReq.destroy(); resolve('(timeout)'); }, 10000);
            });
          } catch {}
        }
      } catch {}
    }

    // Build prompt
    const prompt = `你是 Kubernetes 運維專家。請根據以下 K8s 告警事件分析可能原因，並給出具體修復步驟。
如果需要執行指令，請以 \`\`\`bash 代碼塊格式呈現方便複製。

## 告警資訊
- **類型**: ${alert.alert_type}
- **嚴重度**: ${alert.severity}
- **資源**: ${alert.resource_name}
- **訊息**: ${alert.message}
- **時間**: ${alert.notified_at}

${podDetail ? `## Pod 狀態\n\`\`\`json\n${podDetail}\n\`\`\`\n` : ''}
${podLogs ? `## 最近 Logs (last 50 lines)\n\`\`\`\n${podLogs}\n\`\`\`\n` : ''}

請用繁體中文回答，包含：
1. 問題分析（可能原因）
2. 建議修復步驟
3. 預防措施`;

    // SSE streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    }
  }
});

// ─── Online Dept Snapshots ───────────────────────────────────────────────────
router.get('/online-dept/history', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const hours = parseInt(req.query.hours) || 24;
    const rows = await db.prepare(
      `SELECT * FROM online_dept_snapshots
       WHERE collected_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
       ORDER BY collected_at ASC`
    ).all();

    // Build code→name lookup from FL_ORG_EMP_DEPT_MV (authoritative source, 20-min cached).
    // Fallback to users table if ERP is unavailable.
    let pcMap = new Map();   // profit_center code → profit_center_name
    let osMap = new Map();   // org_section code   → org_section_name
    try {
      const { getOrgCodeNameMaps } = require('../services/orgHierarchyService');
      const { getErpPool }         = require('../services/dashboardService');
      ({ pcMap, osMap } = await getOrgCodeNameMaps(getErpPool));
    } catch {
      // ERP unavailable: fallback to users table
      try {
        const mappings = await db.prepare(
          `SELECT DISTINCT profit_center, profit_center_name, org_section, org_section_name
           FROM users WHERE profit_center IS NOT NULL OR org_section IS NOT NULL`
        ).all();
        for (const r of mappings) {
          if (r.profit_center && r.profit_center_name) pcMap.set(r.profit_center, r.profit_center_name);
          if (r.org_section   && r.org_section_name)   osMap.set(r.org_section,   r.org_section_name);
        }
      } catch { /* ignore */ }
    }

    // Enrich every row (old and new) with authoritative names from MV
    const enriched = rows.map(r => ({
      ...r,
      profit_center_name: pcMap.get(r.profit_center) || r.profit_center_name || null,
      org_section_name:   osMap.get(r.org_section)   || r.org_section_name   || null,
    }));

    res.json(enriched);
  } catch {
    res.json([]);
  }
});

// Export helpers for metricsCollector
module.exports = router;
module.exports.collectHostMetrics = collectHostMetrics;
module.exports.parseNodeDescribe = parseNodeDescribe;
module.exports.getK8sResource = getK8sResource;
module.exports.hasDockerSocket = hasDockerSocket;
module.exports.dockerApiGet = dockerApiGet;
