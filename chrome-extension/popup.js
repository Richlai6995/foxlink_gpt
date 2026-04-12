const $ = (id) => document.getElementById(id);

let isLoggedIn = false;
let pollInterval = null;

// Load saved config + auto-login
chrome.storage.local.get(['serverUrl', 'serverToken', 'username', 'savedPassword'], (data) => {
  if (data.serverUrl) $('serverUrl').value = data.serverUrl;
  if (data.username) $('username').value = data.username;
  if (data.serverToken) {
    isLoggedIn = true;
    showRecordingUI();
    // Verify token is still valid, auto-re-login if expired
    verifyOrRelogin(data);
  } else if (data.savedPassword && data.serverUrl && data.username) {
    // Has saved credentials but no token → auto-login
    autoLogin(data.serverUrl, data.username, data.savedPassword);
  }
  refreshStatus();
  setTimeout(refreshStatus, 300);
  setTimeout(refreshStatus, 800);
});

async function verifyOrRelogin(data) {
  try {
    const res = await fetch(`${data.serverUrl}/api/auth/user-info`, {
      headers: { 'Authorization': `Bearer ${data.serverToken}` }
    });
    if (res.status === 401 && data.savedPassword) {
      console.log('[Popup] Token expired, auto re-login...');
      await autoLogin(data.serverUrl, data.username, data.savedPassword);
    }
  } catch {}
}

async function autoLogin(serverUrl, username, password) {
  try {
    const apiBase = serverUrl.replace(/\/$/, '');
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) return;
    const data = await res.json();
    chrome.storage.local.set({ serverUrl: apiBase, serverToken: data.token, username });
    chrome.runtime.sendMessage({ type: 'SET_CONFIG', serverUrl: apiBase, token: data.token });
    isLoggedIn = true;
    showRecordingUI();
    updateStatus('connected', `已連線: ${username}`);
    console.log('[Popup] Auto-login OK');
  } catch (e) { console.warn('[Popup] Auto-login failed:', e.message); }
}

// Login
$('loginBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.trim();
  const username = $('username').value.trim();
  const password = $('password').value;

  if (!serverUrl || !username || !password) return alert('請填寫所有欄位');

  $('loginBtn').disabled = true;
  $('loginBtn').textContent = '連線中...';

  try {
    const apiBase = serverUrl.replace(/\/$/, '');
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const token = data.token;

    chrome.storage.local.set({ serverUrl: apiBase, serverToken: token, username, savedPassword: password });
    chrome.runtime.sendMessage({ type: 'SET_CONFIG', serverUrl: apiBase, token });

    isLoggedIn = true;
    showRecordingUI();
    updateStatus('connected', `已連線: ${username}`);
  } catch (e) {
    alert('登入失敗: ' + e.message);
  } finally {
    $('loginBtn').disabled = false;
    $('loginBtn').textContent = '登入連線';
  }
});

// Start recording
$('startBtn').addEventListener('click', () => {
  const sessionId = $('sessionId').value.trim();
  if (!sessionId) return alert('請輸入 Session ID（從訓練平台取得）');

  const startStep = parseInt($('startStep').value) || 0;
  const startMarker = parseInt($('startMarker').value) || 0;

  chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    sessionId,
    stepCount: startStep,
    markerStart: startMarker
  }, () => {
    showRecordingState(true);
  });
});

// Stop recording
$('stopBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (res) => {
    showRecordingState(false);
    if (res?.totalSteps > 0) {
      updateStatus('connected', `錄製完成: ${res.totalSteps} 張截圖`);
    }
  });
});

// 錄製中即時調整起始值 → 同步到 background + content
$('startStep').addEventListener('change', () => {
  const v = parseInt($('startStep').value) || 0;
  chrome.runtime.sendMessage({ type: 'SET_STEP_OFFSET', stepCount: v });
});
$('startMarker').addEventListener('change', () => {
  const v = parseInt($('startMarker').value) || 0;
  // 傳給所有 tab 的 content.js 更新 markerBase
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'SET_MARKER_BASE', markerStart: v }).catch(() => {});
    });
  });
});

// Manual screenshot
$('screenshotBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'MANUAL_SCREENSHOT' });
  // Refresh after a short delay
  setTimeout(refreshStatus, 500);
});

// Copy Session ID
$('copySessionBtn').addEventListener('click', () => {
  const sid = $('sessionId').value;
  if (sid) {
    navigator.clipboard.writeText(sid);
    $('copySessionBtn').textContent = '✓';
    setTimeout(() => { $('copySessionBtn').textContent = '📋'; }, 1000);
  }
});

// Force stop — always works regardless of state
$('forceStopBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  chrome.runtime.sendMessage({ type: 'CLEAR_SCREENSHOTS' });
  showRecordingState(false);
  updateStatus('connected', '已強制停止');
  $('stepCount').textContent = '0';
  $('screenshotList').innerHTML = '';
});

// Clear screenshots
$('clearBtn').addEventListener('click', () => {
  if (!confirm('確定要清除所有截圖紀錄？')) return;
  chrome.runtime.sendMessage({ type: 'CLEAR_SCREENSHOTS' }, () => {
    $('screenshotList').innerHTML = '';
    $('stepCount').textContent = '0';
    refreshStatus();
  });
});

// Logout
$('logoutBtn').addEventListener('click', () => {
  chrome.storage.local.remove(['serverToken', 'savedPassword']);
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  isLoggedIn = false;
  showLoginUI();
  updateStatus('disconnected', '已登出（密碼已清除）');
  stopPolling();
});

function showRecordingUI() {
  $('login-section').style.display = 'none';
  $('recording-section').style.display = 'block';
}

function showLoginUI() {
  $('login-section').style.display = 'block';
  $('recording-section').style.display = 'none';
}

function showRecordingState(isRec) {
  $('startBtn').disabled = isRec;
  $('stopBtn').disabled = !isRec;
  $('screenshotBtn').disabled = !isRec;
  $('recording-counter').style.display = isRec ? 'block' : 'none';
  $('manual-start').style.display = isRec ? 'none' : 'block';

  if (isRec) {
    updateStatus('recording', '🔴 錄製中 — 在目標系統操作');
    startPolling();
  } else {
    updateStatus('connected', '已連線');
    stopPolling();
  }
}

function updateStatus(type, text) {
  const bar = $('status-bar');
  bar.className = `status status-${type}`;
  bar.textContent = text;
}

function startPolling() {
  stopPolling();
  pollInterval = setInterval(refreshStatus, 1000);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function refreshStatus() {
  try {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn('GET_STATUS error:', chrome.runtime.lastError.message);
        return;
      }
      if (!res) return;

      if (res.isRecording) {
        showRecordingState(true);
        updateStatus('recording', `🔴 錄製中 — ${res.stepCounter} 張截圖`);
        $('stepCount').textContent = res.stepCounter;
        if (res.sessionId) $('sessionId').value = res.sessionId;
        renderScreenshotList(res.recentScreenshots || []);
    } else if (res.hasToken) {
      updateStatus('connected', res.stepCounter > 0 ? `已連線 — 上次錄製 ${res.stepCounter} 張` : '已連線');
    }
    });
  } catch (e) { console.error('refreshStatus failed:', e); }
}

function renderScreenshotList(screenshots) {
  const container = $('screenshotList');
  if (!container) return;

  // Only re-render if count changed
  if (container.childElementCount === screenshots.length) return;

  container.innerHTML = '';
  screenshots.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'screenshot-item';
    const timeStr = new Date(s.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `
      <span class="num">#${s.step}</span>
      <span class="action">${s.action}</span>
      <span class="title">${s.title || '截圖'}</span>
      <span class="time">${timeStr}</span>
    `;
    container.appendChild(div);
  });
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}
