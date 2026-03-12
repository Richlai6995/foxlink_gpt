#!/usr/bin/env node
/**
 * Before starting the dev server:
 *  1. Kill any nodemon processes managing this server directory
 *  2. Kill any node process listening on PORT
 * Used by npm predev script.
 */
const { execSync } = require('child_process');
const path = require('path');
const PORT = process.env.PORT || 3001;
const SERVER_DIR = path.resolve(__dirname, '..').replace(/\\/g, '\\\\');

function ps(cmd) {
  try {
    return execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch { return ''; }
}

function killPid(pid) {
  if (!pid || pid === process.pid) return;
  try {
    execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`, { timeout: 3000 });
    console.log(`[predev] Killed PID ${pid}`);
  } catch {}
}

if (process.platform !== 'win32') {
  try { execSync(`fuser -k ${PORT}/tcp`); } catch {}
  process.exit(0);
}

// 1. Kill old nodemon processes watching this server directory
const nodemonPids = ps(
  `Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*nodemon*' -and $_.CommandLine -like '*foxlink_gpt*server*' } | Select-Object -ExpandProperty ProcessId`
);
nodemonPids.split('\n').map(s => Number(s.trim())).filter(n => n > 0 && n !== process.pid).forEach(killPid);

// 2. Kill any node process on PORT 3001
const portPids = ps(
  `Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique`
);
portPids.split('\n').map(s => Number(s.trim())).filter(n => n > 0 && n !== process.pid).forEach(killPid);

// Give OS time to release socket
setTimeout(() => process.exit(0), 800);
