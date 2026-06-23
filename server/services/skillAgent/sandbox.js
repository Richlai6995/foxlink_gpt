// -*- coding: utf-8 -*-
/**
 * sandbox.js — Skill Agent PoC 的工作區與外部程序執行。
 *
 * Phase 0 範圍:單機、跑「自己給的」skill,威脅模型尚非陌生人程式碼,
 * 故只做最小隔離:per-run mkdtemp 工作區 + 跑完即焚 + 單次 wall-clock SIGKILL + cwd 鎖定。
 * 安全加固(forked child + oom_score_adj=1000 + egress 鎖 + non-root + semaphore)留 Phase 1,
 * 屆時抄 excelQueryJobService 那套(見 docs 規劃)。
 *
 * 慣例對齊既有 codebase:
 *   - python 解析:PDF_PYTHON env 優先,否則平台預設(pdfWorker.resolvePython)
 *   - PYTHONIOENCODING=utf-8 強制(Windows stdout 預設 cp950 會�spawn CJK 亂碼)
 *   - mkdtemp + finally rmSync(kbDocParser.parsePpt)
 *   - wall-clock setTimeout → SIGKILL(pdfWorker.runWorker)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_OUTPUT_CHARS = 4000; // tool 回灌給 LLM 的輸出上限(省 token)
const DEFAULT_TIMEOUT_MS = 60_000;

/** 解析 python 執行檔(對齊 pdfWorker.resolvePython)。 */
function resolvePython() {
  if (process.env.PDF_PYTHON && fs.existsSync(process.env.PDF_PYTHON)) return process.env.PDF_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

/** 解析 soffice 執行檔(env 覆寫 > PATH > Windows 預設安裝路徑)。 */
function resolveSoffice() {
  if (process.env.SOFFICE_BIN && fs.existsSync(process.env.SOFFICE_BIN)) return process.env.SOFFICE_BIN;
  if (process.platform === 'win32') {
    const def = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
    if (fs.existsSync(def)) return def;
  }
  return 'soffice'; // 賭它在 PATH(Linux prod 由 Dockerfile 裝 libreoffice-impress)
}

/**
 * 建立 per-run 工作區,把 skill 包原樣複製進去(保目錄結構 → 保 blue_style 相對 import)。
 * @returns {string} 工作區絕對路徑
 */
function prepWorkspace(skillDir) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'skillagent-'));
  fs.cpSync(skillDir, ws, { recursive: true });
  return ws;
}

function cleanupWorkspace(ws) {
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch (_) {}
}

function _truncate(s) {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return s.slice(0, MAX_OUTPUT_CHARS) + `\n…[truncated ${s.length - MAX_OUTPUT_CHARS} chars]`;
}

/**
 * 在工作區跑一條 shell 指令,合併 stdout+stderr 回傳(截斷)。
 * cwd 鎖在 ws、env 不漏多餘變數、wall-clock 逾時 SIGKILL。
 * @returns {Promise<string>} 合併輸出(含 exit code / timeout 標記)
 */
function runInWorkspace(cmd, ws, { timeout = DEFAULT_TIMEOUT_MS, fullEnv = false } = {}) {
  // fullEnv=true:可信步驟(如我們自己的 soffice 渲染)用完整 env;
  // 預設 false:跑「不可信 skill 程式碼」用鎖死的最小 env。
  // 註:soffice 需要 APPDATA/LOCALAPPDATA 找 user profile,鎖死 env 會讓它靜默失敗。
  const env = fullEnv
    ? { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    : {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot, // Windows python 需要
        TEMP: ws, TMP: ws,
        HOME: ws, USERPROFILE: ws,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        // blue_style 字型:預設 Noto(dev 已裝 + Linux prod 內建)
        BLUE_STYLE_EA_FONT: process.env.BLUE_STYLE_EA_FONT || 'Noto Sans TC',
      };
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: ws,
      shell: true, // Windows=cmd.exe / Linux=/bin/sh;PoC 直接吃整條字串
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    const cap = (d) => { out += d.toString('utf8'); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);

    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeout);

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(`[spawn error: ${e.message}]`);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killedByTimeout) return resolve(_truncate(out) + `\n[KILLED: wall-clock timeout ${timeout}ms]`);
      const tag = code === 0 ? '' : `\n[exit code ${code}${signal ? ` signal ${signal}` : ''}]`;
      resolve(_truncate(out || '(no output)') + tag);
    });
  });
}

/** 跑工作區裡的 python 檔(便捷包裝,確保用解析後的 python)。 */
function runPython(file, ws, opts) {
  return runInWorkspace(`"${resolvePython()}" "${file}"`, ws, opts);
}

module.exports = {
  resolvePython,
  resolveSoffice,
  prepWorkspace,
  cleanupWorkspace,
  runInWorkspace,
  runPython,
  MAX_OUTPUT_CHARS,
};
