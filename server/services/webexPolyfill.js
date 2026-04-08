'use strict';

/**
 * Browser API polyfill for Webex SDK running in Node.js
 *
 * webex SDK 的 @webex/internal-media-core 依賴大量 browser-only API（window, screen, document 等）。
 * 我們只用 messaging/websocket 功能，但 require() 時整個 SDK 會被載入，
 * 所以需要在 require('webex-node-bot-framework') 之前注入這些 polyfill。
 *
 * 這些 stub 只是讓 import 不報錯，media-core 的功能不會被實際呼叫。
 */

if (typeof window === 'undefined') {
  const loc = {
    href: 'https://localhost',
    protocol: 'https:',
    hostname: 'localhost',
    origin: 'https://localhost',
  };

  global.location = loc;
  global.screen = { width: 1920, height: 1080 };

  global.window = {
    navigator: {
      userAgent: 'node.js',
      mediaDevices: {
        getUserMedia: () => Promise.reject(new Error('not supported')),
        enumerateDevices: () => Promise.resolve([]),
      },
    },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    location: loc,
    screen: global.screen,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    crypto: require('crypto').webcrypto || {},
    btoa: (s) => Buffer.from(s).toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString(),
    MediaStream: class {},
    RTCPeerConnection: class {},
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: clearTimeout,
    performance: { now: () => Date.now() },
    URL,
  };

  global.document = {
    createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {} }),
    addEventListener: () => {},
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    getElementById: () => null,
    querySelectorAll: () => [],
  };

  global.self = global.window;
  try { global.navigator = global.window.navigator; } catch {}
  global.XMLHttpRequest = class { open() {} send() {} };
  global.Blob = class {};
  global.FileReader = class { readAsArrayBuffer() {} addEventListener() {} };
  global.MediaStream = class {};
  global.RTCPeerConnection = class {};
  global.RTCSessionDescription = class {};
  global.AudioContext = class {};
  global.webkitAudioContext = class {};
}
