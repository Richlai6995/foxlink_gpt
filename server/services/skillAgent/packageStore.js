// -*- coding: utf-8 -*-
/**
 * packageStore.js — type='agent' skill 包的落檔 / 解析 / python 依賴安裝。
 *
 * 與管 code-skill 子程序的 skillRunner.js 分開:這裡只負責「把匯入的 skill 包寫到 NFS、
 * 解析 SKILL.md、裝 per-skill venv 依賴」。runtime(loop.js/poc.js)執行時用 getPackageDir 取目錄。
 *
 * 對齊既有慣例:NFS 持久目錄(同 skill_runners)、_safeJoin path-escape guard、
 * PDF_PYTHON python 解析、spawn 串 logCb(同 installPackages)。
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// skill 包根目錄(prod 由 NFS PVC 持久化,同 skill_runners)
const AGENT_PACKAGES_DIR = process.env.AGENT_PACKAGES_DIR
  ? path.resolve(process.env.AGENT_PACKAGES_DIR)
  : path.join(__dirname, '../../skill_packages');

function getPackageDir(skillId) {
  return path.join(AGENT_PACKAGES_DIR, String(skillId));
}

/** 解析 SKILL.md 的 YAML frontmatter(name / description / license …)+ body。 */
function parseSkillMd(content) {
  const m = String(content || '').match(/^﻿?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: String(content || '').trim() };
  let fm = {};
  try { fm = yaml.load(m[1]) || {}; } catch (_) { fm = {}; }
  return {
    frontmatter: fm,
    body: (m[2] || '').trim(),
    name: fm.name || null,
    description: typeof fm.description === 'string' ? fm.description.trim() : (fm.description || null),
    license: fm.license || null,
  };
}

function _safeJoin(base, rel) {
  const p = path.resolve(base, rel);
  if (p !== base && !p.startsWith(base + path.sep)) {
    throw new Error(`path escapes package: ${rel}`);
  }
  return p;
}

/**
 * 把解壓後的檔案寫進 skill 包目錄(保目錄結構 → 保相對 import)。
 * @param {number|string} skillId
 * @param {Array<{path:string, content:Buffer|string}>} files
 * @returns {string} 包目錄絕對路徑
 */
function writePackage(skillId, files) {
  const dir = getPackageDir(skillId);
  fs.rmSync(dir, { recursive: true, force: true }); // 重新匯入清舊
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    if (!f || !f.path || f.path.endsWith('/')) continue;
    const dst = _safeJoin(dir, f.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, f.content);
  }
  return dir;
}

function resolvePython() {
  if (process.env.PDF_PYTHON && fs.existsSync(process.env.PDF_PYTHON)) return process.env.PDF_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function venvPython(dir) {
  return process.platform === 'win32'
    ? path.join(dir, '.venv', 'Scripts', 'python.exe')
    : path.join(dir, '.venv', 'bin', 'python');
}

/**
 * 為 skill 包建 venv + pip install requirements.txt(per-skill 隔離,不污染主 python)。
 * 對齊 installPackages 的 spawn + logCb 串流;無 requirements.txt 則略過。
 * @returns {Promise<{ok?:boolean, skipped?:boolean}>}
 */
function installPythonPackages(skillId, logCb = () => {}) {
  return new Promise((resolve, reject) => {
    const dir = getPackageDir(skillId);
    if (!fs.existsSync(dir)) return reject(new Error('skill 包目錄不存在,請先匯入'));
    const req = path.join(dir, 'requirements.txt');
    if (!fs.existsSync(req)) { logCb('[deps] 無 requirements.txt,略過'); return resolve({ skipped: true }); }

    const py = resolvePython();
    logCb(`[venv] ${py} -m venv .venv`);
    const venv = spawn(py, ['-m', 'venv', '.venv'], { cwd: dir, shell: process.platform === 'win32' });
    let vErr = '';
    venv.stderr.on('data', (d) => { vErr += d.toString(); });
    venv.on('error', reject);
    venv.on('close', (code) => {
      if (code !== 0) return reject(new Error(`venv 建立失敗 (code ${code}): ${vErr.slice(0, 300)}`));
      const vpy = venvPython(dir);
      logCb('[pip] install -r requirements.txt …');
      const pip = spawn(vpy, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: dir });
      pip.stdout.on('data', (d) => { for (const l of d.toString().split('\n')) if (l.trim()) logCb(`[pip] ${l}`); });
      pip.stderr.on('data', (d) => { for (const l of d.toString().split('\n')) if (l.trim()) logCb(`[pip:err] ${l}`); });
      pip.on('error', reject);
      pip.on('close', (c) => (c === 0 ? resolve({ ok: true }) : reject(new Error(`pip install 失敗 (code ${c})`))));
    });
  });
}

module.exports = {
  AGENT_PACKAGES_DIR,
  getPackageDir,
  parseSkillMd,
  writePackage,
  installPythonPackages,
  venvPython,
  resolvePython,
};
