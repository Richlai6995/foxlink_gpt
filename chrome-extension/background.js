// FOXLINK GPT Training Recorder — Background Service Worker

let serverUrl = '';
let serverToken = '';
let currentSessionId = null;
let lastSessionId = null;  // preserved after stop
let stepCounter = 0;
let lastStepCount = 0;
let isRecording = false;
let recentScreenshots = []; // Store thumbnails for popup preview
let keepAliveTimer = null;  // Token keep-alive timer

// ── Persist recording state to survive service worker restarts ──
function persistRecordingState() {
  chrome.storage.local.set({
    _isRecording: isRecording,
    _currentSessionId: currentSessionId,
    _stepCounter: stepCounter,
    lastSessionId: lastSessionId || currentSessionId,
    lastStepCount: isRecording ? stepCounter : lastStepCount,
  });
}

// Listen for messages from popup and content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_CONFIG') {
    serverUrl = msg.serverUrl;
    serverToken = msg.token;
    chrome.storage.local.set({ serverUrl, serverToken });
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_STATUS') {
    sendResponse({
      isRecording,
      sessionId: currentSessionId || lastSessionId,
      stepCounter: isRecording ? stepCounter : lastStepCount,
      serverUrl,
      hasToken: !!serverToken,
      recentScreenshots: recentScreenshots.slice(-20)
    });
  }

  if (msg.type === 'START_RECORDING') {
    currentSessionId = msg.sessionId;
    lastSessionId = msg.sessionId;
    stepCounter = 0;
    isRecording = true;
    recentScreenshots = [];
    persistRecordingState();
    startKeepAlive();
    updateBadge();
    // Notify all tabs
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STATE', isRecording: true }).catch(() => {});
      });
    });
    sendResponse({ ok: true });
  }

  if (msg.type === 'STOP_RECORDING') {
    const sid = currentSessionId;
    lastSessionId = sid;
    lastStepCount = stepCounter;
    isRecording = false;
    currentSessionId = null;
    stopKeepAlive();
    persistRecordingState();
    updateBadge();
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STATE', isRecording: false }).catch(() => {});
      });
    });
    // Notify training platform page that recording stopped (with session ID for pulling)
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'RECORDING_STOPPED',
          sessionId: sid,
          totalSteps: stepCounter
        }).catch(() => {});
      });
    });
    sendResponse({ ok: true, sessionId: sid, totalSteps: stepCounter });
  }

  if (msg.type === 'USER_ACTION' && isRecording && currentSessionId) {
    stepCounter++;
    const currentStep = stepCounter;
    persistRecordingState();
    console.log(`[Recorder] Action: ${msg.action}, step ${currentStep}, uploading to ${serverUrl}`);
    // Capture screenshot of the active tab
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, async (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('[Recorder] Screenshot failed:', chrome.runtime.lastError.message);
        return;
      }
      console.log(`[Recorder] Screenshot captured, size: ${dataUrl.length} bytes`);

      // Create thumbnail for popup preview
      createThumbnail(dataUrl, (thumbUrl) => {
        recentScreenshots.push({
          step: currentStep,
          thumbnail: thumbUrl,
          action: msg.action || 'click',
          title: msg.title || '',
          timestamp: Date.now()
        });
        updateBadge();
      });

      // Upload to server
      try {
        const response = await fetch(`${serverUrl}/api/training/recording/${currentSessionId}/step`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serverToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            step_number: currentStep,
            action_type: msg.action || 'click',
            screenshot_base64: dataUrl,
            element_info: msg.element || null,
            viewport: msg.viewport || null,
            page_url: msg.url || '',
            page_title: msg.title || ''
          })
        });
        const result = await response.json();
        console.log(`[Recorder] Step ${currentStep} uploaded OK:`, result.step_id || result);
      } catch (err) {
        console.error(`[Recorder] Upload FAILED for step ${currentStep}:`, err.message, `URL: ${serverUrl}/api/training/recording/${currentSessionId}/step`);
      }
    });
    sendResponse({ ok: true, step: currentStep });
  }

  // ── Phase 2E: Screenshot with annotation mode ──
  // Captures screenshot, sends it back to content script for annotation overlay
  // Debounce: prevent double-trigger within 2 seconds
  if (msg.type === 'MANUAL_SCREENSHOT_WITH_ANNOTATION' && isRecording && currentSessionId) {
    if (Date.now() - (globalThis._lastAnnotationCapture || 0) < 2000) { sendResponse({ ok: true }); return true; }
    globalThis._lastAnnotationCapture = Date.now();
    console.log(`[Recorder] MANUAL_SCREENSHOT_WITH_ANNOTATION — capturing for annotation`);
    const activeTab = sender?.tab?.id;
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab, { type: 'HIDE_BADGE' }).catch(() => {});
    }
    setTimeout(() => {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (activeTab) {
          chrome.tabs.sendMessage(activeTab, { type: 'SHOW_BADGE' }).catch(() => {});
        }
        if (chrome.runtime.lastError) return;
        // Send screenshot back to content script for annotation overlay
        if (activeTab) {
          chrome.tabs.sendMessage(activeTab, {
            type: 'SCREENSHOT_FOR_ANNOTATION',
            screenshot: dataUrl,
            captureMode: msg.captureMode || 'full'
          }).catch(() => {});
        }
      });
    }, 150);
    sendResponse({ ok: true });
  }

  // ── Phase 2E: Annotated screenshot upload ──
  // Content script finalized annotation → upload raw + annotated + annotations JSON
  // Phase 3A-1: Only upload CLEAN screenshot + annotations JSON (no burned image)
  if (msg.type === 'ANNOTATED_SCREENSHOT' && isRecording && currentSessionId) {
    // Debounce: prevent duplicate upload within 2 seconds
    if (Date.now() - (globalThis._lastAnnotatedUpload || 0) < 2000) { sendResponse({ ok: true }); return true; }
    globalThis._lastAnnotatedUpload = Date.now();
    stepCounter++;
    const currentStep = stepCounter;
    persistRecordingState();
    console.log(`[Recorder] ANNOTATED_SCREENSHOT step ${currentStep}, annotations: ${(msg.annotations || []).length}`);

    createThumbnail(msg.screenshot_raw, (thumbUrl) => {
      recentScreenshots.push({
        step: currentStep,
        thumbnail: thumbUrl,
        action: 'annotated',
        title: msg.title || 'Annotated screenshot',
        timestamp: Date.now(),
        annotationCount: (msg.annotations || []).length
      });
      updateBadge();
    });

    (async () => {
      try {
        const uploadUrl = `${serverUrl}/api/training/recording/${currentSessionId}/step`;
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serverToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step_number: msg.step_number || currentStep,
            action_type: 'screenshot',
            screenshot_base64: msg.screenshot_raw,  // Always clean
            annotations_json: JSON.stringify(msg.annotations || []),
            lang: msg.lang || 'zh-TW',
            page_url: msg.url || '',
            page_title: msg.title || ''
          })
        });
        if (uploadRes.status === 401) {
          await tryRelogin();
          const retryRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${serverToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step_number: msg.step_number || currentStep, action_type: 'screenshot',
              screenshot_base64: msg.screenshot_raw,
              annotations_json: JSON.stringify(msg.annotations || []),
              lang: msg.lang || 'zh-TW',
              page_url: msg.url || '', page_title: msg.title || ''
            })
          });
          if (retryRes.ok) console.log(`[Recorder] Retry annotated step ${currentStep} OK`);
          else console.error(`[Recorder] Retry failed: ${retryRes.status}`);
        } else if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          console.error(`[Recorder] Upload HTTP ${uploadRes.status}:`, errText.slice(0, 200));
        } else {
          const result = await uploadRes.json();
          console.log(`[Recorder] Annotated step ${currentStep} uploaded OK:`, result);
        }
      } catch (err) { console.error('[Recorder] Annotated screenshot upload failed:', err.message); }
    })();
    sendResponse({ ok: true, step: currentStep });
  }

  // ── Legacy: MANUAL_SCREENSHOT without annotation (from popup or platform) ──
  if (msg.type === 'MANUAL_SCREENSHOT' && isRecording && currentSessionId) {
    stepCounter++;
    const currentStep = stepCounter;
    persistRecordingState();
    console.log(`[Recorder] MANUAL_SCREENSHOT step ${currentStep}, serverUrl="${serverUrl}", hasToken=${!!serverToken}, sessionId=${currentSessionId}`);

    // Hide badge before screenshot, capture, then restore
    const activeTab = sender?.tab?.id;
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab, { type: 'HIDE_BADGE' }).catch(() => {});
    }
    // Small delay to ensure badge is hidden before capture
    setTimeout(() => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, async (dataUrl) => {
      // Restore badge after capture
      if (activeTab) {
        chrome.tabs.sendMessage(activeTab, { type: 'SHOW_BADGE' }).catch(() => {});
      }
      if (chrome.runtime.lastError) return;

      createThumbnail(dataUrl, (thumbUrl) => {
        recentScreenshots.push({
          step: currentStep,
          thumbnail: thumbUrl,
          action: 'manual',
          title: 'Manual screenshot',
          timestamp: Date.now()
        });
        updateBadge();
      });

      try {
        const uploadUrl = `${serverUrl}/api/training/recording/${currentSessionId}/step`;
        console.log(`[Recorder] Uploading to: ${uploadUrl}`);
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serverToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step_number: currentStep,
            action_type: 'screenshot',
            screenshot_base64: dataUrl,
            page_url: sender.tab?.url || '',
            page_title: sender.tab?.title || ''
          })
        });
        if (uploadRes.status === 401) {
          console.warn('[Recorder] Token expired, attempting re-login...');
          await tryRelogin();
          // Retry upload with new token
          const retryRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${serverToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ step_number: currentStep, action_type: 'screenshot', screenshot_base64: dataUrl, page_url: sender.tab?.url || '', page_title: sender.tab?.title || '' })
          });
          if (retryRes.ok) { const r = await retryRes.json(); console.log(`[Recorder] Retry step ${currentStep} OK:`, r); }
          else console.error(`[Recorder] Retry failed: ${retryRes.status}`);
        } else if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          console.error(`[Recorder] Upload HTTP ${uploadRes.status}:`, errText.slice(0, 200));
        } else {
          const result = await uploadRes.json();
          console.log(`[Recorder] Manual step ${currentStep} uploaded OK:`, result);
        }
      } catch (err) { console.error('[Recorder] Manual screenshot upload failed:', err.message); }
    });
    }, 150); // delay for badge hide
    sendResponse({ ok: true });
  }

  if (msg.type === 'CLEAR_SCREENSHOTS') {
    recentScreenshots = [];
    stepCounter = 0;
    updateBadge();
    sendResponse({ ok: true });
  }

  return true; // async sendResponse
});

// ── Chrome Commands (keyboard shortcuts from manifest) ──
chrome.commands.onCommand.addListener((command) => {
  if (!isRecording || !currentSessionId) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    if (command === 'take-screenshot') {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'HIDE_BADGE' }).catch(() => {});
      setTimeout(() => {
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'SHOW_BADGE' }).catch(() => {});
          if (chrome.runtime.lastError || !dataUrl) return;
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SCREENSHOT_FOR_ANNOTATION',
            screenshot: dataUrl,
            captureMode: 'full'
          }).catch(() => {});
        });
      }, 150);
    } else if (command === 'take-screenshot-direct') {
      // Direct upload without annotation
      chrome.tabs.sendMessage(tabs[0].id, { type: 'MANUAL_SCREENSHOT' }).catch(() => {});
    }
  });
});

// Update badge with step count
function updateBadge() {
  if (isRecording) {
    chrome.action.setBadgeText({ text: stepCounter > 0 ? String(stepCounter) : '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Create thumbnail using OffscreenCanvas
function createThumbnail(dataUrl, callback) {
  // In service worker we can't use DOM canvas, store a truncated version
  // Just store first 200 chars as identifier + step info (popup will show from server)
  callback(dataUrl.slice(0, 100)); // placeholder — popup will fetch from server
}

// Auto re-login when token expired
async function tryRelogin() {
  const data = await chrome.storage.local.get(['serverUrl', 'savedPassword', 'username']);
  if (!data.serverUrl || !data.username || !data.savedPassword) return;
  try {
    const res = await fetch(`${data.serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: data.username, password: data.savedPassword })
    });
    if (!res.ok) return;
    const result = await res.json();
    serverToken = result.token;
    chrome.storage.local.set({ serverToken: result.token });
    console.log('[Recorder] Auto re-login OK');
  } catch (e) { console.error('[Recorder] Auto re-login failed:', e.message); }
}

// Restore config + recording state on startup (survives service worker restart)
chrome.storage.local.get([
  'serverUrl', 'serverToken', 'lastSessionId', 'lastStepCount',
  '_isRecording', '_currentSessionId', '_stepCounter'
], (data) => {
  if (data.serverUrl) serverUrl = data.serverUrl;
  if (data.serverToken) serverToken = data.serverToken;
  if (data.lastSessionId) lastSessionId = data.lastSessionId;
  if (data.lastStepCount) lastStepCount = data.lastStepCount;

  // Restore active recording session
  if (data._isRecording && data._currentSessionId) {
    isRecording = true;
    currentSessionId = data._currentSessionId;
    stepCounter = data._stepCounter || 0;
    lastSessionId = data._currentSessionId;
    updateBadge();
    startKeepAlive();
    console.log(`[Recorder] Restored recording session: ${currentSessionId}, step ${stepCounter}`);
  }
});

// ── Token keep-alive: prevent server token expiry during long recording ──
// Sends a lightweight API call every 10 minutes to trigger sliding expiration
function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(async () => {
    if (!serverUrl || !serverToken) return;
    try {
      const res = await fetch(`${serverUrl}/api/auth/user-info`, {
        headers: { 'Authorization': `Bearer ${serverToken}` }
      });
      if (res.status === 401) {
        console.warn('[Recorder] Keep-alive: token expired, attempting re-login...');
        await tryRelogin();
      } else {
        console.log('[Recorder] Keep-alive OK');
      }
    } catch (e) {
      console.warn('[Recorder] Keep-alive failed:', e.message);
    }
  }, 10 * 60 * 1000); // every 10 minutes
}

function stopKeepAlive() {
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

// ── Keep service worker alive during recording ──
// Chrome MV3 kills service workers after ~30s idle. Use chrome.alarms as a heartbeat.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'recording-keepalive') {
    // Just waking up the service worker is enough — the alarm handler runs in SW context
    console.log('[Recorder] Alarm keepalive tick, isRecording:', isRecording);
    if (!isRecording) {
      chrome.alarms.clear('recording-keepalive');
    }
  }
});

// Start/stop the alarm-based keepalive alongside recording
const _origStartKeepAlive = startKeepAlive;
startKeepAlive = function() {
  _origStartKeepAlive();
  // Create a periodic alarm to keep SW alive (minimum interval: 0.5 min in MV3)
  chrome.alarms.create('recording-keepalive', { periodInMinutes: 0.5 });
};
const _origStopKeepAlive = stopKeepAlive;
stopKeepAlive = function() {
  _origStopKeepAlive();
  chrome.alarms.clear('recording-keepalive');
};
