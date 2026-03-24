'use strict';
/**
 * skillRunner.js
 * Manages child-process lifecycle for type='code' skills.
 * Each skill gets its own Express server in a subprocess,
 * bound to 127.0.0.1 on a dynamically assigned port (40100–40999).
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const net = require('net');

const RUNNERS_DIR = path.join(__dirname, '../skill_runners');
const TEMPLATE_DIR = path.join(__dirname, '../skill_runner_template');
const SOURCES_DIR = path.join(__dirname, '../skill_sources');
const PORT_MIN = 40100;
const PORT_MAX = 40999;

// In-memory map: skillId → { process, port, logLines }
const runningProcesses = new Map();
// Set of ports currently in use
const usedPorts = new Set();
// Track code hash per skill to detect DB changes from other pods
const codeHashes = new Map(); // skillId → md5 hex

// SSE subscriber maps
const logSubscribers = new Map();    // skillId → Set<res>
const statusSubscribers = new Set(); // admin panel live status

// ── Port allocation ───────────────────────────────────────────────────────────
function allocatePort() {
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!usedPorts.has(p)) { usedPorts.add(p); return p; }
  }
  throw new Error('No available ports in range 40100-40999');
}

function releasePort(port) { usedPorts.delete(port); }

function isPortFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    // Safety timeout: if neither error nor listening fires within 500ms, assume occupied
    const timer = setTimeout(() => { try { s.close(); } catch (_) {} resolve(false); }, 500);
    s.once('error', () => { clearTimeout(timer); resolve(false); });
    s.once('listening', () => { clearTimeout(timer); s.close(() => resolve(true)); });
    s.listen(port, '127.0.0.1');
  });
}

async function waitForPortFree(port, maxMs = 5000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// ── Status broadcast ──────────────────────────────────────────────────────────
function pushStatusUpdate(skillId, status, extra = {}) {
  const data = JSON.stringify({ skillId: Number(skillId), status, ...extra });
  for (const res of statusSubscribers) {
    try { res.write(`data: ${data}\n\n`); }
    catch (_) { statusSubscribers.delete(res); }
  }
}

// ── Log helper ────────────────────────────────────────────────────────────────
const MAX_LOG_LINES = 500;
function appendLog(skillId, line) {
  const entry = runningProcesses.get(skillId);
  const ts = new Date().toISOString();
  const full = `${ts} ${line}`;
  if (entry) {
    entry.logLines.push(full);
    if (entry.logLines.length > MAX_LOG_LINES) entry.logLines.shift();
  }
  const subs = logSubscribers.get(String(skillId));
  if (subs) {
    const data = JSON.stringify({ line: full });
    for (const res of subs) {
      try { res.write(`data: ${data}\n\n`); } catch (_) {}
    }
  }
}

// ── Directory setup ───────────────────────────────────────────────────────────
function ensureRunnerDir(skillId) {
  const dir = path.join(RUNNERS_DIR, String(skillId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const runnerDst = path.join(dir, 'runner.js');
  if (!fs.existsSync(runnerDst)) {
    fs.copyFileSync(path.join(TEMPLATE_DIR, 'runner.js'), runnerDst);
  }
  return dir;
}

// ── Save user code ────────────────────────────────────────────────────────────
function saveCode(skillId, code) {
  const dir = ensureRunnerDir(skillId);
  fs.writeFileSync(path.join(dir, 'user_code.js'), code, 'utf8');
  codeHashes.set(skillId, crypto.createHash('md5').update(code).digest('hex'));
}

// ── Generate package.json ─────────────────────────────────────────────────────
function generatePackageJson(skillId, packages) {
  const dir = path.join(RUNNERS_DIR, String(skillId));
  const deps = {};
  for (const pkg of packages) { if (pkg && pkg.trim()) deps[pkg.trim()] = '*'; }
  deps['express'] = '^4.18.0';
  const pkgJson = { name: `skill-runner-${skillId}`, version: '1.0.0', private: true, dependencies: deps };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');
}

// ── npm install ───────────────────────────────────────────────────────────────
function installPackages(skillId, packages, logCb) {
  return new Promise((resolve, reject) => {
    const dir = path.join(RUNNERS_DIR, String(skillId));
    if (!fs.existsSync(dir)) return reject(new Error('Runner directory not found. Save code first.'));
    generatePackageJson(skillId, packages);
    logCb?.(`[install] Running npm install in ${dir}`);
    const child = spawn('npm', ['install', '--prefer-offline'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    child.stdout.on('data', d => { for (const l of d.toString().split('\n')) { if (l.trim()) logCb?.(`[npm] ${l}`); } });
    child.stderr.on('data', d => { for (const l of d.toString().split('\n')) { if (l.trim()) logCb?.(`[npm:err] ${l}`); } });
    child.on('close', code => { code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`)); });
    child.on('error', reject);
  });
}

// ── Force kill ────────────────────────────────────────────────────────────────
function forceKillProcess(proc, pid) {
  try { proc.kill('SIGKILL'); } catch (_) {}
  if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
}

// ── Kill runner (async, with stopping state) ──────────────────────────────────
async function killRunner(skillId, db) {
  pushStatusUpdate(skillId, 'stopping');
  try { db.prepare(`UPDATE skills SET code_status='stopping' WHERE id=?`).run(skillId); } catch (_) {}

  const entry = runningProcesses.get(skillId);

  if (!entry) {
    // No in-memory entry — try kill by PID from DB
    try {
      const row = db.prepare(`SELECT code_pid, code_port FROM skills WHERE id=?`).get(skillId);
      if (row?.code_pid) { try { process.kill(row.code_pid, 'SIGKILL'); } catch (_) {} }
      if (row?.code_port) await waitForPortFree(row.code_port, 3000);
    } catch (_) {}
    try { db.prepare(`UPDATE skills SET code_status='stopped', code_port=NULL, code_pid=NULL, endpoint_url=NULL WHERE id=?`).run(skillId); } catch (_) {}
    pushStatusUpdate(skillId, 'stopped');
    return false;
  }

  const { port } = entry;

  try {
    // Skip SIGTERM — go straight to SIGKILL to avoid server.close() keep-alive delay
    forceKillProcess(entry.process, entry.process.pid);
    // Wait for exit confirmation (max 1s)
    await Promise.race([
      new Promise(r => entry.process.once('exit', r)),
      new Promise(r => setTimeout(r, 1000)),
    ]);
    releasePort(port);
    runningProcesses.delete(skillId);
    // Brief wait for OS to release port (max 1s)
    await waitForPortFree(port, 1000);
  } catch (e) {
    console.error(`[skillRunner] killRunner error for #${skillId}:`, e.message);
    releasePort(port);
    runningProcesses.delete(skillId);
  } finally {
    // Always update DB and push stopped — even if something threw above
    try { db.prepare(`UPDATE skills SET code_status='stopped', code_port=NULL, code_pid=NULL, endpoint_url=NULL WHERE id=?`).run(skillId); } catch (_) {}
    pushStatusUpdate(skillId, 'stopped');
  }
  return true;
}

// ── Spawn runner ──────────────────────────────────────────────────────────────
async function spawnRunner(skill, db) {
  const skillId = skill.id;
  const dir = ensureRunnerDir(skillId);
  const userCodePath = path.join(dir, 'user_code.js');
  if (!fs.existsSync(userCodePath)) throw new Error('user_code.js not found. Save code first.');

  // Kill existing process if any, then wait for port release
  const existing = runningProcesses.get(skillId);
  if (existing) {
    const existingPort = existing.port;
    forceKillProcess(existing.process, existing.process.pid);
    releasePort(existingPort);
    runningProcesses.delete(skillId);
    await waitForPortFree(existingPort, 1000);
  }

  // Mark as starting
  pushStatusUpdate(skillId, 'starting');
  try { db.prepare(`UPDATE skills SET code_status='starting', code_error=NULL WHERE id=?`).run(skillId); } catch (_) {}

  return new Promise((resolve, reject) => {
    const port = allocatePort();
    const child = spawn('node', ['runner.js'], {
      cwd: dir,
      env: { ...process.env, SKILL_PORT: String(port), SKILL_ID: String(skillId) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    runningProcesses.set(skillId, { process: child, port, logLines: [] });

    const cleanup = (errMsg) => {
      try { child.kill('SIGKILL'); } catch (_) {}
      releasePort(port);
      runningProcesses.delete(skillId);
      try { db.prepare(`UPDATE skills SET code_status='error', code_port=NULL, code_pid=NULL, code_error=?, endpoint_url=NULL WHERE id=?`).run(errMsg, skillId); } catch (_) {}
      pushStatusUpdate(skillId, 'error', { error: errMsg });
    };

    const timer = setTimeout(() => {
      child.removeListener('message', onReady);
      cleanup('Startup timed out after 10s');
      reject(new Error('Runner startup timed out'));
    }, 10000);

    const onReady = (msg) => {
      if (msg?.ready) {
        clearTimeout(timer);
        child.removeListener('message', onReady);
        try {
          db.prepare(`UPDATE skills SET code_status='running', code_port=?, code_pid=?, code_error=NULL, endpoint_url=? WHERE id=?`)
            .run(port, child.pid, `http://127.0.0.1:${port}`, skillId);
        } catch (e) { console.error('[skillRunner] DB update failed:', e.message); }
        pushStatusUpdate(skillId, 'running', { port, pid: child.pid });
        resolve({ port, pid: child.pid });
      } else if (msg?.error) {
        clearTimeout(timer);
        child.removeListener('message', onReady);
        cleanup(msg.error);
        reject(new Error(msg.error));
      }
    };

    child.on('message', onReady);
    child.stdout.on('data', d => { for (const l of d.toString().split('\n')) { if (l.trim()) appendLog(skillId, `[out] ${l}`); } });
    child.stderr.on('data', d => { for (const l of d.toString().split('\n')) { if (l.trim()) appendLog(skillId, `[err] ${l}`); } });

    child.on('exit', (code, signal) => {
      const e = runningProcesses.get(skillId);
      if (e) { releasePort(e.port); runningProcesses.delete(skillId); }
      appendLog(skillId, `[exit] process exited code=${code} signal=${signal}`);
      try { db.prepare(`UPDATE skills SET code_status='stopped', code_port=NULL, code_pid=NULL WHERE id=?`).run(skillId); } catch (_) {}
      pushStatusUpdate(skillId, 'stopped');
    });

    child.on('error', err => { appendLog(skillId, `[error] ${err.message}`); });
  });
}

// ── Restart runner ────────────────────────────────────────────────────────────
async function restartRunner(skill, db) {
  await killRunner(skill.id, db);
  return spawnRunner(skill, db);
}

// ── Sync skill_sources/ (git) → DB on startup ────────────────────────────────
// Ensures deploy always pushes latest git code into DB code_snippet.
// After this, autoRestoreRunners syncs DB → disk → child process.
async function syncSkillSources(db) {
  const manifestPath = path.join(SOURCES_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {
    console.error('[skillSources] Failed to parse manifest.json:', e.message);
    return;
  }

  for (const entry of manifest) {
    const srcPath = path.join(SOURCES_DIR, entry.file);
    if (!fs.existsSync(srcPath)) {
      console.warn(`[skillSources] File not found: ${entry.file}`);
      continue;
    }

    const srcCode = fs.readFileSync(srcPath, 'utf8');
    const srcHash = crypto.createHash('md5').update(srcCode).digest('hex');

    // Find matching skill in DB by name regex
    const matchRegex = entry.match_name || entry.file.replace(/\.js$/, '');
    let skills;
    try {
      skills = await db.prepare(
        `SELECT id, name, code_snippet FROM skills WHERE type='code'`
      ).all();
    } catch (e) {
      console.error('[skillSources] DB query failed:', e.message);
      continue;
    }

    const re = new RegExp(matchRegex, 'i');
    const matched = skills.filter(s => re.test(s.name));
    if (!matched.length) {
      console.warn(`[skillSources] No skill matched "${matchRegex}" for ${entry.file}`);
      continue;
    }

    for (const skill of matched) {
      const dbHash = skill.code_snippet
        ? crypto.createHash('md5').update(skill.code_snippet).digest('hex')
        : null;
      if (dbHash === srcHash) {
        console.log(`[skillSources] ${entry.file} → skill #${skill.id} (${skill.name}): up-to-date`);
        continue;
      }
      try {
        await db.prepare(`UPDATE skills SET code_snippet=:1 WHERE id=:2`).run(srcCode, skill.id);
        console.log(`[skillSources] ${entry.file} → skill #${skill.id} (${skill.name}): UPDATED`);
      } catch (e) {
        console.error(`[skillSources] Failed to update skill #${skill.id}: ${e.message}`);
      }
    }
  }
}

// ── Auto-restore on server start ──────────────────────────────────────────────
async function autoRestoreRunners(db) {
  // First: sync git skill_sources/ → DB (ensures deploy pushes latest code)
  try { await syncSkillSources(db); } catch (e) {
    console.error('[skillRunner] syncSkillSources failed:', e.message);
  }

  try {
    const skills = await db.prepare(`SELECT * FROM skills WHERE type='code' AND code_status IN ('running','starting','stopping')`).all();
    console.log(`[skillRunner] Auto-restoring ${skills.length} code skill(s)...`);
    for (const skill of skills) {
      try {
        // Sync code between DB and disk to ensure consistency
        if (skill.code_snippet) {
          // DB has code → write to disk (ensures all pods use latest)
          saveCode(skill.id, skill.code_snippet);
          console.log(`[skillRunner] Synced DB→disk for skill #${skill.id}`);
        } else {
          // DB code_snippet empty but disk file may exist → sync disk→DB
          const diskPath = path.join(RUNNERS_DIR, String(skill.id), 'user_code.js');
          if (fs.existsSync(diskPath)) {
            const diskCode = fs.readFileSync(diskPath, 'utf8');
            try {
              await db.prepare(`UPDATE skills SET code_snippet=:1 WHERE id=:2`).run(diskCode, skill.id);
              console.log(`[skillRunner] Synced disk→DB for skill #${skill.id}`);
            } catch (e2) { console.warn(`[skillRunner] disk→DB sync failed for #${skill.id}: ${e2.message}`); }
          }
        }
        await spawnRunner(skill, db);
        console.log(`[skillRunner] Restored skill #${skill.id} (${skill.name})`);
      } catch (e) {
        console.error(`[skillRunner] Failed to restore skill #${skill.id}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error('[skillRunner] autoRestoreRunners error:', e.message);
  }
}

// ── Health Monitor ────────────────────────────────────────────────────────────
function startHealthMonitor(db) {
  const INTERVAL_MS = 30000;
  setInterval(async () => {
    // 1. Health check running processes
    for (const [skillId, entry] of runningProcesses.entries()) {
      try {
        const resp = await Promise.race([
          fetch(`http://127.0.0.1:${entry.port}/health`),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
        ]);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      } catch (e) {
        console.warn(`[skillRunner] Health check failed for skill #${skillId}: ${e.message}`);
        appendLog(skillId, `[health] check failed: ${e.message} — marking as error`);
        releasePort(entry.port);
        runningProcesses.delete(skillId);
        pushStatusUpdate(skillId, 'error', { error: 'Process died unexpectedly' });
        try {
          db.prepare(`UPDATE skills SET code_status='error', code_port=NULL, code_pid=NULL, code_error='Process died unexpectedly' WHERE id=?`).run(skillId);
        } catch (_) {}
      }
    }

    // 2. Hot-reload: detect DB code_snippet changes from other pods
    //    If admin UI saved new code on pod A, pod B/C/D pick it up here
    try {
      const skills = await db.prepare(
        `SELECT id, name, code_snippet FROM skills WHERE type='code' AND code_status='running'`
      ).all();
      for (const skill of skills) {
        if (!skill.code_snippet || !runningProcesses.has(skill.id)) continue;
        const dbHash = crypto.createHash('md5').update(skill.code_snippet).digest('hex');
        const localHash = codeHashes.get(skill.id);
        if (localHash && dbHash !== localHash) {
          console.log(`[skillRunner] Code change detected for skill #${skill.id} (${skill.name}), hot-reloading...`);
          appendLog(skill.id, `[hot-reload] DB code changed, restarting...`);
          saveCode(skill.id, skill.code_snippet);
          try { await restartRunner(skill, db); } catch (e) {
            console.error(`[skillRunner] Hot-reload failed for #${skill.id}: ${e.message}`);
          }
        }
      }
    } catch (_) { /* DB query fail is non-fatal for health monitor */ }
  }, INTERVAL_MS);
}

// ── Log & Status subscription ─────────────────────────────────────────────────
function subscribeLog(skillId, res) {
  const key = String(skillId);
  if (!logSubscribers.has(key)) logSubscribers.set(key, new Set());
  logSubscribers.get(key).add(res);
}
function unsubscribeLog(skillId, res) { logSubscribers.get(String(skillId))?.delete(res); }
function getLogs(skillId) { return runningProcesses.get(skillId)?.logLines || []; }
function getStatus(skillId) {
  const e = runningProcesses.get(skillId);
  if (!e) return { running: false };
  return { running: true, port: e.port, pid: e.process.pid };
}
function subscribeStatus(res) { statusSubscribers.add(res); }
function unsubscribeStatus(res) { statusSubscribers.delete(res); }

module.exports = {
  saveCode, generatePackageJson, installPackages,
  spawnRunner, killRunner, restartRunner,
  autoRestoreRunners, startHealthMonitor,
  subscribeLog, unsubscribeLog, getLogs, getStatus,
  subscribeStatus, unsubscribeStatus, pushStatusUpdate,
  ensureRunnerDir,
};
