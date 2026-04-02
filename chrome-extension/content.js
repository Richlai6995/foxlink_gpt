// FOXLINK GPT Training Recorder — Content Script (injected into all pages)

// Immediately announce presence to the page
window.postMessage({ type: 'FOXLINK_TRAINING_PONG' }, '*');
console.log('[FOXLINK Training Extension] Content script loaded on', window.location.href);

let isRecording = false;

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
    console.log('[FOXLINK Training] Received START command, sessionId:', e.data.sessionId);
    safeSendMessage({ type: 'START_RECORDING', sessionId: e.data.sessionId }, () => {
      console.log('[FOXLINK Training] Recording started OK');
      isRecording = true;
      toggleBadge(true);
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

// Visual highlight on clicked element
function highlightElement(el) {
  const rect = el.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; z-index: 2147483646; pointer-events: none;
    left: ${rect.x - 2}px; top: ${rect.y - 2}px;
    width: ${rect.width + 4}px; height: ${rect.height + 4}px;
    border: 2px solid #3b82f6; border-radius: 4px;
    background: rgba(59, 130, 246, 0.08);
    transition: opacity 0.5s;
  `;
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 500);
  }, 1500);
}

// Recording badge — floating control on target page
let badgeEl = null;
let badgeStepCount = 0;
function toggleBadge(show) {
  if (show && !badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.id = 'foxlink-training-badge';
    badgeEl.innerHTML = `
      <div id="foxlink-badge-drag" style="display:flex;align-items:center;gap:8px;cursor:grab;">
        <div style="display:flex;align-items:center;gap:4px;">
          <div style="width:8px;height:8px;background:#ef4444;border-radius:50%;animation:pulse 1.5s infinite;"></div>
          <span style="font-size:11px;">錄製中</span>
          <span id="foxlink-badge-count" style="font-size:13px;font-weight:bold;color:#38bdf8;">0</span>
        </div>
        <button id="foxlink-training-screenshot" style="background:#2563eb;border:none;color:white;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:background 0.2s;">
          📸 截圖
        </button>
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

    // Screenshot button
    const btn = badgeEl.querySelector('#foxlink-training-screenshot');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      safeSendMessage({ type: 'MANUAL_SCREENSHOT' }, () => {
        badgeStepCount++;
        updateBadgeCount();
        btn.textContent = '✓ 已截圖';
        btn.style.background = '#059669';
        setTimeout(() => { btn.textContent = '📸 截圖'; btn.style.background = '#2563eb'; }, 800);
      });
    });
    btn?.addEventListener('mouseenter', () => { if (!isDragging) btn.style.background = '#1d4ed8'; });
    btn?.addEventListener('mouseleave', () => { btn.style.background = '#2563eb'; });
  } else if (!show && badgeEl) {
    badgeEl.remove();
    badgeEl = null;
    badgeStepCount = 0;
  }
}

function updateBadgeCount() {
  const el = document.getElementById('foxlink-badge-count');
  if (el) el.textContent = String(badgeStepCount);
}
