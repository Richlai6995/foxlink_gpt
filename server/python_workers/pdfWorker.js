'use strict';
/**
 * pdfWorker.js — Node 端 wrapper,spawn Python pdf_to_docx_worker.py。
 *
 * Worker 一律 stdout 吐一行 JSON,stderr 給 log。
 *
 * 環境變數:
 *   PDF_PYTHON   — venv python 絕對路徑(Dockerfile 內設成 /opt/pdf-venv/bin/python3)
 *   PDF_WORKER   — worker .py 絕對路徑(預設 = 本檔目錄下 pdf_to_docx_worker.py)
 *
 * 開發機(Windows / 沒 venv)fallback 順序:
 *   PDF_PYTHON env → python3 → python
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const WORKER_PATH = process.env.PDF_WORKER || path.join(__dirname, 'pdf_to_docx_worker.py');

function resolvePython() {
  if (process.env.PDF_PYTHON && fs.existsSync(process.env.PDF_PYTHON)) {
    return process.env.PDF_PYTHON;
  }
  // 開發機 fallback
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * 跑一次 worker。
 * @param {string[]} args  CLI args(不含 python / worker 路徑)
 * @param {object} opts    { timeoutMs }
 * @returns {Promise<object>} parsed JSON
 */
function runWorker(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const python = resolvePython();
    if (!fs.existsSync(WORKER_PATH)) {
      return reject(new Error(`pdf worker script not found: ${WORKER_PATH}`));
    }

    const child = spawn(python, [WORKER_PATH, ...args], {
      cwd: path.dirname(WORKER_PATH),
      // 強制 worker stdout/stderr 用 utf-8(Windows 預設 cp950 會炸 JSON 中文)
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString('utf8'); });
    child.stderr.on('data', d => {
      const text = d.toString('utf8');
      stderr += text;
      // 把 worker 的 stderr 即時轉到本程序 stderr,方便 K8s log 看
      for (const line of text.split('\n')) {
        if (line.trim()) process.stderr.write(`[pdfWorker] ${line}\n`);
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`spawn python failed: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        return reject(new Error(`pdf worker timeout after ${timeoutMs}ms (args=${args.join(' ')})`));
      }

      // 預期:即使 worker 內部出錯也會吐 JSON。stdout 拿最後一行非空。
      const lastLine = stdout
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .pop();

      if (!lastLine) {
        return reject(new Error(
          `pdf worker no JSON output (exit=${code} signal=${signal}). stderr: ${stderr.slice(0, 500)}`
        ));
      }

      let parsed;
      try {
        parsed = JSON.parse(lastLine);
      } catch (e) {
        return reject(new Error(
          `pdf worker invalid JSON: ${e.message}. Line: ${lastLine.slice(0, 300)}`
        ));
      }
      resolve(parsed);
    });
  });
}

/**
 * Inspect PDF metadata / 加密狀態 / 掃描偵測。
 * @param {string} pdfPath
 * @param {string} [password]
 * @returns {Promise<object>} { ok, pages, encrypted, scanned_ratio, is_scanned_pdf, ... }
 */
async function inspect(pdfPath, password) {
  const args = ['inspect', '--in', pdfPath];
  if (password) args.push('--password', password);
  return runWorker(args, { timeoutMs: 60_000 });
}

/**
 * pdf2docx 文字型 PDF 轉換。
 * @param {string} pdfPath
 * @param {string} docxPath  輸出路徑(目錄需先存在)
 * @param {string} [password]
 * @param {object} [opts] { timeoutMs }
 * @returns {Promise<object>} { ok, out_path, pages_converted, elapsed_ms }
 */
async function convert(pdfPath, docxPath, password, opts = {}) {
  const args = ['convert', '--in', pdfPath, '--out', docxPath];
  if (password) args.push('--password', password);
  // convert 預設 5 分鐘,給 100+ 頁 PDF 留空間;skill 端做 page-count 預檢決定要不要走背景 job
  return runWorker(args, { timeoutMs: opts.timeoutMs || 300_000 });
}

module.exports = { inspect, convert, runWorker };
