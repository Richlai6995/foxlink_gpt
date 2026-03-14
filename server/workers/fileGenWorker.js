/**
 * Worker thread entry point for CPU-intensive file generation.
 * Receives { type, filename, content, sessionId } via workerData,
 * calls generateFile directly (isMainThread=false prevents re-spawning),
 * and posts result back to the main thread.
 */
const { workerData, parentPort } = require('worker_threads');

async function run() {
  const { type, filename, content, sessionId } = workerData;
  try {
    // generateFile detects isMainThread=false and runs directly (no recursive spawn)
    const { generateFile } = require('../services/fileGenerator');
    const outputPath = await generateFile(type, filename, content, sessionId);
    parentPort.postMessage({ success: true, outputPath });
  } catch (e) {
    parentPort.postMessage({ success: false, error: e.message, stack: e.stack });
  }
}

run();
