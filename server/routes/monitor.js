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

// ─── Dashboard Summary ──────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const redis = require('../services/redisClient');

    // Unresolved alerts count
    const alertRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM monitor_alerts WHERE resolved_at IS NULL`
    ).get();

    // Online users
    let onlineCount = 0;
    try {
      const sessions = await redis.getAllSessions();
      onlineCount = sessions ? sessions.length : 0;
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
      const nodesJson = await runCmd('kubectl', ['get', 'nodes', '-o', 'json']);
      const nodes = JSON.parse(nodesJson);
      nodesSummary.total = nodes.items?.length || 0;
      nodesSummary.ready = (nodes.items || []).filter(n =>
        n.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True')
      ).length;
    } catch { /* kubectl not available */ }

    // Pod statuses
    let podsSummary = { running: 0, error: 0, total: 0 };
    try {
      const podsJson = await runCmd('kubectl', ['get', 'pods', '--all-namespaces', '-o', 'json']);
      const pods = JSON.parse(podsJson);
      podsSummary.total = pods.items?.length || 0;
      podsSummary.running = (pods.items || []).filter(p => p.status?.phase === 'Running').length;
      podsSummary.error = podsSummary.total - podsSummary.running;
    } catch { /* kubectl not available */ }

    res.json({
      nodes: nodesSummary,
      pods: podsSummary,
      onlineUsers: onlineCount,
      unresolvedAlerts: alertRow?.cnt || 0,
      host: hostRow || null,
      disks: diskRows || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Nodes ──────────────────────────────────────────────────────────────────
router.get('/nodes', async (req, res) => {
  try {
    const out = await runCmd('kubectl', ['get', 'nodes', '-o', 'json']);
    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/nodes/detail', async (req, res) => {
  try {
    // Get node names first
    const nodesJson = await runCmd('kubectl', ['get', 'nodes', '-o', 'json']);
    const nodes = JSON.parse(nodesJson);
    const details = [];

    for (const node of (nodes.items || [])) {
      const name = node.metadata?.name;
      try {
        const desc = await runCmd('kubectl', ['describe', 'node', name]);
        // Parse Allocatable and Requests from describe output
        const detail = parseNodeDescribe(name, node, desc);
        details.push(detail);
      } catch (e2) {
        details.push({ name, error: e2.message });
      }
    }
    res.json(details);
  } catch (e) {
    res.status(500).json({ error: e.message });
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

router.get('/nodes/history', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const hours = parseInt(req.query.hours) || 24;
    const rows = await db.prepare(
      `SELECT * FROM node_metrics
       WHERE collected_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
       ORDER BY collected_at ASC`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Pods ───────────────────────────────────────────────────────────────────
router.get('/pods', async (req, res) => {
  try {
    const out = await runCmd('kubectl', ['get', 'pods', '--all-namespaces', '-o', 'json']);
    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── K8s Events ─────────────────────────────────────────────────────────────
router.get('/events', async (req, res) => {
  try {
    const out = await runCmd('kubectl', ['get', 'events', '--all-namespaces', '-o', 'json']);
    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Host Metrics (current, from /proc) ─────────────────────────────────────
router.get('/host/current', async (req, res) => {
  try {
    const metrics = await collectHostMetrics();
    res.json(metrics);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    const rows = await db.prepare(
      `SELECT * FROM host_metrics
       WHERE collected_at > SYSTIMESTAMP - INTERVAL '${hours}' HOUR
       ORDER BY collected_at ASC`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/host/processes', async (req, res) => {
  try {
    let processes = [];
    if (os.platform() === 'linux') {
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
    }
    res.json(processes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Docker Images ──────────────────────────────────────────────────────────
router.get('/images', async (req, res) => {
  try {
    const out = await runCmd('docker', ['images', '--format', '{{json .}}']);
    const images = out.trim().split('\n').filter(Boolean).map(l => tryParseJSON(l)).filter(Boolean);
    res.json(images);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/images/prune', async (req, res) => {
  try {
    const out = await runCmd('docker', ['image', 'prune', '-f'], 60000);
    res.json({ message: 'Prune completed', output: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Docker Containers ──────────────────────────────────────────────────────
router.get('/containers', async (req, res) => {
  try {
    const out = await runCmd('docker', ['ps', '-a', '--format', '{{json .}}']);
    const containers = out.trim().split('\n').filter(Boolean).map(l => tryParseJSON(l)).filter(Boolean);
    res.json(containers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/containers/:id/stats', async (req, res) => {
  try {
    const out = await runCmd('docker', ['stats', '--no-stream', '--format', '{{json .}}', req.params.id]);
    res.json(tryParseJSON(out.trim()) || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/containers/:id/restart', async (req, res) => {
  try {
    await runCmd('docker', ['restart', req.params.id], 30000);
    res.json({ message: `Container ${req.params.id} restarted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/containers/:id/stop', async (req, res) => {
  try {
    await runCmd('docker', ['stop', req.params.id], 30000);
    res.json({ message: `Container ${req.params.id} stopped` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/containers/:id/start', async (req, res) => {
  try {
    await runCmd('docker', ['start', req.params.id]);
    res.json({ message: `Container ${req.params.id} started` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Log Streaming (SSE) ────────────────────────────────────────────────────
router.get('/logs/pod/:ns/:pod', (req, res) => {
  const { ns, pod } = req.params;
  const tail = parseInt(req.query.tail) || 100;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const proc = spawn('kubectl', ['logs', '-f', '--tail', String(tail), '-n', ns, pod], { shell: true });
  proc.stdout.on('data', d => {
    const lines = d.toString('utf8').split('\n');
    for (const line of lines) {
      if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
  });
  proc.stderr.on('data', d => {
    res.write(`data: ${JSON.stringify({ error: d.toString('utf8') })}\n\n`);
  });
  proc.on('close', code => {
    res.write(`data: ${JSON.stringify({ done: true, exitCode: code })}\n\n`);
    res.end();
  });

  req.on('close', () => {
    proc.kill();
  });
});

router.get('/logs/container/:id', (req, res) => {
  const tail = parseInt(req.query.tail) || 100;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const proc = spawn('docker', ['logs', '-f', '--tail', String(tail), req.params.id], { shell: true });
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
  proc.on('close', code => {
    res.write(`data: ${JSON.stringify({ done: true, exitCode: code })}\n\n`);
    res.end();
  });

  req.on('close', () => {
    proc.kill();
  });
});

// ─── Disk / NAS ─────────────────────────────────────────────────────────────
router.get('/disk', async (req, res) => {
  try {
    let disks = [];
    if (os.platform() === 'linux') {
      // df -h (usage) + df -i (inodes)
      const dfOut = await runCmd('df', ['-h', '--output=source,target,size,used,avail,pcent']);
      const diOut = await runCmd('df', ['-i', '--output=source,target,ipcent']);

      const inodeMap = {};
      for (const line of diOut.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) inodeMap[parts[1]] = parts[2];
      }

      for (const line of dfOut.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const mount = parts[1];
        // Skip pseudo filesystems
        if (['tmpfs', 'devtmpfs', 'overlay'].includes(parts[0])) continue;
        if (mount.startsWith('/sys') || mount.startsWith('/proc') || mount.startsWith('/dev/shm')) continue;

        const totalStr = parts[2];
        const usedStr = parts[3];
        const usePctStr = parts[5].replace('%', '');

        disks.push({
          device: parts[0],
          mount,
          total: totalStr,
          used: usedStr,
          available: parts[4],
          use_pct: parseFloat(usePctStr) || 0,
          inode_pct: parseFloat((inodeMap[mount] || '0').replace('%', '')) || 0,
          is_mounted: true,
        });
      }
    }
    res.json(disks);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/disk/history', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const days = parseInt(req.query.days) || 7;
    const mount = req.query.mount || null;
    let sql = `SELECT * FROM disk_metrics WHERE collected_at > SYSTIMESTAMP - INTERVAL '${days}' DAY`;
    const binds = [];
    if (mount) {
      sql += ` AND mount = ?`;
      binds.push(mount);
    }
    sql += ` ORDER BY collected_at ASC`;
    const rows = await db.prepare(sql).all(...binds);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Online Users ───────────────────────────────────────────────────────────
router.get('/online-users', async (req, res) => {
  try {
    const redis = require('../services/redisClient');
    let users = [];
    try {
      const sessions = await redis.getAllSessions();
      if (sessions) {
        users = sessions.map(s => ({
          id: s.id,
          username: s.username,
          name: s.name,
          employee_id: s.employee_id,
          loginTime: s.loginTime || null,
        }));
      }
    } catch { /* getAllSessions may not exist */ }
    res.json({ count: users.length, users });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    let sql = `SELECT * FROM monitor_alerts`;
    if (resolved === 'false') sql += ` WHERE resolved_at IS NULL`;
    else if (resolved === 'true') sql += ` WHERE resolved_at IS NOT NULL`;
    sql += ` ORDER BY notified_at DESC FETCH FIRST 200 ROWS ONLY`;
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

// Export helpers for metricsCollector
module.exports = router;
module.exports.collectHostMetrics = collectHostMetrics;
module.exports.parseNodeDescribe = parseNodeDescribe;
