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

// 同步上限 — 超過就走背景 job(Phase 1d)
// 實測複雜中文表格 vision Flash 每頁 8-12s,Pro 12-18s。chat.js 120s tool dispatch 硬限
// 扣 buffer 設這些值。超過就 submitJob 走背景跑、推鈴鐺通知。
const EDITABLE_SYNC_LIMIT = 50;
const VISION_SYNC_LIMIT_FLASH = 12;
const VISION_SYNC_LIMIT_PRO = 6;
const CONVERT_TIMEOUT_MS = 110_000;
const INSPECT_TIMEOUT_MS = 30_000;
const VISION_REBUILD_TIMEOUT_MS = 110_000;

// Internal endpoints(主程序 expose 給 skill child 用),走 127.0.0.1
const INTERNAL_PORT = process.env.PORT || '3007';
const INTERNAL_VISION_URL = `http://127.0.0.1:${INTERNAL_PORT}/api/_internal/pdf-vision-rebuild`;
const INTERNAL_PENDING_PASSWORD_URL = `http://127.0.0.1:${INTERNAL_PORT}/api/_internal/pdf-pending-password`;
const INTERNAL_SUBMIT_JOB_URL = `http://127.0.0.1:${INTERNAL_PORT}/api/_internal/pdf-docx-jobs/submit`;

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

// ── 共用 internal endpoint helper ─────────────────────────────────────────
function _internalSecret() {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s) throw new Error('INTERNAL_API_SECRET 未設定 — server 主程序啟動時應自動生成,skill child env 應繼承');
  return s;
}

async function _internalFetch(url, body, { timeoutMs = 30_000 } = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': _internalSecret() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).error || ''; } catch (_) {}
    throw new Error(`${url} HTTP ${resp.status}: ${detail}`);
  }
  return await resp.json();
}

async function callVisionRebuild({ pdfPath, outDocxPath, password, model }) {
  return _internalFetch(INTERNAL_VISION_URL, {
    pdfPath, outDocxPath, password, model,
    concurrency: 3,
    dpi: 300,
  }, { timeoutMs: VISION_REBUILD_TIMEOUT_MS });
}

async function registerPendingPassword({ pdfPath, pdfName, userId, sessionId }) {
  return _internalFetch(INTERNAL_PENDING_PASSWORD_URL, {
    pdfPath, pdfName, userId, sessionId,
  });
}

async function submitBackgroundJob({ userId, sessionId, pdfPath, pdfName, format, vision_model, pages }) {
  return _internalFetch(INTERNAL_SUBMIT_JOB_URL, {
    userId, sessionId, pdfPath, pdfName,
    format, vision_model, pages,
  });
}

// Mode 決定:format=auto 看 recommended_mode;explicit format 強制
function resolveMode(format, recommendedMode) {
  const f = (format || 'auto').toLowerCase();
  if (f === 'editable' || f === 'vision') return f;
  // auto
  return recommendedMode === 'vision' ? 'vision' : 'editable';
}

module.exports = async function handler(body) {
  const t0 = Date.now();
  const { file_name, password, attached_files, format, vision_model, user_id, session_id } = body || {};

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
      // Phase 1c:不要 LLM 問密碼(會進 chat history)。
      // 改回特殊 prompt 物件,chat.js 偵測 pdf_password_prompt 後 sendEvent 給前端跳 modal。
      // 使用者在 modal 輸密碼 → POST /api/pdf-docx-jobs/decrypt-submit → 排背景 job → 完成推鈴鐺。
      try {
        const reg = await registerPendingPassword({
          pdfPath: realPath, pdfName: target.name, userId: user_id, sessionId: session_id,
        });
        return {
          content:
            `🔒 此 PDF「${target.name}」已加密。\n` +
            `已彈出密碼輸入框,請使用者在獨立輸入框中輸入密碼(密碼**不會**留存於對話內容),系統會自動排背景處理並於完成後通知。`,
          // chat.js 會偵測這個欄位 → SSE event 'pdf_password_prompt' → 前端跳 modal
          pdf_password_prompt: {
            token: reg.token,
            file_name: target.name,
            expires_in: reg.expiresIn,
            session_id,
          },
          data: { error_code: 'PASSWORD_REQUIRED', file_name: target.name, token_registered: true },
        };
      } catch (e) {
        return {
          content: `🔒 此 PDF「${target.name}」已加密,但密碼旁路註冊失敗(${e.message})。請使用者重試,或直接在對話中告知密碼(會留存於對話)。`,
          data: { error_code: 'PASSWORD_REQUIRED', file_name: target.name, fallback: true },
        };
      }
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

  const { pages, is_scanned_pdf, scanned_ratio, encrypted, complexity_score, recommended_mode } = inspectResult;

  // ── 掃描型 PDF:Phase 3 才支援 OCR(屆時 vision mode 會自動處理)─────────
  if (is_scanned_pdf) {
    return {
      content:
        `📷 此 PDF「${target.name}」為掃描型(${Math.round(scanned_ratio * 100)}% 頁面無可選取文字)。\n` +
        `Phase 3 OCR 上線後 vision mode 會自動處理掃描型 PDF。\n\n` +
        `如需立即取得文字,可請使用者改上傳 OCR 處理過的 PDF。`,
      data: { is_scanned_pdf: true, scanned_ratio, pages, file_name: target.name },
    };
  }

  // ── Mode 決定 ──────────────────────────────────────────────────────────────
  const mode = resolveMode(format, recommended_mode);
  const visionModelChoice = (vision_model || '').toLowerCase() === 'pro' ? 'pro' : 'flash';
  const outPath = safeOutputPath(target.name);

  // ── Vision rebuild 路線 ────────────────────────────────────────────────────
  if (mode === 'vision') {
    const visionLimit = visionModelChoice === 'pro' ? VISION_SYNC_LIMIT_PRO : VISION_SYNC_LIMIT_FLASH;
    if (pages > visionLimit) {
      // Phase 1d:超過同步上限改走背景 job(complete 推鈴鐺通知)
      try {
        const submit = await submitBackgroundJob({
          userId: user_id,
          sessionId: session_id,
          pdfPath: realPath,
          pdfName: target.name,
          format: 'vision',
          vision_model: visionModelChoice,
          pages,
        });
        return {
          content:
            `📄 此 PDF「${target.name}」共 ${pages} 頁(complexity ${complexity_score}/100),超過 vision ${visionModelChoice} 同步上限(${visionLimit} 頁)。\n\n` +
            `✅ 已排入**背景處理**(job #${String(submit.jobId).slice(0, 8)}),預估 ${Math.ceil(pages * (visionModelChoice === 'pro' ? 12 : 8) / 3 + 15)} 秒。\n` +
            `完成後右上鈴鐺會通知您,可在對話末再追問或繼續工作,不必等待。`,
          data: { mode: 'vision_background', jobId: submit.jobId, pages, vision_model: visionModelChoice, file_name: target.name },
        };
      } catch (e) {
        return {
          content: `❌ 排入背景 job 失敗:${e.message}\n\n可改 format='editable' 走同步路線(快但可能跑版)。`,
          data: { error: e.message, file_name: target.name },
        };
      }
    }

    let rebuildResult;
    try {
      rebuildResult = await callVisionRebuild({
        pdfPath: realPath,
        outDocxPath: outPath,
        password,
        model: visionModelChoice,
      });
    } catch (e) {
      return {
        content:
          `❌ Vision 重組失敗:${e.message}\n\n` +
          `可改試 format='editable' 走 pdf2docx 路線(快但複雜表格 layout 可能跑掉)。`,
        data: { mode: 'vision', error: e.message, file_name: target.name },
      };
    }
    if (!rebuildResult.ok) {
      return {
        content: `❌ Vision 重組失敗:${rebuildResult.error || '未知錯誤'}`,
        data: rebuildResult,
      };
    }

    const fname = path.basename(outPath);
    const publicUrl = `/uploads/generated/${fname}`;
    const elapsed = Date.now() - t0;
    const tokens = rebuildResult.totalTokens || { input: 0, output: 0 };
    const failedPages = rebuildResult.visionFailedPages || [];
    const failNote = failedPages.length > 0
      ? `\n⚠️ ${failedPages.length} 頁 vision 失敗(p${failedPages.slice(0, 5).join(', p')}),已標記在 docx 對應位置`
      : '';

    return {
      content:
        `✅ 已用 **Vision 智能重組**(${visionModelChoice})將「${target.name}」(${pages} 頁) 轉為 Word。\n` +
        `[下載 ${fname}](${publicUrl})\n\n` +
        `_耗時 ${(elapsed / 1000).toFixed(1)}s,Gemini ${visionModelChoice} tokens in=${tokens.input} out=${tokens.output}_${failNote}`,
      data: {
        mode: 'vision',
        vision_model: visionModelChoice,
        file_name: target.name,
        pages,
        encrypted,
        complexity_score,
        out_file: fname,
        out_url: publicUrl,
        elapsed_ms: elapsed,
        tokens,
        failed_pages: failedPages,
      },
      files: [{ type: 'docx', filename: fname, publicUrl }],
    };
  }

  // ── Editable 路線(pdf2docx)─────────────────────────────────────────────
  if (pages > EDITABLE_SYNC_LIMIT) {
    // Phase 1d:editable 大檔也走背景
    try {
      const submit = await submitBackgroundJob({
        userId: user_id,
        sessionId: session_id,
        pdfPath: realPath,
        pdfName: target.name,
        format: 'editable',
        pages,
      });
      return {
        content:
          `📄 此 PDF「${target.name}」共 ${pages} 頁,超過 editable 同步上限(${EDITABLE_SYNC_LIMIT} 頁)。\n\n` +
          `✅ 已排入**背景處理**(job #${String(submit.jobId).slice(0, 8)}),完成後右上鈴鐺會通知您。`,
        data: { mode: 'editable_background', jobId: submit.jobId, pages, file_name: target.name },
      };
    } catch (e) {
      return {
        content: `❌ 排入背景 job 失敗:${e.message}`,
        data: { error: e.message, file_name: target.name },
      };
    }
  }

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
  // 若 inspect 標 complex 但本次仍走 editable(使用者沒指定 format,recommended_mode 卻是 vision),
  // 提示一句讓 LLM 可以告訴使用者「如果版面跑掉可以改試 vision mode」
  const upgradeHint = (recommended_mode === 'vision')
    ? `\n\n💡 此 PDF 結構複雜(complexity ${complexity_score}/100),若 layout 跑掉可請使用者改用 vision mode(\`format='vision'\`)— 較慢且消耗 token,但會保留表格底色 / 合併儲存格。`
    : '';

  return {
    content:
      `✅ 已用 **editable 模式**(pdf2docx)將「${target.name}」(${pages} 頁${encrypted ? ',已解密' : ''}) 轉為 Word 檔。\n` +
      `[下載 ${fname}](${publicUrl})\n\n` +
      `_耗時 ${(elapsed / 1000).toFixed(1)}s,complexity=${complexity_score}/100_${upgradeHint}`,
    data: {
      mode: 'editable',
      file_name: target.name,
      pages,
      encrypted,
      complexity_score,
      recommended_mode,
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
