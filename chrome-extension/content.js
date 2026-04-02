// FOXLINK GPT Training Recorder — Content Script (injected into all pages)

// Immediately announce presence to the page
window.postMessage({ type: 'FOXLINK_TRAINING_PONG' }, '*');
console.log('[FOXLINK Training Extension] Content script loaded on', window.location.href);

let isRecording = false;

// Listen for recording state changes from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RECORDING_STATE') {
    isRecording = msg.isRecording;
    toggleBadge(isRecording);
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
    chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      sessionId: e.data.sessionId
    }, () => {
      isRecording = true;
      toggleBadge(true);
    });
  }
  // Training platform tells Extension to stop recording
  if (e.data?.type === 'FOXLINK_TRAINING_STOP') {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => {
      isRecording = false;
      toggleBadge(false);
    });
  }
  // Training platform requests a manual screenshot
  if (e.data?.type === 'TRAINING_REQUEST_CAPTURE') {
    chrome.runtime.sendMessage({ type: 'MANUAL_SCREENSHOT' });
  }
  // Training platform checks if Extension is installed
  if (e.data?.type === 'FOXLINK_TRAINING_PING') {
    window.postMessage({ type: 'FOXLINK_TRAINING_PONG' }, '*');
  }
});

// Check initial state
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (res?.isRecording) {
    isRecording = true;
    toggleBadge(true);
  }
});

// Click listener
document.addEventListener('click', (e) => {
  if (!isRecording) return;
  console.log('[FOXLINK Training] Click detected, sending to background...');

  const el = e.target;
  if (!el || el.closest('#foxlink-training-badge')) return; // ignore badge clicks

  const rect = el.getBoundingClientRect();

  chrome.runtime.sendMessage({
    type: 'USER_ACTION',
    action: 'click',
    element: {
      tag: el.tagName?.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 100),
      id: el.id || null,
      className: (el.className?.toString?.() || '').slice(0, 200),
      selector: generateSelector(el),
      role: el.getAttribute?.('role') || null,
      type: el.type || null,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      }
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: window.location.href,
    title: document.title
  });

  highlightElement(el);
}, true);

// Input listener (don't capture actual values for security)
document.addEventListener('change', (e) => {
  if (!isRecording) return;
  const el = e.target;
  chrome.runtime.sendMessage({
    type: 'USER_ACTION',
    action: 'input',
    element: {
      tag: el.tagName?.toLowerCase(),
      selector: generateSelector(el),
      type: el.type || null,
      hasValue: !!el.value
    },
    url: window.location.href,
    title: document.title
  });
}, true);

// Navigation listener
let lastUrl = window.location.href;
const navObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    if (isRecording) {
      chrome.runtime.sendMessage({
        type: 'USER_ACTION',
        action: 'navigate',
        element: null,
        url: window.location.href,
        title: document.title
      });
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

// Recording badge
let badgeEl = null;
function toggleBadge(show) {
  if (show && !badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.id = 'foxlink-training-badge';
    badgeEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="width:8px;height:8px;background:#ef4444;border-radius:50%;animation:pulse 1.5s infinite;"></div>
        <span>錄製中</span>
        <button id="foxlink-training-screenshot" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;">📸 截圖</button>
      </div>
    `;
    badgeEl.style.cssText = `
      position: fixed; top: 8px; right: 8px; z-index: 2147483647;
      background: rgba(30, 41, 59, 0.95); color: white;
      padding: 6px 12px; border-radius: 8px; font-size: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: -apple-system, sans-serif;
    `;
    document.body.appendChild(badgeEl);

    // Manual screenshot button
    badgeEl.querySelector('#foxlink-training-screenshot')?.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('[FOXLINK Training] Manual screenshot button clicked');
      chrome.runtime.sendMessage({ type: 'MANUAL_SCREENSHOT' });
    });
  } else if (!show && badgeEl) {
    badgeEl.remove();
    badgeEl = null;
  }
}
