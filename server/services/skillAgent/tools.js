// -*- coding: utf-8 -*-
/**
 * tools.js — Skill Agent 三件工具的宣告 + handler。
 *
 * 契約(對齊 generateWithToolsStream,見 gemini.js:1682):
 *   toolHandler(name, args) 必須回傳「字串」— wrapper 會 String() 塞進 functionResponse.response.content。
 *   回物件會變成 '[object Object]',故一律回 string。
 *   handler 內 throw 不會中斷 loop(wrapper 轉成 '[Tool error: ...]'),但本檔仍自行 catch 給乾淨訊息。
 */
const fs = require('fs');
const path = require('path');
const { runInWorkspace, resolvePython } = require('./sandbox');

/** functionDeclarations:flat array of { name, description, parameters(JSON-Schema) }。 */
const functionDeclarations = [
  {
    name: 'write_file',
    description: '寫檔到工作目錄(覆蓋)。用來寫/改投影片產生腳本 deck.py。content 為完整檔案內容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相對工作目錄的檔名,如 "deck.py"' },
        content: { type: 'string', description: '完整檔案內容(會覆蓋既有檔)' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'bash',
    description: '在工作目錄執行 shell 指令並回傳 stdout+stderr。用來跑 `python deck.py`、必要時 `pip install`。逾時 60s 會被強制中止。',
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: '要執行的 shell 指令' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'qa_check',
    description: '對產出的 pptx 跑程式化視覺 QA(文字溢出/金色超用/出界/色塊碰撞),回傳 issue 清單。0 issue 才算過關。',
    parameters: {
      type: 'object',
      properties: {
        pptx: { type: 'string', description: '相對工作目錄的 pptx 檔名,如 "out.pptx"' },
      },
      required: ['pptx'],
    },
  },
];

/** 防 path escape:解析後必須仍在 ws 內。 */
function _safeJoin(ws, rel) {
  const p = path.resolve(ws, rel || '');
  if (p !== ws && !p.startsWith(ws + path.sep)) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return p;
}

/**
 * 綁定到某工作區的 toolHandler。
 * @param {string} ws 工作區絕對路徑
 * @param {(name:string,args:object)=>void} [onTool] 觀測 callback(log 用)
 */
function makeToolHandler(ws, onTool) {
  return async function toolHandler(name, args) {
    if (onTool) { try { onTool(name, args); } catch (_) {} }
    try {
      switch (name) {
        case 'write_file': {
          const dst = _safeJoin(ws, args.path);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.writeFileSync(dst, args.content ?? '', 'utf8');
          return `wrote ${args.path} (${Buffer.byteLength(args.content ?? '', 'utf8')} bytes)`;
        }
        case 'bash': {
          return await runInWorkspace(args.cmd, ws);
        }
        case 'qa_check': {
          _safeJoin(ws, args.pptx); // 驗證路徑在 ws 內
          if (!fs.existsSync(path.resolve(ws, args.pptx))) {
            return `[qa_check] 找不到檔案 ${args.pptx} — 請先跑 deck.py 產生它`;
          }
          return await runInWorkspace(`"${resolvePython()}" slide_qa.py "${args.pptx}"`, ws);
        }
        default:
          return `[unknown tool: ${name}]`;
      }
    } catch (e) {
      return `[Tool error in ${name}: ${e.message}]`;
    }
  };
}

module.exports = { functionDeclarations, makeToolHandler };
