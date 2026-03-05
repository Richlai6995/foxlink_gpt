'use strict';
/**
 * skillRunner.js
 * Manages child-process lifecycle for type='code' skills.
 * Each skill gets its own Express server in a subprocess,
 * bound to 127.0.0.1 on a dynamically assigned port (4000–4999).
 */

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const RUNNERS_DIR = path.join(__dirname, '../skill_runners');
const TEMPLATE_DIR = path.join(__dirname, '../skill_runner_template');
const PORT_MIN = 40100;
const PORT_MAX = 40999;

// In-memory map: skillId → { process, port, logLines }
const runningProcesses = new Map();
// Set of ports currently in use
const usedPorts = new Set();

// SSE subscriber map: skillId → Set<res>
const logSubscribers = new Map();

// ── Port allocation ───────────────────────────────────────────────────────────
function allocatePort() {
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!usedPorts.has(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  throw new Error('No available ports in range 4000-4999');
}

function releasePort(port) {
  usedPorts.delete(port);
}

// ── Log helper ────────────────────────────────────────────────────────────────
const MAX_LOG_LINES = 500;
function appendLog(skillId, line) {
  const entry = runningProcesses.get(skillId);
  if (entry) {
    entry.logLines.push(`${new Date().toISOString()} ${line}`);
    if (entry.logLines.length > MAX_LOG_LINES) entry.logLines.shift();
  }
  // Push to SSE subscribers
  const subs = logSubscribers.get(String(skillId));
  if (subs) {
    const data = JSON.stringify({ line: `${new Date().toISOString()} ${line}` });
    for (const res of subs) {
      try { res.write(`data: ${data}\n\n`); } catch (_) {}
    }
  }
}

// ── Directory setup ───────────────────────────────────────────────────────────
function ensureRunnerDir(skillId) {
  const dir = path.join(RUNNERS_DIR, String(skillId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Copy template runner.js if not present
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
}

// ── Generate package.json ─────────────────────────────────────────────────────
function generatePackageJson(skillId, packages) {
  const dir = path.join(RUNNERS_DIR, String(skillId));
  const deps = {};
  for (const pkg of packages) {
    if (pkg && pkg.trim()) deps[pkg.trim()] = '*';
  }
  // Always include express for the wrapper
  deps['express'] = '^4.18.0';
  const pkgJson = {
    name: `skill-runner-${skillId}`,
    version: '1.0.0',
    private: true,
    dependencies: deps,
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');
}

// ── npm install (returns a Promise, streams log lines via logCb) ──────────────
function installPackages(skillId, packages, logCb) {
  return new Promise((resolve, reject) => {
    const dir = path.join(RUNNERS_DIR, String(skillId));
    if (!fs.existsSync(dir)) {
      return reject(new Error('Runner directory not found. Save code first.'));
    }
    generatePackageJson(skillId, packages);

    logCb?.(`[install] Running npm install in ${dir}`);
    const child = spawn('npm', ['install', '--prefer-offline'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    child.stdout.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        if (line.trim()) logCb?.(`[npm] ${line}`);
      }
    });
    child.stderr.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        if (line.trim()) logCb?.(`[npm:err] ${line}`);
      }
    });
    child.on('close', (code) => {
      if (code === 0) {
        logCb?.('[install] npm install completed successfully');
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

// ── Spawn runner ──────────────────────────────────────────────────────────────
function spawnRunner(skill, db) {
  return new Promise((resolve, reject) => {
    const skillId = skill.id;
    const dir = ensureRunnerDir(skillId);
    const userCodePath = path.join(dir, 'user_code.js');

    if (!fs.existsSync(userCodePath)) {
      return reject(new Error('user_code.js not found. Save code first.'));
    }

    // Kill existing process if any
    const existing = runningProcesses.get(skillId);
    if (existing) {
      try { existing.process.kill('SIGTERM'); } catch (_) {}
      releasePort(existing.port);
      runningProcesses.delete(skillId);
    }

    const port = allocatePort();
    const child = spawn('node', ['runner.js'], {
      cwd: dir,
      env: { ...process.env, SKILL_PORT: String(port), SKILL_ID: String(skillId) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    runningProcesses.set(skillId, { process: child, port, logLines: [] });

    const onReady = (msg) => {
      if (msg?.ready) {
        clearTimeout(timer);
        child.removeListener('message', onReady);
        // Update DB
        try {
          db.prepare(
            `UPDATE skills SET code_status='running', code_port=?, code_pid=?, code_error=NULL,
             endpoint_url=? WHERE id=?`
          ).run(port, child.pid, `http://127.0.0.1:${port}`, skillId);
        } catch (e) {
          console.error('[skillRunner] DB update failed:', e.message);
        }
        resolve({ port, pid: child.pid });
      } else if (msg?.error) {
        clearTimeout(timer);
        child.removeListener('message', onReady);
        cleanup(msg.error);
        reject(new Error(msg.error));
      }
    };

    const timer = setTimeout(() => {
      child.removeListener('message', onReady);
      cleanup('Startup timed out after 10s');
      reject(new Error('Runner startup timed out'));
    }, 10000);

    function cleanup(errMsg) {
      try { child.kill('SIGTERM'); } catch (_) {}
      releasePort(port);
      runningProcesses.delete(skillId);
      try {
        db.prepare(
          `UPDATE skills SET code_status='error', code_port=NULL, code_pid=NULL, code_error=?, endpoint_url=NULL WHERE id=?`
        ).run(errMsg, skillId);
      } catch (_) {}
    }

    child.on('message', onReady);

    child.stdout.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        if (line.trim()) appendLog(skillId, `[out] ${line}`);
      }
    });
    child.stderr.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        if (line.trim()) appendLog(skillId, `[err] ${line}`);
      }
    });

    child.on('exit', (code, signal) => {
      const entry = runningProcesses.get(skillId);
      if (entry) {
        releasePort(entry.port);
        runningProcesses.delete(skillId);
      }
      appendLog(skillId, `[exit] process exited code=${code} signal=${signal}`);
      try {
        db.prepare(
          `UPDATE skills SET code_status='stopped', code_port=NULL, code_pid=NULL WHERE id=?`
        ).run(skillId);
      } catch (_) {}
    });

    child.on('error', (err) => {
      appendLog(skillId, `[error] ${err.message}`);
    });
  });
}

// ── Kill runner ───────────────────────────────────────────────────────────────
function killRunner(skillId, db) {
  const entry = runningProcesses.get(skillId);
  if (!entry) return false;
  try { entry.process.kill('SIGTERM'); } catch (_) {}
  releasePort(entry.port);
  runningProcesses.delete(skillId);
  try {
    db.prepare(
      `UPDATE skills SET code_status='stopped', code_port=NULL, code_pid=NULL WHERE id=?`
    ).run(skillId);
  } catch (_) {}
  return true;
}

// ── Restart runner ────────────────────────────────────────────────────────────
async function restartRunner(skill, db) {
  killRunner(skill.id, db);
  return spawnRunner(skill, db);
}

// ── Auto-restore on server start ──────────────────────────────────────────────
async function autoRestoreRunners(db) {
  try {
    const skills = db.prepare(
      `SELECT * FROM skills WHERE type='code' AND code_status='running'`
    ).all();
    console.log(`[skillRunner] Auto-restoring ${skills.length} code skill(s)...`);
    for (const skill of skills) {
      try {
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

// ── Log stream subscription ───────────────────────────────────────────────────
function subscribeLog(skillId, res) {
  const key = String(skillId);
  if (!logSubscribers.has(key)) logSubscribers.set(key, new Set());
  logSubscribers.get(key).add(res);
}

function unsubscribeLog(skillId, res) {
  const key = String(skillId);
  logSubscribers.get(key)?.delete(res);
}

function getLogs(skillId) {
  return runningProcesses.get(skillId)?.logLines || [];
}

function getStatus(skillId) {
  const entry = runningProcesses.get(skillId);
  if (!entry) return { running: false };
  return { running: true, port: entry.port, pid: entry.process.pid };
}

module.exports = {
  saveCode,
  generatePackageJson,
  installPackages,
  spawnRunner,
  killRunner,
  restartRunner,
  autoRestoreRunners,
  subscribeLog,
  unsubscribeLog,
  getLogs,
  getStatus,
  ensureRunnerDir,
};
