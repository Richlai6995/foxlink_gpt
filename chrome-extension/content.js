// FOXLINK GPT Training Recorder — Content Script (injected into all pages)
// Phase 2E: 截圖標註系統 (Annotation Overlay)

// Immediately announce presence to the page
window.postMessage({ type: 'FOXLINK_TRAINING_PONG' }, '*');
console.log('[FOXLINK Training Extension] Content script loaded on', window.location.href);

let isRecording = false;
let annotationActive = false; // 防止重複開啟標註模式

// Safe wrapper for chrome.runtime.sendMessage — handles Extension context invalidated
function safeSendMessage(msg, callback) {
  try {
    if (!chrome.runtime?.id) return; // Extension was unloaded
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return;
      if (callback) callback(res);
    });
  } catch {
    // Extension context invalidated — page needs refresh
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3A: 截圖裁切模式 (Crop Modes)
// ═══════════════════════════════════════════════════════════════════════════════

// Utility: crop a dataUrl image to a rectangle, then pass to annotation mode
function cropAndAnnotate(screenshotDataUrl, cropRect) {
  // cropRect: { x, y, w, h } in pixels relative to screenshot
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = cropRect.w;
    c.height = cropRect.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
    startAnnotationMode(c.toDataURL('image/png'));
  };
  img.src = screenshotDataUrl;
}

// Mode 2: 矩形選取 — 凍結畫面，拖拉選取區域，裁切後進標註
function startRectCropMode(screenshotDataUrl) {
  if (annotationActive) return;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:2147483646;cursor:crosshair;
    background:rgba(0,0,0,0.3);
    font-family:-apple-system,sans-serif;
  `;

  // Background image
  const bgImg = document.createElement('img');
  bgImg.src = screenshotDataUrl;
  bgImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;opacity:0.6;pointer-events:none;';
  overlay.appendChild(bgImg);

  // Selection box
  const selBox = document.createElement('div');
  selBox.style.cssText = 'position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);display:none;pointer-events:none;z-index:2;';
  overlay.appendChild(selBox);

  // Instruction
  const hint = document.createElement('div');
  hint.textContent = '拖拉選取要截圖的區域，放開滑鼠確認';
  hint.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.9);color:white;padding:6px 16px;border-radius:8px;font-size:13px;z-index:3;';
  overlay.appendChild(hint);

  let startPt = null;
  let selRect = null;

  overlay.addEventListener('mousedown', (e) => {
    startPt = { x: e.clientX, y: e.clientY };
    selBox.style.display = 'block';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!startPt) return;
    const x = Math.min(startPt.x, e.clientX);
    const y = Math.min(startPt.y, e.clientY);
    const w = Math.abs(e.clientX - startPt.x);
    const h = Math.abs(e.clientY - startPt.y);
    selBox.style.left = x + 'px';
    selBox.style.top = y + 'px';
    selBox.style.width = w + 'px';
    selBox.style.height = h + 'px';
    selRect = { x, y, w, h };
  });

  overlay.addEventListener('mouseup', () => {
    if (!selRect || selRect.w < 10 || selRect.h < 10) {
      // Too small or no selection — use full screenshot
      overlay.remove();
      startAnnotationMode(screenshotDataUrl);
      return;
    }

    // Convert screen coords to image coords (account for devicePixelRatio)
    const dpr = window.devicePixelRatio || 1;
    const cropRect = {
      x: Math.round(selRect.x * dpr),
      y: Math.round(selRect.y * dpr),
      w: Math.round(selRect.w * dpr),
      h: Math.round(selRect.h * dpr)
    };

    overlay.remove();
    cropAndAnnotate(screenshotDataUrl, cropRect);
  });

  // ESC to cancel
  const onKey = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}

// Mode 3: 智慧偵測 — 互動式 hover 選取區域
function startSmartCropMode(screenshotDataUrl) {
  if (annotationActive) return;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:2147483646;cursor:crosshair;
    font-family:-apple-system,sans-serif;
  `;

  // Highlight box (follows hovered element)
  const highlight = document.createElement('div');
  highlight.style.cssText = `
    position:fixed;z-index:2147483647;pointer-events:none;
    border:3px solid #22c55e;border-radius:4px;background:rgba(34,197,94,0.12);
    transition:all 0.1s;display:none;
  `;
  overlay.appendChild(highlight);

  // Instruction hint
  const hint = document.createElement('div');
  hint.textContent = '移動滑鼠選取區域，點擊確認 | ESC 取消';
  hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.9);color:white;padding:6px 16px;border-radius:8px;font-size:13px;z-index:2147483647;pointer-events:none;';
  overlay.appendChild(hint);

  let hoveredEl = null;

  overlay.addEventListener('mousemove', (e) => {
    // Temporarily hide overlay to get element beneath
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = '';

    if (!el || el === document.body || el === document.documentElement) {
      highlight.style.display = 'none';
      hoveredEl = null;
      return;
    }

    // Skip tiny elements — walk up to find a meaningful container
    let target = el;
    while (target && target !== document.body) {
      const r = target.getBoundingClientRect();
      if (r.width >= 60 && r.height >= 40) break;
      target = target.parentElement;
    }
    if (!target || target === document.body) { highlight.style.display = 'none'; hoveredEl = null; return; }

    hoveredEl = target;
    const r = target.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = r.left + 'px';
    highlight.style.top = r.top + 'px';
    highlight.style.width = r.width + 'px';
    highlight.style.height = r.height + 'px';
  });

  overlay.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hoveredEl) { overlay.remove(); startAnnotationMode(screenshotDataUrl); return; }

    const rect = hoveredEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pad = 4;
    const cropRect = {
      x: Math.max(0, Math.round((rect.left - pad) * dpr)),
      y: Math.max(0, Math.round((rect.top - pad) * dpr)),
      w: Math.round((rect.width + pad * 2) * dpr),
      h: Math.round((rect.height + pad * 2) * dpr)
    };
    overlay.remove();
    cropAndAnnotate(screenshotDataUrl, cropRect);
  });

  const onKey = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2E: 標註系統 (Annotation Overlay System)
// ═══════════════════════════════════════════════════════════════════════════════

function startAnnotationMode(screenshotDataUrl) {
  if (annotationActive) return;
  annotationActive = true;

  // State
  let currentTool = 'number'; // move|number|circle|rect|arrow|text|freehand|mosaic
  let currentColor = '#ef4444';
  let strokeWidth = 3;
  let textFontSize = 16; // Canvas-pixel font size for text tool (independent from strokeWidth)
  let stepCounter = badgeStepCount; // 從 badge 繼承，避免繼續錄製時步驟號回退
  let annotations = [];
  let undoStack = [];
  let isDrawing = false;
  let startPoint = null;
  let freehandPoints = [];

  // Move tool state
  let selectedAnnotation = null; // annotation being dragged
  let moveStartPct = null;       // drag start in % coords
  let _lastMousePt = null;       // track cursor for delete key
  let resizeHandle = null;       // 'tl'|'tr'|'bl'|'br'|'l'|'r'|'t'|'b' when actively resizing
  let resizeStartCoords = null;  // snapshot of annotation coords at resize start

  // ── 1. Create overlay container ──
  const overlay = document.createElement('div');
  overlay.id = 'foxlink-annotation-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483646;
    background: #000; cursor: crosshair;
    display: flex; flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  `;

  // ── 2. Toolbar ──
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    display: flex; align-items: center; gap: 6px; padding: 8px 12px;
    background: rgba(15, 23, 42, 0.97); border-bottom: 1px solid rgba(255,255,255,0.15);
    flex-shrink: 0; flex-wrap: wrap; z-index: 10;
    backdrop-filter: blur(8px);
  `;

  const tools = [
    { id: 'move',     icon: '✥', tip: '移動標記 (V)' },
    { id: 'number',   icon: '①', tip: '步驟編號' },
    { id: 'circle',   icon: '◯', tip: '圓圈' },
    { id: 'rect',     icon: '▭', tip: '矩形框' },
    { id: 'arrow',    icon: '→', tip: '箭頭' },
    { id: 'text',     icon: 'T', tip: '文字' },
    { id: 'freehand', icon: '✎', tip: '畫筆' },
    { id: 'mosaic',   icon: '▦', tip: '馬賽克' },
  ];

  const colors = [
    { hex: '#ef4444', name: '紅' },
    { hex: '#3b82f6', name: '藍' },
    { hex: '#22c55e', name: '綠' },
    { hex: '#eab308', name: '黃' },
    { hex: '#ffffff', name: '白' },
  ];

  const widths = [
    { val: 2, label: '─' },
    { val: 4, label: '━' },
    { val: 6, label: '▬' },
  ];

  // Tool buttons
  const toolGroup = document.createElement('div');
  toolGroup.style.cssText = 'display:flex;gap:3px;';
  const toolBtns = {};
  tools.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t.icon;
    btn.title = t.tip;
    btn.dataset.tool = t.id;
    btn.style.cssText = `
      width: 34px; height: 34px; border: 2px solid transparent; border-radius: 6px;
      background: rgba(255,255,255,0.1); color: #fff; font-size: 16px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    `;
    btn.addEventListener('click', () => selectTool(t.id));
    toolGroup.appendChild(btn);
    toolBtns[t.id] = btn;
  });
  toolbar.appendChild(toolGroup);

  // Separator
  const sep1 = document.createElement('div');
  sep1.style.cssText = 'width:1px;height:24px;background:rgba(255,255,255,0.2);margin:0 4px;';
  toolbar.appendChild(sep1);

  // Color buttons
  const colorGroup = document.createElement('div');
  colorGroup.style.cssText = 'display:flex;gap:3px;align-items:center;';
  const colorLabel = document.createElement('span');
  colorLabel.textContent = '顏色:';
  colorLabel.style.cssText = 'color:rgba(255,255,255,0.6);font-size:11px;margin-right:2px;';
  colorGroup.appendChild(colorLabel);
  const colorBtns = {};
  colors.forEach(c => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      width: 22px; height: 22px; border-radius: 50%;
      border: 2px solid transparent; cursor: pointer;
      background: ${c.hex}; transition: all 0.15s;
    `;
    btn.title = c.name;
    btn.addEventListener('click', () => selectColor(c.hex));
    colorGroup.appendChild(btn);
    colorBtns[c.hex] = btn;
  });
  toolbar.appendChild(colorGroup);

  // Separator
  const sep2 = sep1.cloneNode();
  toolbar.appendChild(sep2);

  // Width buttons
  const widthGroup = document.createElement('div');
  widthGroup.style.cssText = 'display:flex;gap:3px;align-items:center;';
  const widthLabel = document.createElement('span');
  widthLabel.textContent = '粗細:';
  widthLabel.style.cssText = 'color:rgba(255,255,255,0.6);font-size:11px;margin-right:2px;';
  widthGroup.appendChild(widthLabel);
  const widthBtns = {};
  widths.forEach(w => {
    const btn = document.createElement('button');
    btn.textContent = w.label;
    btn.style.cssText = `
      width: 28px; height: 28px; border: 2px solid transparent; border-radius: 4px;
      background: rgba(255,255,255,0.1); color: #fff; font-size: 14px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
    `;
    btn.addEventListener('click', () => selectWidth(w.val));
    widthGroup.appendChild(btn);
    widthBtns[w.val] = btn;
  });
  toolbar.appendChild(widthGroup);

  // Text font size selector (shown only when text tool is active)
  const FONT_SIZES = [
    { val: 12, label: 'XS' },
    { val: 14, label: 'S' },
    { val: 18, label: 'M' },
    { val: 24, label: 'L' },
    { val: 32, label: 'XL' },
  ];
  const textSizeGroup = document.createElement('div');
  textSizeGroup.style.cssText = 'display:none;gap:3px;align-items:center;margin-left:6px;';
  const textSizeLabel = document.createElement('span');
  textSizeLabel.textContent = '字級:';
  textSizeLabel.style.cssText = 'color:rgba(255,255,255,0.6);font-size:11px;margin-right:2px;';
  textSizeGroup.appendChild(textSizeLabel);
  const textSizeBtns = {};
  FONT_SIZES.forEach(s => {
    const btn = document.createElement('button');
    btn.textContent = s.label;
    btn.title = `${s.val}px`;
    btn.style.cssText = `
      min-width: 28px; height: 28px; padding: 0 6px;
      border: 2px solid transparent; border-radius: 4px;
      background: rgba(255,255,255,0.1); color: #fff; font-size: 11px; font-weight: 600;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
    `;
    btn.addEventListener('click', () => selectTextSize(s.val));
    textSizeGroup.appendChild(btn);
    textSizeBtns[s.val] = btn;
  });
  toolbar.appendChild(textSizeGroup);

  // Separator
  const sep3 = sep1.cloneNode();
  toolbar.appendChild(sep3);

  // Action buttons
  const actionGroup = document.createElement('div');
  actionGroup.style.cssText = 'display:flex;gap:4px;align-items:center;';

  const undoBtn = makeActionBtn('↩ 復原', () => undo());
  const redoBtn = makeActionBtn('↪ 重做', () => redo());
  const clearBtn = makeActionBtn('🗑 清除', () => clearAll());
  actionGroup.appendChild(undoBtn);
  actionGroup.appendChild(redoBtn);
  actionGroup.appendChild(clearBtn);
  toolbar.appendChild(actionGroup);

  // Spacer
  const spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;';
  toolbar.appendChild(spacer);

  // Confirm / Cancel
  const confirmGroup = document.createElement('div');
  confirmGroup.style.cssText = 'display:flex;gap:6px;';

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✅ 確認截圖';
  confirmBtn.style.cssText = `
    padding: 6px 16px; border: none; border-radius: 6px;
    background: #22c55e; color: #fff; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: background 0.2s;
  `;
  confirmBtn.addEventListener('mouseenter', () => confirmBtn.style.background = '#16a34a');
  confirmBtn.addEventListener('mouseleave', () => confirmBtn.style.background = '#22c55e');

  const skipBtn = document.createElement('button');
  skipBtn.textContent = '⏭ 跳過標註';
  skipBtn.title = '直接上傳原圖（不標註）';
  skipBtn.style.cssText = `
    padding: 6px 12px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px;
    background: transparent; color: #94a3b8; font-size: 12px;
    cursor: pointer; transition: all 0.2s;
  `;
  skipBtn.addEventListener('mouseenter', () => { skipBtn.style.background = 'rgba(255,255,255,0.1)'; skipBtn.style.color = '#fff'; });
  skipBtn.addEventListener('mouseleave', () => { skipBtn.style.background = 'transparent'; skipBtn.style.color = '#94a3b8'; });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✗ 取消';
  cancelBtn.style.cssText = `
    padding: 6px 12px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px;
    background: transparent; color: #f87171; font-size: 13px;
    cursor: pointer; transition: all 0.2s;
  `;
  cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = 'rgba(239,68,68,0.2)');
  cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'transparent');

  // Phase 3A-2: Step number + Language selector (before confirm buttons)
  const metaGroup = document.createElement('div');
  metaGroup.style.cssText = 'display:flex;gap:6px;align-items:center;margin-right:8px;';

  const stepLabel = document.createElement('span');
  stepLabel.textContent = '步驟:';
  stepLabel.style.cssText = 'color:rgba(255,255,255,0.6);font-size:11px;';
  metaGroup.appendChild(stepLabel);

  const stepInput = document.createElement('input');
  stepInput.type = 'number';
  stepInput.min = '1';
  stepInput.value = String(badgeStepCount + 1);
  stepInput.style.cssText = `
    width: 42px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px; color: #fff; font-size: 12px; text-align: center; padding: 2px 4px;
    outline: none;
  `;
  metaGroup.appendChild(stepInput);

  const langLabel = document.createElement('span');
  langLabel.textContent = '語言:';
  langLabel.style.cssText = 'color:rgba(255,255,255,0.6);font-size:11px;margin-left:4px;';
  metaGroup.appendChild(langLabel);

  const langSelect = document.createElement('select');
  langSelect.innerHTML = '<option value="zh-TW">🇹🇼 中</option><option value="en">🇺🇸 EN</option><option value="vi">🇻🇳 VI</option>';
  langSelect.value = badgeLang || 'zh-TW';
  langSelect.style.cssText = `
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px; color: #fff; font-size: 11px; padding: 2px 4px; outline: none; cursor: pointer;
  `;
  langSelect.addEventListener('change', () => { badgeLang = langSelect.value; });
  metaGroup.appendChild(langSelect);

  confirmGroup.appendChild(metaGroup);
  confirmGroup.appendChild(skipBtn);
  confirmGroup.appendChild(confirmBtn);
  confirmGroup.appendChild(cancelBtn);
  toolbar.appendChild(confirmGroup);

  overlay.appendChild(toolbar);

  // ── 3. Canvas area ──
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';

  // Background image (the screenshot)
  const bgImg = document.createElement('img');
  bgImg.src = screenshotDataUrl;
  bgImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;';
  canvasWrap.appendChild(bgImg);

  // Drawing canvas
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;';
  canvasWrap.appendChild(canvas);

  // Text input wrapper (hidden until text tool) — multi-line textarea + submit button
  const textInputWrap = document.createElement('div');
  textInputWrap.style.cssText = `
    position: absolute; display: none; z-index: 20;
    background: rgba(0,0,0,0.82); border: 2px solid #3b82f6;
    border-radius: 6px; padding: 4px; box-shadow: 0 6px 18px rgba(0,0,0,0.5);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  `;
  const textInput = document.createElement('textarea');
  textInput.placeholder = '輸入標註文字 (Enter 換行)\nCtrl+Enter 或點 ✓ 送出 / Esc 取消';
  textInput.rows = 3;
  textInput.style.cssText = `
    display: block; background: transparent; color: #fff; border: none;
    padding: 4px 6px; font-size: 16px; font-weight: 700;
    outline: none; font-family: inherit;
    min-width: 220px; min-height: 70px; resize: both;
    line-height: 1.4; white-space: pre;
  `;
  textInputWrap.appendChild(textInput);
  // Submit button row
  const textInputBtnRow = document.createElement('div');
  textInputBtnRow.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;padding:2px 2px 0;';
  const textInputConfirm = document.createElement('button');
  textInputConfirm.textContent = '✓ 確認';
  textInputConfirm.style.cssText = `
    padding: 3px 10px; border: none; border-radius: 4px;
    background: #3b82f6; color: #fff; font-size: 11px; font-weight: 600;
    cursor: pointer;
  `;
  const textInputCancel = document.createElement('button');
  textInputCancel.textContent = '取消';
  textInputCancel.style.cssText = `
    padding: 3px 10px; border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
    background: transparent; color: #e2e8f0; font-size: 11px;
    cursor: pointer;
  `;

  // WCAG relative luminance — 0 (black) ~ 1 (white)
  const relLuminance = (hex) => {
    const m = /^#?([a-f0-9]{6})$/i.exec(hex || '');
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    const chs = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chs[0] + 0.7152 * chs[1] + 0.0722 * chs[2];
  };

  // Apply adaptive theme to text input. Picks black vs white background by
  // whichever gives better WCAG contrast against the current text color,
  // then adds a pixel text-outline so glyphs pop regardless of backdrop.
  const applyTextInputTheme = () => {
    const L = relLuminance(currentColor);
    const contrastBlack = (L + 0.05) / 0.05;
    const contrastWhite = 1.05 / (L + 0.05);
    const preferDark = contrastBlack >= contrastWhite;
    // Outline shadow — opposite of bg, 4-direction 1px stroke + soft glow
    const outlineCol = preferDark ? '0,0,0' : '255,255,255';
    const outline = `
      -1px -1px 0 rgba(${outlineCol},0.9),
       1px -1px 0 rgba(${outlineCol},0.9),
      -1px  1px 0 rgba(${outlineCol},0.9),
       1px  1px 0 rgba(${outlineCol},0.9),
       0    0   4px rgba(${outlineCol},0.8)
    `;
    textInputWrap.style.background = preferDark ? 'rgba(0,0,0,0.82)' : 'rgba(255,255,255,0.92)';
    textInputWrap.style.borderColor = currentColor;
    textInput.style.color = currentColor;
    textInput.style.textShadow = outline;
    textInput.style.caretColor = currentColor;
    textInputCancel.style.color = preferDark ? '#e2e8f0' : '#475569';
    textInputCancel.style.borderColor = preferDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
  };
  textInputBtnRow.appendChild(textInputCancel);
  textInputBtnRow.appendChild(textInputConfirm);
  textInputWrap.appendChild(textInputBtnRow);
  // Auto-resize to fit content as user types
  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = (textInput.scrollHeight + 4) + 'px';
  });
  canvasWrap.appendChild(textInputWrap);

  // Shared commit helper — creates annotation from current textInput value
  const commitTextAnnotation = () => {
    const text = textInput.value.replace(/\s+$/, '');
    if (text) {
      annotations.push({
        id: 'a' + Date.now(), type: 'text',
        coords: textInput._coords,
        color: currentColor, strokeWidth, fontSize: textFontSize, label: text,
        purpose: 'both', visible: true
      });
      undoStack = [];
      redrawAll();
    }
    textInputWrap.style.display = 'none';
    textInput.value = '';
    textInput.style.height = '';
  };
  const cancelTextInput = () => {
    textInputWrap.style.display = 'none';
    textInput.value = '';
    textInput.style.height = '';
  };
  textInputConfirm.addEventListener('click', (e) => { e.stopPropagation(); commitTextAnnotation(); });
  textInputCancel.addEventListener('click', (e) => { e.stopPropagation(); cancelTextInput(); });

  overlay.appendChild(canvasWrap);
  document.body.appendChild(overlay);

  // ── 4. Resize canvas to match image ──
  let canvasW, canvasH;
  // Image display rect within canvas (accounting for object-fit:contain letterboxing).
  // Recomputed live via computeImgRect() — never trust a snapshot, layout can change.
  let imgRect = { x: 0, y: 0, w: 0, h: 0 };

  function computeImgRect() {
    const rect = canvasWrap.getBoundingClientRect();
    canvasW = rect.width;
    canvasH = rect.height;
    if (canvasW <= 0 || canvasH <= 0) return;
    canvas.width = canvasW * window.devicePixelRatio;
    canvas.height = canvasH * window.devicePixelRatio;
    canvas.style.width = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const natW = bgImg.naturalWidth || canvasW;
    const natH = bgImg.naturalHeight || canvasH;
    if (!natW || !natH) return;
    const imgAspect = natW / natH;
    const cAspect = canvasW / canvasH;
    if (imgAspect > cAspect) {
      imgRect.w = canvasW;
      imgRect.h = canvasW / imgAspect;
      imgRect.x = 0;
      imgRect.y = (canvasH - imgRect.h) / 2;
    } else {
      imgRect.h = canvasH;
      imgRect.w = canvasH * imgAspect;
      imgRect.y = 0;
      imgRect.x = (canvasW - imgRect.w) / 2;
    }
    redrawAll();
  }

  bgImg.onload = computeImgRect;
  if (bgImg.complete) setTimeout(computeImgRect, 50);

  // Live-track layout changes (window resize, devtools open, toolbar wrap, etc.)
  // — without this, imgRect goes stale and toPct returns wrong percentages.
  const ro = new ResizeObserver(() => computeImgRect());
  ro.observe(canvasWrap);
  window.addEventListener('resize', computeImgRect);

  // ── 5. Selection highlights ──
  selectTool('number');
  selectColor('#ef4444');
  selectWidth(3);
  selectTextSize(16);

  function selectTool(id) {
    currentTool = id;
    // Switching away from move tool clears selection so handles disappear
    if (id !== 'move') {
      selectedAnnotation = null;
      resizeHandle = null;
      resizeStartCoords = null;
      moveStartPct = null;
    }
    Object.entries(toolBtns).forEach(([k, btn]) => {
      btn.style.borderColor = k === id ? '#3b82f6' : 'transparent';
      btn.style.background = k === id ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.1)';
    });
    // Swap toolbar groups: text tool shows font-size selector, others show stroke width
    const isText = id === 'text';
    widthGroup.style.display = isText ? 'none' : 'flex';
    textSizeGroup.style.display = isText ? 'flex' : 'none';
    canvas.style.cursor = id === 'move' ? 'default' : id === 'text' ? 'text' : 'crosshair';
    redrawAll();
  }

  function selectTextSize(val) {
    textFontSize = val;
    Object.entries(textSizeBtns).forEach(([k, btn]) => {
      const active = Number(k) === val;
      btn.style.borderColor = active ? '#3b82f6' : 'transparent';
      btn.style.background = active ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.1)';
    });
    // Reflect size in live textarea if open
    if (textInputWrap.style.display === 'block') {
      textInput.style.fontSize = val + 'px';
    }
  }

  function selectColor(hex) {
    currentColor = hex;
    Object.entries(colorBtns).forEach(([k, btn]) => {
      btn.style.borderColor = k === hex ? '#fff' : 'transparent';
      btn.style.transform = k === hex ? 'scale(1.2)' : 'scale(1)';
    });
    // Live-update text input theme if user switches color mid-edit
    if (textInputWrap.style.display === 'block') {
      applyTextInputTheme();
    }
  }

  function selectWidth(val) {
    strokeWidth = val;
    Object.entries(widthBtns).forEach(([k, btn]) => {
      btn.style.borderColor = Number(k) === val ? '#3b82f6' : 'transparent';
    });
  }

  function makeActionBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      padding: 4px 10px; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
      background: transparent; color: #cbd5e1; font-size: 12px;
      cursor: pointer; transition: all 0.15s;
    `;
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,0.1)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
    return btn;
  }

  // ── 6. Drawing helpers ──
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function toPct(px, isX) {
    // Convert canvas-absolute pixel to percentage relative to image display area.
    // ⚠️ Use ONLY for absolute positions (x, y), NOT for distances (w, h, rx, ry).
    if (isX) return ((px - imgRect.x) / (imgRect.w || canvasW)) * 100;
    return ((px - imgRect.y) / (imgRect.h || canvasH)) * 100;
  }

  function distToPct(px, isX) {
    // Convert canvas pixel DISTANCE (width/height/radius) to percentage of image display area.
    // No offset subtraction — distances are translation-invariant.
    if (isX) return (px / (imgRect.w || canvasW)) * 100;
    return (px / (imgRect.h || canvasH)) * 100;
  }

  function fromPct(pct, isX) {
    // Convert percentage to canvas pixel ABSOLUTE position (adds letterbox offset).
    // ⚠️ Use ONLY for absolute positions (x, y), NOT for distances (w, h, rx, ry).
    if (isX) return (pct / 100) * (imgRect.w || canvasW) + imgRect.x;
    return (pct / 100) * (imgRect.h || canvasH) + imgRect.y;
  }

  function fromPctDist(pct, isX) {
    // Convert percentage DISTANCE (width/height/radius) to canvas pixel distance.
    // No offset addition — distances are translation-invariant.
    if (isX) return (pct / 100) * (imgRect.w || canvasW);
    return (pct / 100) * (imgRect.h || canvasH);
  }

  function getCtx() {
    return canvas.getContext('2d');
  }

  // ── 6b. Hit-test: find annotation under cursor (for move tool) ──
  function hitTest(px, py) {
    // px, py in canvas pixel coords — convert to pct
    const xPct = toPct(px, true);
    const yPct = toPct(py, false);
    // Search in reverse order (top-most first)
    for (let i = annotations.length - 1; i >= 0; i--) {
      const a = annotations[i];
      const c = a.coords;
      switch (a.type) {
        case 'number': {
          // 18px hit radius — use distToPct (distance, not absolute position)
          const rxPct = distToPct(18, true);
          const ryPct = distToPct(18, false);
          if (Math.abs(xPct - c.x) < rxPct && Math.abs(yPct - c.y) < ryPct) return a;
          break;
        }
        case 'circle': {
          // Point inside ellipse: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
          const dx = (xPct - c.x) / (Math.abs(c.rx) + 1);
          const dy = (yPct - c.y) / (Math.abs(c.ry) + 1);
          if (dx * dx + dy * dy <= 1.3) return a; // 1.3 = generous hit
          break;
        }
        case 'rect':
        case 'mosaic': {
          const x1 = Math.min(c.x, c.x + c.w), x2 = Math.max(c.x, c.x + c.w);
          const y1 = Math.min(c.y, c.y + c.h), y2 = Math.max(c.y, c.y + c.h);
          if (xPct >= x1 && xPct <= x2 && yPct >= y1 && yPct <= y2) return a;
          break;
        }
        case 'arrow': {
          // Distance from point to line segment
          const dist = pointToSegDist(xPct, yPct, c.x, c.y, c.x2, c.y2);
          if (dist < 2.5) return a; // 2.5% tolerance
          break;
        }
        case 'text': {
          // Approximate bounding box from text position — multi-line aware
          // New annotations: a.fontSize (px); legacy: derived from strokeWidth
          const fontSize = a.fontSize || ((a.strokeWidth || 3) * 5 + 8);
          const lines = String(a.label || '').split('\n');
          const longest = lines.reduce((m, ln) => Math.max(m, ln.length), 0);
          const lineHeight = fontSize * 1.25;
          const wPct = distToPct(fontSize * longest * 0.6, true);
          const hPct = distToPct(lineHeight * lines.length, false);
          if (xPct >= c.x - 1 && xPct <= c.x + wPct + 1 && yPct >= c.y - distToPct(fontSize, false) && yPct <= c.y + hPct - distToPct(fontSize, false) + 1) return a;
          break;
        }
        case 'freehand': {
          if (c.points) {
            for (const p of c.points) {
              if (Math.abs(xPct - p.x) < 1.5 && Math.abs(yPct - p.y) < 1.5) return a;
            }
          }
          break;
        }
      }
    }
    return null;
  }

  function pointToSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  }

  // Move an annotation by delta in pct coords
  function moveAnnotation(a, dxPct, dyPct) {
    const c = a.coords;
    switch (a.type) {
      case 'number':
      case 'text':
        c.x += dxPct; c.y += dyPct; break;
      case 'circle':
        c.x += dxPct; c.y += dyPct; break;
      case 'rect':
      case 'mosaic':
        c.x += dxPct; c.y += dyPct; break;
      case 'arrow':
        c.x += dxPct; c.y += dyPct; c.x2 += dxPct; c.y2 += dyPct; break;
      case 'freehand':
        if (c.points) c.points.forEach(p => { p.x += dxPct; p.y += dyPct; });
        break;
    }
  }

  // ── 7. Redraw all annotations ──
  function redrawAll() {
    const ctx = getCtx();
    ctx.clearRect(0, 0, canvasW, canvasH);
    annotations.forEach(a => drawAnnotation(ctx, a));
    // Draw resize handles for selected annotation
    if (selectedAnnotation && currentTool === 'move') {
      drawResizeHandles(ctx, selectedAnnotation);
    }
  }

  // Compute the canvas-pixel bounding box of an annotation (for resize handle layout).
  // Returns {x1, y1, x2, y2} in canvas px, or null if type doesn't support resize.
  function annotPxBox(a) {
    const c = a.coords;
    if (a.type === 'rect' || a.type === 'mosaic') {
      const x1 = fromPct(c.x, true);
      const y1 = fromPct(c.y, false);
      const x2 = x1 + fromPctDist(c.w, true);
      const y2 = y1 + fromPctDist(c.h, false);
      return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
    }
    if (a.type === 'circle') {
      const cx = fromPct(c.x, true);
      const cy = fromPct(c.y, false);
      const rx = Math.abs(fromPctDist(c.rx, true));
      const ry = Math.abs(fromPctDist(c.ry, false));
      return { x1: cx - rx, y1: cy - ry, x2: cx + rx, y2: cy + ry };
    }
    return null;
  }

  // Get handle positions {id → {x, y}} for an annotation
  function handlePositions(a) {
    const b = annotPxBox(a);
    if (!b) return {};
    const mx = (b.x1 + b.x2) / 2;
    const my = (b.y1 + b.y2) / 2;
    return {
      tl: { x: b.x1, y: b.y1 }, tr: { x: b.x2, y: b.y1 },
      bl: { x: b.x1, y: b.y2 }, br: { x: b.x2, y: b.y2 },
      t:  { x: mx,   y: b.y1 }, b:  { x: mx,   y: b.y2 },
      l:  { x: b.x1, y: my   }, r:  { x: b.x2, y: my   },
    };
  }

  function drawResizeHandles(ctx, a) {
    const handles = handlePositions(a);
    const ids = Object.keys(handles);
    if (ids.length === 0) return;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    const r = 5;
    for (const id of ids) {
      const h = handles[id];
      ctx.beginPath();
      ctx.rect(h.x - r, h.y - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Hit-test resize handles. Returns handle id or null.
  function hitTestHandle(px, py) {
    if (!selectedAnnotation) return null;
    const handles = handlePositions(selectedAnnotation);
    const tol = 8; // generous hit area
    for (const id of Object.keys(handles)) {
      const h = handles[id];
      if (Math.abs(px - h.x) <= tol && Math.abs(py - h.y) <= tol) return id;
    }
    return null;
  }

  // Cursor for each handle
  const HANDLE_CURSORS = {
    tl: 'nwse-resize', br: 'nwse-resize',
    tr: 'nesw-resize', bl: 'nesw-resize',
    t: 'ns-resize', b: 'ns-resize',
    l: 'ew-resize', r: 'ew-resize',
  };

  // Apply resize delta in % coords to the annotation
  function applyResize(a, handleId, startCoords, dxPct, dyPct) {
    const c = a.coords;
    if (a.type === 'rect' || a.type === 'mosaic') {
      // Normalize: track left/top/right/bottom in pct
      let l = startCoords.x, t = startCoords.y;
      let r = startCoords.x + startCoords.w;
      let b = startCoords.y + startCoords.h;
      if (handleId.includes('l')) l += dxPct;
      if (handleId.includes('r')) r += dxPct;
      if (handleId.includes('t')) t += dyPct;
      if (handleId.includes('b')) b += dyPct;
      c.x = Math.min(l, r);
      c.y = Math.min(t, b);
      c.w = Math.abs(r - l);
      c.h = Math.abs(b - t);
    } else if (a.type === 'circle') {
      // Resize from corner: rx/ry follow corner offset
      let rx = startCoords.rx, ry = startCoords.ry;
      if (handleId.includes('l') || handleId.includes('r')) {
        rx = Math.max(0.5, startCoords.rx + (handleId.includes('r') ? dxPct : -dxPct));
      }
      if (handleId.includes('t') || handleId.includes('b')) {
        ry = Math.max(0.5, startCoords.ry + (handleId.includes('b') ? dyPct : -dyPct));
      }
      c.rx = rx;
      c.ry = ry;
    }
  }

  function drawAnnotation(ctx, a) {
    ctx.save();
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = a.strokeWidth || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (a.type) {
      case 'number': {
        const x = fromPct(a.coords.x, true);
        const y = fromPct(a.coords.y, false);
        const r = 14;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(a.stepNumber), x, y);
        if (a.label) {
          ctx.fillStyle = a.color;
          ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(a.label, x + r + 4, y + 4);
        }
        break;
      }
      case 'circle': {
        const cx = fromPct(a.coords.x, true);
        const cy = fromPct(a.coords.y, false);
        const rx = fromPctDist(a.coords.rx, true);
        const ry = fromPctDist(a.coords.ry, false);
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'rect': {
        const x = fromPct(a.coords.x, true);
        const y = fromPct(a.coords.y, false);
        const w = fromPctDist(a.coords.w, true);
        const h = fromPctDist(a.coords.h, false);
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case 'arrow': {
        const x1 = fromPct(a.coords.x, true);
        const y1 = fromPct(a.coords.y, false);
        const x2 = fromPct(a.coords.x2, true);
        const y2 = fromPct(a.coords.y2, false);
        drawArrow(ctx, x1, y1, x2, y2, a.strokeWidth || 3);
        break;
      }
      case 'text': {
        const x = fromPct(a.coords.x, true);
        const y = fromPct(a.coords.y, false);
        // New annotations: a.fontSize (px); legacy: derived from strokeWidth
        const fontSize = a.fontSize || ((a.strokeWidth || 3) * 5 + 8);
        const lineHeight = Math.round(fontSize * 1.25);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textBaseline = 'alphabetic';
        const lines = String(a.label || '').split('\n');
        // Text background — width = widest line, height = N lines
        let maxW = 0;
        for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
        const bgX = x - 2;
        const bgY = y - fontSize + 2;
        const bgW = maxW + 4;
        const bgH = (lines.length - 1) * lineHeight + fontSize + 4;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bgX, bgY, bgW, bgH);
        // Each line
        ctx.fillStyle = a.color;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], x, y + i * lineHeight);
        }
        break;
      }
      case 'freehand': {
        if (a.coords.points && a.coords.points.length > 1) {
          ctx.beginPath();
          const pts = a.coords.points;
          ctx.moveTo(fromPct(pts[0].x, true), fromPct(pts[0].y, false));
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(fromPct(pts[i].x, true), fromPct(pts[i].y, false));
          }
          ctx.stroke();
        }
        break;
      }
      case 'mosaic': {
        const x = fromPct(a.coords.x, true);
        const y = fromPct(a.coords.y, false);
        const w = fromPctDist(a.coords.w, true);
        const h = fromPctDist(a.coords.h, false);
        // Real pixelation mosaic — sample from background image
        const blockSize = 12;
        const rx = Math.min(x, x + w);
        const ry = Math.min(y, y + h);
        const rw = Math.abs(w);
        const rh = Math.abs(h);
        // Try to read pixels from a temp canvas with the screenshot
        try {
          const tmpC = document.createElement('canvas');
          tmpC.width = canvasW; tmpC.height = canvasH;
          const tmpCtx = tmpC.getContext('2d');
          tmpCtx.drawImage(bgImg, 0, 0, canvasW, canvasH);
          const imgData = tmpCtx.getImageData(rx, ry, rw, rh);
          for (let bx = 0; bx < rw; bx += blockSize) {
            for (let by = 0; by < rh; by += blockSize) {
              // Sample center pixel of block
              const sx = Math.min(bx + Math.floor(blockSize / 2), rw - 1);
              const sy = Math.min(by + Math.floor(blockSize / 2), rh - 1);
              const pi = (sy * rw + sx) * 4;
              ctx.fillStyle = `rgb(${imgData.data[pi]},${imgData.data[pi+1]},${imgData.data[pi+2]})`;
              ctx.fillRect(rx + bx, ry + by, Math.min(blockSize, rw - bx), Math.min(blockSize, rh - by));
            }
          }
        } catch {
          // Fallback: random gray blocks
          for (let bx = 0; bx < rw; bx += blockSize) {
            for (let by = 0; by < rh; by += blockSize) {
              const g = 100 + Math.random() * 100;
              ctx.fillStyle = `rgb(${g},${g},${g})`;
              ctx.fillRect(rx + bx, ry + by, blockSize, blockSize);
            }
          }
        }
        break;
      }
    }
    ctx.restore();
  }

  function drawArrow(ctx, x1, y1, x2, y2, sw) {
    const headLen = sw * 4 + 6;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function drawPreview(ctx, startPt, endPt) {
    ctx.save();
    ctx.strokeStyle = currentColor;
    ctx.fillStyle = currentColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.setLineDash([6, 4]);

    switch (currentTool) {
      case 'circle': {
        const cx = (startPt.x + endPt.x) / 2;
        const cy = (startPt.y + endPt.y) / 2;
        const rx = Math.abs(endPt.x - startPt.x) / 2;
        const ry = Math.abs(endPt.y - startPt.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'rect':
      case 'mosaic': {
        ctx.strokeRect(startPt.x, startPt.y, endPt.x - startPt.x, endPt.y - startPt.y);
        break;
      }
      case 'arrow': {
        ctx.setLineDash([]);
        drawArrow(ctx, startPt.x, startPt.y, endPt.x, endPt.y, strokeWidth);
        break;
      }
    }
    ctx.restore();
  }

  // ── 8. Mouse events ──
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const pt = getCanvasCoords(e);

    // Move tool: resize handle takes priority over hit-test
    if (currentTool === 'move') {
      // 1. Resize handle of currently selected annotation
      const handleId = hitTestHandle(pt.x, pt.y);
      if (handleId && selectedAnnotation) {
        resizeHandle = handleId;
        resizeStartCoords = { ...selectedAnnotation.coords };
        moveStartPct = { x: toPct(pt.x, true), y: toPct(pt.y, false) };
        canvas.style.cursor = HANDLE_CURSORS[handleId] || 'nwse-resize';
        return;
      }
      // 2. Body of an annotation → start drag
      const hit = hitTest(pt.x, pt.y);
      if (hit) {
        selectedAnnotation = hit;
        moveStartPct = { x: toPct(pt.x, true), y: toPct(pt.y, false) };
        canvas.style.cursor = 'grabbing';
      } else {
        // Click empty space → deselect
        selectedAnnotation = null;
      }
      redrawAll();
      return;
    }

    if (currentTool === 'number') {
      stepCounter++;
      annotations.push({
        id: 'a' + Date.now(),
        type: 'number',
        coords: { x: toPct(pt.x, true), y: toPct(pt.y, false) },
        color: currentColor,
        strokeWidth,
        stepNumber: stepCounter,
        label: '',
        purpose: 'both',
        visible: true
      });
      undoStack = [];
      redrawAll();
      return;
    }

    if (currentTool === 'text') {
      // If already editing another text, commit it before opening new one
      if (textInputWrap.style.display === 'block' && textInput.value.trim()) {
        commitTextAnnotation();
      }
      textInputWrap.style.display = 'block';
      textInputWrap.style.left = pt.x + 'px';
      textInputWrap.style.top = pt.y + 'px';
      applyTextInputTheme();
      textInput.style.fontSize = textFontSize + 'px'; // live preview
      textInput.value = '';
      textInput.style.height = '';
      textInput._coords = { x: toPct(pt.x, true), y: toPct(pt.y, false) };
      setTimeout(() => textInput.focus(), 0);
      return;
    }

    isDrawing = true;
    startPoint = pt;
    freehandPoints = [{ x: toPct(pt.x, true), y: toPct(pt.y, false) }];
  });

  canvas.addEventListener('mousemove', (e) => {
    const pt = getCanvasCoords(e);
    _lastMousePt = pt;

    // Move tool: actively resizing
    if (currentTool === 'move' && resizeHandle && selectedAnnotation && resizeStartCoords && moveStartPct) {
      const nowPct = { x: toPct(pt.x, true), y: toPct(pt.y, false) };
      const dxPct = nowPct.x - moveStartPct.x;
      const dyPct = nowPct.y - moveStartPct.y;
      applyResize(selectedAnnotation, resizeHandle, resizeStartCoords, dxPct, dyPct);
      redrawAll();
      return;
    }

    // Move tool: drag selected annotation
    if (currentTool === 'move' && selectedAnnotation && moveStartPct) {
      const nowPct = { x: toPct(pt.x, true), y: toPct(pt.y, false) };
      const dx = nowPct.x - moveStartPct.x;
      const dy = nowPct.y - moveStartPct.y;
      moveAnnotation(selectedAnnotation, dx, dy);
      moveStartPct = nowPct;
      redrawAll();
      return;
    }

    // Move tool: update cursor on hover (handle priority over body)
    if (currentTool === 'move') {
      const handleId = hitTestHandle(pt.x, pt.y);
      if (handleId) { canvas.style.cursor = HANDLE_CURSORS[handleId] || 'nwse-resize'; return; }
      const hit = hitTest(pt.x, pt.y);
      canvas.style.cursor = hit ? 'grab' : 'default';
      return;
    }

    if (!isDrawing || !startPoint) return;

    if (currentTool === 'freehand') {
      freehandPoints.push({ x: toPct(pt.x, true), y: toPct(pt.y, false) });
      redrawAll();
      // Draw current freehand stroke
      const ctx = getCtx();
      ctx.save();
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const pts = freehandPoints;
      ctx.moveTo(fromPct(pts[0].x, true), fromPct(pts[0].y, false));
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(fromPct(pts[i].x, true), fromPct(pts[i].y, false));
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Preview for drag tools
    redrawAll();
    const ctx = getCtx();
    drawPreview(ctx, startPoint, pt);
  });

  canvas.addEventListener('mouseup', (e) => {
    // Move tool: end resize (keep selection so handles stay visible)
    if (currentTool === 'move' && resizeHandle) {
      resizeHandle = null;
      resizeStartCoords = null;
      moveStartPct = null;
      canvas.style.cursor = 'default';
      return;
    }
    // Move tool: end drag (keep selection so handles stay visible for resize)
    if (currentTool === 'move' && selectedAnnotation && moveStartPct) {
      moveStartPct = null;
      canvas.style.cursor = 'grab';
      return;
    }

    if (!isDrawing || !startPoint) return;
    isDrawing = false;
    const endPt = getCanvasCoords(e);

    if (currentTool === 'circle') {
      const cx = (startPoint.x + endPt.x) / 2;
      const cy = (startPoint.y + endPt.y) / 2;
      const rx = Math.abs(endPt.x - startPoint.x) / 2;
      const ry = Math.abs(endPt.y - startPoint.y) / 2;
      if (rx > 3 || ry > 3) {
        annotations.push({
          id: 'a' + Date.now(), type: 'circle',
          coords: { x: toPct(cx, true), y: toPct(cy, false), rx: distToPct(rx, true), ry: distToPct(ry, false) },
          color: currentColor, strokeWidth, purpose: 'both', visible: true
        });
      }
    } else if (currentTool === 'rect') {
      const w = endPt.x - startPoint.x;
      const h = endPt.y - startPoint.y;
      if (Math.abs(w) > 3 || Math.abs(h) > 3) {
        annotations.push({
          id: 'a' + Date.now(), type: 'rect',
          coords: { x: toPct(startPoint.x, true), y: toPct(startPoint.y, false), w: distToPct(w, true), h: distToPct(h, false) },
          color: currentColor, strokeWidth, purpose: 'both', visible: true
        });
      }
    } else if (currentTool === 'arrow') {
      const dx = endPt.x - startPoint.x;
      const dy = endPt.y - startPoint.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        annotations.push({
          id: 'a' + Date.now(), type: 'arrow',
          coords: { x: toPct(startPoint.x, true), y: toPct(startPoint.y, false), x2: toPct(endPt.x, true), y2: toPct(endPt.y, false) },
          color: currentColor, strokeWidth, purpose: 'both', visible: true
        });
      }
    } else if (currentTool === 'freehand') {
      if (freehandPoints.length > 2) {
        annotations.push({
          id: 'a' + Date.now(), type: 'freehand',
          coords: { points: freehandPoints },
          color: currentColor, strokeWidth, purpose: 'both', visible: true
        });
      }
    } else if (currentTool === 'mosaic') {
      const w = endPt.x - startPoint.x;
      const h = endPt.y - startPoint.y;
      if (Math.abs(w) > 5 || Math.abs(h) > 5) {
        annotations.push({
          id: 'a' + Date.now(), type: 'mosaic',
          coords: { x: toPct(startPoint.x, true), y: toPct(startPoint.y, false), w: distToPct(w, true), h: distToPct(h, false) },
          color: '#94a3b8', strokeWidth: 0, purpose: 'display', visible: true
        });
      }
    }

    undoStack = [];
    startPoint = null;
    freehandPoints = [];
    redrawAll();
  });

  // Text input handler — Ctrl+Enter submit, Enter newline, Esc cancel
  // (Writing-mode UX: plain Enter behaves like a normal textarea to allow easy multi-line input)
  textInput.addEventListener('keydown', (e) => {
    // Prevent global shortcuts (1-8, V, Delete) from firing while typing
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitTextAnnotation();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTextInput();
    }
    // Plain Enter falls through → textarea inserts newline natively
  });
  // Don't let keyup bubble either (some hotkey code uses keyup)
  textInput.addEventListener('keyup', (e) => e.stopPropagation());

  // ── 9. Undo / Redo / Clear ──
  function undo() {
    if (annotations.length === 0) return;
    const removed = annotations.pop();
    if (removed.type === 'number') stepCounter--;
    undoStack.push(removed);
    redrawAll();
  }

  function redo() {
    if (undoStack.length === 0) return;
    const restored = undoStack.pop();
    if (restored.type === 'number') stepCounter++;
    annotations.push(restored);
    redrawAll();
  }

  function clearAll() {
    if (annotations.length === 0) return;
    undoStack = [...annotations];
    annotations = [];
    stepCounter = badgeStepCount; // 重置為 badge 基數，不是 0
    redrawAll();
  }

  // Keyboard shortcuts
  overlay.addEventListener('keydown', (e) => {
    if (textInputWrap.style.display === 'block') return; // don't capture when typing
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    if (e.key === 'Escape') { cleanup(); }
    // V key → move tool
    if (e.key === 'v' || e.key === 'V') { selectTool('move'); }
    // Delete/Backspace in move mode — remove selected annotation (fallback to hovered)
    if ((e.key === 'Delete' || e.key === 'Backspace') && currentTool === 'move') {
      let target = selectedAnnotation;
      if (!target && _lastMousePt) target = hitTest(_lastMousePt.x, _lastMousePt.y);
      if (target) {
        const idx = annotations.indexOf(target);
        if (idx >= 0) {
          annotations.splice(idx, 1);
          if (target.type === 'number') stepCounter = annotations.filter(a => a.type === 'number').length;
          if (selectedAnnotation === target) {
            selectedAnnotation = null;
            resizeHandle = null;
            resizeStartCoords = null;
          }
          redrawAll();
        }
      }
    }
    // Tool shortcuts: 1-8 (move, number, circle, rect, arrow, text, freehand, mosaic)
    if (e.key >= '1' && e.key <= '8') {
      selectTool(tools[Number(e.key) - 1].id);
    }
  });
  overlay.tabIndex = 0;
  overlay.focus();

  // ── 10. Confirm / Skip / Cancel ──
  confirmBtn.addEventListener('click', () => {
    finalize(true); // with annotations
  });

  skipBtn.addEventListener('click', () => {
    finalize(false); // without annotations
  });

  cancelBtn.addEventListener('click', () => {
    cleanup();
  });

  function finalize(withAnnotations) {
    // Phase 3A-1: Send CLEAN screenshot + annotations JSON separately.
    // No more merging annotations into pixels (no mergeCanvas).
    // SVG overlay handles all annotation rendering at display time.
    // Read step number and language from toolbar inputs
    const finalStepNum = stepInput ? parseInt(stepInput.value) || (badgeStepCount + 1) : (badgeStepCount + 1);
    const finalLang = langSelect ? langSelect.value : (badgeLang || 'zh-TW');

    safeSendMessage({
      type: 'ANNOTATED_SCREENSHOT',
      screenshot_raw: screenshotDataUrl,  // Always clean, no burned annotations
      annotations: withAnnotations ? annotations : [],
      step_number: finalStepNum,
      lang: finalLang,
      url: window.location.href,
      title: document.title
    });

    cleanup();
    badgeStepCount++;
    updateBadgeCount();
  }

  function cleanup() {
    overlay.remove();
    annotationActive = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// End Phase 2E Annotation System
// ═══════════════════════════════════════════════════════════════════════════════

// Listen for recording state changes from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RECORDING_STATE') {
    isRecording = msg.isRecording;
    toggleBadge(isRecording);
  }
  // Hide/show badge for clean screenshots
  if (msg.type === 'HIDE_BADGE' && badgeEl) {
    badgeEl.style.display = 'none';
  }
  if (msg.type === 'SHOW_BADGE' && badgeEl) {
    badgeEl.style.display = '';
  }
  // Background notifies recording stopped → forward to page
  if (msg.type === 'RECORDING_STOPPED') {
    window.postMessage({
      type: 'FOXLINK_TRAINING_STOPPED',
      sessionId: msg.sessionId,
      totalSteps: msg.totalSteps
    }, '*');
  }
  // Background sends screenshot for annotation mode
  if (msg.type === 'SCREENSHOT_FOR_ANNOTATION') {
    const mode = msg.captureMode || 'full';
    if (mode === 'rect') {
      startRectCropMode(msg.screenshot);
    } else if (mode === 'smart') {
      startSmartCropMode(msg.screenshot);
    } else {
      startAnnotationMode(msg.screenshot);
    }
  }
  // Background relays captured screenshot → forward to page via postMessage
  if (msg.type === 'RELAY_CAPTURE_TO_PAGE') {
    window.postMessage({
      type: 'TRAINING_CAPTURE',
      screenshot: msg.screenshot,
      url: msg.url,
      title: msg.title,
      element: msg.element,
      step_number: msg.step_number
    }, '*');
  }
});

// Listen for commands from FOXLINK GPT training platform page (postMessage)
window.addEventListener('message', (e) => {
  // Training platform tells Extension to start recording
  if (e.data?.type === 'FOXLINK_TRAINING_START') {
    const resumeStepCount = e.data.stepCount || 0;
    console.log('[FOXLINK Training] Received START command, sessionId:', e.data.sessionId, 'stepCount:', resumeStepCount);
    safeSendMessage({ type: 'START_RECORDING', sessionId: e.data.sessionId, stepCount: resumeStepCount }, () => {
      console.log('[FOXLINK Training] Recording started OK');
      isRecording = true;
      badgeStepCount = resumeStepCount; // 從平台繼承步驟數
      toggleBadge(true);
      updateBadgeCount();
    });
  }
  // Training platform tells Extension to stop recording
  if (e.data?.type === 'FOXLINK_TRAINING_STOP') {
    safeSendMessage({ type: 'STOP_RECORDING' }, () => { isRecording = false; toggleBadge(false); });
  }
  // Training platform requests a manual screenshot
  if (e.data?.type === 'TRAINING_REQUEST_CAPTURE') {
    safeSendMessage({ type: 'MANUAL_SCREENSHOT' });
  }
  // Training platform checks if Extension is installed
  if (e.data?.type === 'FOXLINK_TRAINING_PING') {
    window.postMessage({ type: 'FOXLINK_TRAINING_PONG' }, '*');
  }
});

// Check initial state — retry multiple times to handle service worker wake-up
function checkRecordingState() {
  safeSendMessage({ type: 'GET_STATUS' }, (res) => {
    if (res?.isRecording && !isRecording) {
      isRecording = true;
      toggleBadge(true);
      console.log('[FOXLINK Training] Recording state detected, showing badge');
    }
  });
}
checkRecordingState();
setTimeout(checkRecordingState, 500);
setTimeout(checkRecordingState, 1500);
setTimeout(checkRecordingState, 3000);
// Also keep checking every 5 seconds in case recording starts later
setInterval(checkRecordingState, 5000);

// Click listener — only log clicks, do NOT auto-screenshot
// Auto-screenshot on every click produces too many unwanted captures.
// Screenshots are taken via:
//   1. Badge "截圖" button (MANUAL_SCREENSHOT)
//   2. Extension popup "手動截圖" button
//   3. Training platform "截圖" button
// Click events are only recorded as metadata (element info), not triggering screenshots.
document.addEventListener('click', (e) => {
  if (!isRecording) return;

  const el = e.target;
  if (!el || el.closest('#foxlink-training-badge')) return; // ignore badge clicks

  // Only highlight the clicked element — do NOT auto-screenshot
  highlightElement(el);
}, true);

// ── Keyboard shortcut for screenshot ──
// Ctrl+Shift+S → full screenshot with annotation
// Ctrl+Shift+D → full screenshot without annotation (direct upload)
document.addEventListener('keydown', (e) => {
  if (!isRecording) return;
  if (annotationActive) return; // don't trigger while annotation overlay is open

  // Ctrl+Shift+S → screenshot with annotation
  if (e.ctrlKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    e.stopPropagation();
    safeSendMessage({ type: 'MANUAL_SCREENSHOT_WITH_ANNOTATION', lang: badgeLang, captureMode: 'full' });
    return;
  }

  // Ctrl+Shift+D → direct screenshot (no annotation, immediate upload)
  if (e.ctrlKey && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    e.stopPropagation();
    safeSendMessage({ type: 'MANUAL_SCREENSHOT' });
    return;
  }
}, true);

// Navigation listener — log only, no screenshot
let lastUrl = window.location.href;
const navObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    if (isRecording) {
      console.log('[FOXLINK Training] Page navigated to:', window.location.href);
      // Do NOT send USER_ACTION — that triggers unwanted screenshots
    }
  }
});
navObserver.observe(document.body, { childList: true, subtree: true });

// Generate a simple CSS selector for an element
function generateSelector(el) {
  if (!el || el === document.body) return 'body';
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;

  const path = [];
  let current = el;
  while (current && current !== document.body) {
    let s = current.tagName.toLowerCase();
    if (current.id) {
      path.unshift(`#${current.id}`);
      break;
    }
    if (current.classList?.length > 0) {
      s += '.' + [...current.classList].slice(0, 2).join('.');
    }
    // Add nth-child if needed
    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        s += `:nth-child(${idx})`;
      }
    }
    path.unshift(s);
    current = current.parentElement;
  }
  return path.join(' > ');
}

// Visual highlight on clicked element (single highlight, short duration)
let _activeHighlight = null;
function highlightElement(el) {
  if (annotationActive) return; // 標註模式中不顯示
  // Remove previous highlight immediately
  if (_activeHighlight) { _activeHighlight.remove(); _activeHighlight = null; }
  const rect = el.getBoundingClientRect();
  const hl = document.createElement('div');
  hl.style.cssText = `
    position: fixed; z-index: 2147483640; pointer-events: none;
    left: ${rect.x - 2}px; top: ${rect.y - 2}px;
    width: ${rect.width + 4}px; height: ${rect.height + 4}px;
    border: 2px solid rgba(59,130,246,0.5); border-radius: 4px;
    background: rgba(59, 130, 246, 0.05);
    transition: opacity 0.3s;
  `;
  document.body.appendChild(hl);
  _activeHighlight = hl;
  setTimeout(() => {
    hl.style.opacity = '0';
    setTimeout(() => { hl.remove(); if (_activeHighlight === hl) _activeHighlight = null; }, 300);
  }, 600);
}

// Recording badge — floating control on target page
let badgeEl = null;
let badgeStepCount = 0;
let badgeLang = 'zh-TW'; // Phase 3A-2: current screenshot language
function toggleBadge(show) {
  if (show && !badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.id = 'foxlink-training-badge';
    badgeEl.innerHTML = `
      <div id="foxlink-badge-drag" style="display:flex;align-items:center;gap:6px;cursor:grab;">
        <div style="display:flex;align-items:center;gap:4px;">
          <div style="width:8px;height:8px;background:#ef4444;border-radius:50%;animation:pulse 1.5s infinite;"></div>
          <span style="font-size:11px;">錄製中</span>
          <span id="foxlink-badge-count" style="font-size:13px;font-weight:bold;color:#38bdf8;">0</span>
        </div>
        <div id="foxlink-lang-group" style="display:flex;gap:2px;">
          <button class="foxlink-lang-btn" data-lang="zh-TW" style="background:#2563eb;border:none;color:white;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:700;">中</button>
          <button class="foxlink-lang-btn" data-lang="en" style="background:rgba(255,255,255,0.15);border:none;color:#94a3b8;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:700;">EN</button>
          <button class="foxlink-lang-btn" data-lang="vi" style="background:rgba(255,255,255,0.15);border:none;color:#94a3b8;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:700;">VI</button>
        </div>
        <div style="display:flex;gap:0;">
          <button id="foxlink-training-screenshot" data-mode="full" style="background:#2563eb;border:none;color:white;padding:4px 10px;border-radius:6px 0 0 6px;cursor:pointer;font-size:11px;font-weight:600;transition:background 0.2s;" title="全螢幕截圖 (Ctrl+Shift+S)">
            📸 全螢幕
          </button>
          <button id="foxlink-capture-rect" data-mode="rect" style="background:#1d4ed8;border:none;border-left:1px solid rgba(255,255,255,0.2);color:white;padding:4px 8px;cursor:pointer;font-size:11px;font-weight:600;transition:background 0.2s;" title="矩形選取截圖">
            ⬜
          </button>
          <button id="foxlink-capture-smart" data-mode="smart" style="background:#1d4ed8;border:none;border-left:1px solid rgba(255,255,255,0.2);color:white;padding:4px 8px;border-radius:0 6px 6px 0;cursor:pointer;font-size:11px;font-weight:600;transition:background 0.2s;" title="智慧偵測內容區域">
            🎯
          </button>
        </div>
      </div>
    `;
    badgeEl.style.cssText = `
      position: fixed; top: 8px; right: 200px; z-index: 2147483647;
      background: rgba(15, 23, 42, 0.95); color: white;
      padding: 8px 14px; border-radius: 10px; font-size: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      font-family: -apple-system, sans-serif;
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.1);
      user-select: none;
    `;
    document.body.appendChild(badgeEl);

    // Drag support
    let isDragging = false, dragOffX = 0, dragOffY = 0;
    const dragHandle = badgeEl.querySelector('#foxlink-badge-drag');
    dragHandle?.addEventListener('mousedown', (e) => {
      if (e.target.id === 'foxlink-training-screenshot') return; // don't drag when clicking button
      isDragging = true;
      dragOffX = e.clientX - badgeEl.getBoundingClientRect().left;
      dragOffY = e.clientY - badgeEl.getBoundingClientRect().top;
      dragHandle.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !badgeEl) return;
      badgeEl.style.left = (e.clientX - dragOffX) + 'px';
      badgeEl.style.top = (e.clientY - dragOffY) + 'px';
      badgeEl.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      isDragging = false;
      if (dragHandle) dragHandle.style.cursor = 'grab';
    });

    // Phase 3A-2: Language switch buttons
    badgeEl.querySelectorAll('.foxlink-lang-btn').forEach(lb => {
      lb.addEventListener('click', (e) => {
        e.stopPropagation();
        badgeLang = lb.dataset.lang;
        badgeEl.querySelectorAll('.foxlink-lang-btn').forEach(b => {
          const isActive = b.dataset.lang === badgeLang;
          b.style.background = isActive ? '#2563eb' : 'rgba(255,255,255,0.15)';
          b.style.color = isActive ? 'white' : '#94a3b8';
        });
      });
    });

    // Screenshot buttons — 3 modes: full / rect / smart
    const captureWithMode = (mode) => {
      if (annotationActive) return;
      safeSendMessage({ type: 'MANUAL_SCREENSHOT_WITH_ANNOTATION', lang: badgeLang, captureMode: mode });
    };

    const btnFull = badgeEl.querySelector('#foxlink-training-screenshot');
    btnFull?.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); captureWithMode('full'); });

    const btnRect = badgeEl.querySelector('#foxlink-capture-rect');
    btnRect?.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); captureWithMode('rect'); });

    const btnSmart = badgeEl.querySelector('#foxlink-capture-smart');
    btnSmart?.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); captureWithMode('smart'); });
  } else if (!show && badgeEl) {
    badgeEl.remove();
    badgeEl = null;
    // 不重置 badgeStepCount — 繼續錄製時需要保留
  }
}

function updateBadgeCount() {
  const el = document.getElementById('foxlink-badge-count');
  if (el) el.textContent = String(badgeStepCount);
}
