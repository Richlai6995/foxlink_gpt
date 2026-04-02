// FOXLINK GPT Training Recorder — Background Service Worker

let serverUrl = '';
let serverToken = '';
let currentSessionId = null;
let lastSessionId = null;  // preserved after stop
let stepCounter = 0;
let lastStepCount = 0;
let isRecording = false;
let recentScreenshots = []; // Store thumbnails for popup preview

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
    stepCounter = 0;
    isRecording = true;
    recentScreenshots = [];
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

  if (msg.type === 'MANUAL_SCREENSHOT' && isRecording && currentSessionId) {
    stepCounter++;
    const currentStep = stepCounter;

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
        await fetch(`${serverUrl}/api/training/recording/${currentSessionId}/step`, {
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
      } catch (err) { console.error('[Recorder] Manual screenshot upload failed:', err); }
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

// Restore config on startup
chrome.storage.local.get(['serverUrl', 'serverToken'], (data) => {
  if (data.serverUrl) serverUrl = data.serverUrl;
  if (data.serverToken) serverToken = data.serverToken;
});
