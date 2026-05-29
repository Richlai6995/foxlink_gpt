/**
 * pdf_to_docx.js — PDF 轉 Word 技能(同步路線,適用 ≤ 50 頁)
 *
 * 設計:
 *   1. LLM 對話自然觸發(無 sidebar 按鈕)
 *   2. 從 chat.js 注入的 attached_files 拿 PDF 路徑
 *   3. spawn Python worker(pdf2docx + PyMuPDF)在 main app container 內跑
 *   4. 加密 PDF:LLM 帶 password 即可;若使用者怕密碼進 chat history,
 *      Phase 1c 會提供旁路 endpoint + 前端 modal(此處先支援 LLM 帶密碼方式)
 *   5. 掃描型 PDF(Phase 3 才支援 OCR):暫不轉,禮貌回報
 *   6. > 50 頁(Phase 1d 才接背景 job):暫拒,建議分割
 *
 * Skill 是 sandbox child,無法 require 主程序 services/,所以 spawn Python 邏輯內聯。
 *
 * Input body (chat.js 注入):
 *   {
 *     file_name: string,                 // PDF 檔名(fuzzy match)
 *     password?: string,                 // 加密 PDF 密碼
 *     ocr_quality?: 'auto'|'flash'|'pro'|'disable',  // Phase 3 才實作
 *     attached_files: [{ name, path, type, ... }],   // 由 chat.js 自動注入
 *     user_id, session_id,
 *   }
 *
 * Output:
 *   成功:{ content: markdown(含下載 link), files: [{type:'docx',filename,publicUrl}], data }
 *   缺密碼/錯誤:{ content: '錯誤說明' }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');
const GENERATED_DIR = path.join(UPLOAD_ROOT, 'generated');

const PHASE1_PAGE_LIMIT = 50;          // Phase 1d 上線前的同步上限
const CONVERT_TIMEOUT_MS = 110_000;    // chat.js tool dispatch 是 120s,留 10s buffer
const INSPECT_TIMEOUT_MS = 30_000;

// Python venv 路徑:Dockerfile 設 /opt/pdf-venv/bin/python3;dev 機 fallback
function resolvePython() {
  if (process.env.PDF_PYTHON && fs.existsSync(process.env.PDF_PYTHON)) {
    return process.env.PDF_PYTHON;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

// Worker py 路徑:absolute,由 env 覆寫或從 skill_runners/<id>/ 反推 server root
function resolveWorker() {
  if (process.env.PDF_WORKER_PY && fs.existsSync(process.env.PDF_WORKER_PY)) {
    return process.env.PDF_WORKER_PY;
  }
  // skill 跑在 server/skill_runners/<id>/ → __dirname/../../python_workers/pdf_to_docx_worker.py
  const guess = path.resolve(__dirname, '..', '..', 'python_workers', 'pdf_to_docx_worker.py');
  return guess;
}

function runWorker(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const python = resolvePython();
    const workerPath = resolveWorker();
    if (!fs.existsSync(workerPath)) {
      return reject(new Error(`pdf worker not found: ${workerPath}`));
    }

    const child = spawn(python, [workerPath, ...args], {
      cwd: path.dirname(workerPath),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString('utf8'); });
    child.stderr.on('data', d => {
      stderr += d.toString('utf8');
      // 即時轉發到本程序 stderr,K8s log 看得到
      for (const line of d.toString('utf8').split('\n')) {
        if (line.trim()) process.stderr.write(`[pdf_to_docx] ${line}\n`);
      }
    });

    child.on('error', err => { clearTimeout(timer); reject(new Error(`spawn python failed: ${err.message}`)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killedByTimeout) return reject(new Error(`pdf worker timeout after ${timeoutMs}ms`));
      const lastLine = stdout.split('\n').map(s => s.trim()).filter(Boolean).pop();
      if (!lastLine) return reject(new Error(`worker no JSON output (exit=${code} signal=${signal}). stderr: ${stderr.slice(0, 400)}`));
      try { resolve(JSON.parse(lastLine)); }
      catch (e) { reject(new Error(`worker invalid JSON: ${e.message}. line: ${lastLine.slice(0, 300)}`)); }
    });
  });
}

function findPdfFile(attachedFiles, fileName) {
  const pdfs = (attachedFiles || []).filter(f => {
    if (f.type === 'pdf') return true;
    // 兼容沒帶 type 的舊歷史紀錄
    return /\.pdf$/i.test(f.name || '');
  });

  if (pdfs.length === 0) return null;
  if (!fileName) {
    // 沒指定,且只有一份 PDF 直接用
    return pdfs.length === 1 ? pdfs[0] : null;
  }
  return pdfs.find(f => f.name === fileName)
      || pdfs.find(f => (f.name || '').toLowerCase() === fileName.toLowerCase())
      || pdfs.find(f => (f.name || '').includes(fileName))
      || pdfs.find(f => fileName.includes(f.name || ''));
}

function safeOutputPath(originalName) {
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const base = path.basename(originalName || 'output', path.extname(originalName || ''))
    .replace(/[^a-zA-Z0-9._\-一-鿿]/g, '_')
    .slice(0, 80);
  return path.join(GENERATED_DIR, `${Date.now()}_${base || 'output'}.docx`);
}

module.exports = async function handler(body) {
  const t0 = Date.now();
  const { file_name, password, attached_files } = body || {};

  // ── 找檔 ───────────────────────────────────────────────────────────────────
  if (!Array.isArray(attached_files) || attached_files.length === 0) {
    return {
      content:
        '❌ 此對話沒有偵測到 PDF 檔案附件。\n' +
        '請使用者先上傳 .pdf 檔案再呼叫此工具。',
    };
  }

  const target = findPdfFile(attached_files, file_name);
  if (!target) {
    const pdfList = attached_files.filter(f => f.type === 'pdf' || /\.pdf$/i.test(f.name || ''));
    if (pdfList.length === 0) {
      return { content: '❌ 對話中沒有 PDF 附件。可用的檔案類型:\n' + attached_files.map(f => `- ${f.name} (${f.type || '?'})`).join('\n') };
    }
    return {
      content:
        `❌ 找不到 PDF 檔案 "${file_name}"。\n\n可用 PDF:\n` +
        pdfList.map((f, i) => `${i + 1}. ${f.name}`).join('\n'),
    };
  }

  if (!target.path) return { content: `❌ 檔案 "${target.name}" 路徑未提供` };

  // ── 路徑安全 ────────────────────────────────────────────────────────────────
  let realPath;
  try {
    realPath = fs.realpathSync(target.path);
  } catch (_) {
    return { content: `❌ PDF 檔案已被清除或不存在:${target.name}` };
  }
  if (!realPath.startsWith(UPLOAD_ROOT)) {
    return { content: `❌ 拒絕讀取此路徑(超出允許範圍):${target.name}` };
  }

  // ── Inspect:加密 / 掃描 / 頁數 ────────────────────────────────────────────
  let inspectResult;
  try {
    const args = ['inspect', '--in', realPath];
    if (password) args.push('--password', password);
    inspectResult = await runWorker(args, INSPECT_TIMEOUT_MS);
  } catch (e) {
    return { content: `❌ PDF 解析失敗:${e.message}` };
  }

  if (!inspectResult.ok) {
    if (inspectResult.error_code === 'PASSWORD_REQUIRED') {
      return {
        content:
          `🔒 此 PDF「${target.name}」已加密,需要密碼。\n` +
          `請使用者直接告知密碼,我會帶入再試一次。\n\n` +
          `(若擔心密碼留存在對話紀錄,Phase 1c 上線後將提供獨立輸入框,密碼不會進入對話內容。)`,
        data: { error_code: 'PASSWORD_REQUIRED', file_name: target.name },
      };
    }
    if (inspectResult.error_code === 'PASSWORD_WRONG') {
      return {
        content: `❌ PDF「${target.name}」密碼錯誤,請使用者再提供一次正確的密碼。`,
        data: { error_code: 'PASSWORD_WRONG', file_name: target.name },
      };
    }
    return {
      content: `❌ PDF「${target.name}」無法處理:${inspectResult.error || inspectResult.error_code}`,
      data: inspectResult,
    };
  }

  const { pages, is_scanned_pdf, scanned_ratio, encrypted } = inspectResult;

  // ── 掃描型 PDF:Phase 3 才支援 OCR ─────────────────────────────────────────
  if (is_scanned_pdf) {
    return {
      content:
        `📷 此 PDF「${target.name}」為掃描型(${Math.round(scanned_ratio * 100)}% 頁面無可選取文字)。\n` +
        `目前主轉換流程僅支援文字型 PDF。掃描型 PDF 的 AI OCR 路線(Phase 3)上線後將自動處理,屆時可重新請求轉換。\n\n` +
        `如需立即取得文字,可請使用者改上傳 OCR 處理過的 PDF,或試試對話中直接貼圖請我辨識。`,
      data: { is_scanned_pdf: true, scanned_ratio, pages, file_name: target.name },
    };
  }

  // ── 頁數上限:Phase 1d 才接背景 job ────────────────────────────────────────
  if (pages > PHASE1_PAGE_LIMIT) {
    return {
      content:
        `📄 此 PDF「${target.name}」共 ${pages} 頁,超過目前同步轉換上限(${PHASE1_PAGE_LIMIT} 頁)。\n` +
        `背景轉換功能(Phase 1d)上線後將自動排入背景處理並通知完成。\n\n` +
        `如需立即取得結果,可請使用者分割成較小的 PDF 後分次上傳。`,
      data: { pages, limit: PHASE1_PAGE_LIMIT, file_name: target.name },
    };
  }

  // ── 主轉換 ────────────────────────────────────────────────────────────────
  const outPath = safeOutputPath(target.name);
  let convertResult;
  try {
    const args = ['convert', '--in', realPath, '--out', outPath];
    if (password) args.push('--password', password);
    convertResult = await runWorker(args, CONVERT_TIMEOUT_MS);
  } catch (e) {
    return { content: `❌ PDF 轉換失敗(timeout 或 worker 異常):${e.message}` };
  }

  if (!convertResult.ok) {
    return {
      content: `❌ PDF 轉換失敗:${convertResult.error || convertResult.error_code}`,
      data: convertResult,
    };
  }

  const fname = path.basename(outPath);
  const publicUrl = `/uploads/generated/${fname}`;
  const elapsed = Date.now() - t0;

  return {
    content:
      `✅ 已將「${target.name}」(${pages} 頁${encrypted ? ',已解密' : ''}) 轉換為 Word 檔。\n` +
      `[下載 ${fname}](${publicUrl})\n\n` +
      `_pdf2docx 主轉換流程,耗時 ${(elapsed / 1000).toFixed(1)}s_`,
    data: {
      file_name: target.name,
      pages,
      encrypted,
      out_file: fname,
      out_url: publicUrl,
      elapsed_ms: elapsed,
    },
    files: [{
      type: 'docx',
      filename: fname,
      publicUrl,
    }],
  };
};
