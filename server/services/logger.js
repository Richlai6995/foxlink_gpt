/**
 * Lightweight file logger — no external dependencies.
 * Writes daily log files to <serverRoot>/logs/server-YYYY-MM-DD.log
 * Intercepts console.log / console.warn / console.error so ALL output
 * goes to both the terminal AND the log file automatically.
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ── helpers ──────────────────────────────────────────────────────────

function pad(n) {
    return String(n).padStart(2, '0');
}

function dateTag() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timestamp() {
    return new Date().toISOString();
}

function logFilePath() {
    return path.join(LOG_DIR, `server-${dateTag()}.log`);
}

function appendToFile(line) {
    try {
        fs.appendFileSync(logFilePath(), line + '\n', 'utf8');
    } catch {
        // If we can't write to the log file, silently skip to avoid crash loop
    }
}

// ── core write ───────────────────────────────────────────────────────

function write(level, args) {
    const msg = args
        .map((a) =>
            a instanceof Error
                ? `${a.message}\n${a.stack}`
                : typeof a === 'object'
                    ? JSON.stringify(a, null, 2)
                    : String(a)
        )
        .join(' ');
    const line = `[${timestamp()}] [${level}] ${msg}`;
    appendToFile(line);
}

// ── intercept console ────────────────────────────────────────────────

const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origErr = console.error.bind(console);

console.log = function (...args) {
    _origLog(...args);
    write('INFO', args);
};

console.warn = function (...args) {
    _origWarn(...args);
    write('WARN', args);
};

console.error = function (...args) {
    _origErr(...args);
    write('ERROR', args);
};

// ── process lifecycle logging ────────────────────────────────────────

console.log(`[Logger] ===== Process started (PID: ${process.pid}) =====`);
console.log(`[Logger] Node ${process.version}, platform: ${process.platform}, arch: ${process.arch}`);
console.log(`[Logger] Log directory: ${LOG_DIR}`);

// SIGTERM 由 server.js 的 graceful shutdown 處理（Oracle pool close 後才 exit）
// SIGINT (Ctrl+C) 本地開發快速退出
process.on('SIGINT', () => {
    console.log('[Logger] Received SIGINT — process shutting down');
    process.exit(0);
});

// Log on normal exit
process.on('exit', (code) => {
    const line = `[${timestamp()}] [INFO] [Logger] Process exiting with code ${code}`;
    appendToFile(line);
    _origLog(line);
});

// ── enhanced crash handlers ──────────────────────────────────────────
// These will replace the simple handlers in server.js

process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');

process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    // Give the log a moment to flush, then crash
    setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Rejection:', reason);
});

module.exports = { LOG_DIR };
