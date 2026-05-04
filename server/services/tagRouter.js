'use strict';
/**
 * TAG-based Auto-Routing Engine
 *
 * Flow:
 * 1. Extract intent tags from user message using Flash LLM
 * 2. Match against tool tags (fuzzy matching)
 * 3. If candidates <= 10, use them directly
 * 4. If candidates > 10, use Flash to refine by description
 * 5. If no TAG match, fallback to description-based intent classification
 */

const MAX_DIRECT_CANDIDATES = 10;

// 全 tag 比對 0 命中時,不要把全部工具丟給 description matcher。
// 工具數一多會出問題:
//   - Flash 對 50+ 工具描述判斷品質掉很快(雜訊干擾)
//   - 即使最後 selected=0,還是會花 5-10s 在 description 比對(浪費 ttft)
//   - 即使 selected 非 0,挑出來的工具常是 false positive,塞給 Gemini 引發
//     MALFORMED_FUNCTION_CALL / UNEXPECTED_TOOL_CALL(model 被太大的 tool catalog 搞混)
// 經驗值:tag 全沒命中通常代表使用者問的是一般性問題,純 chat 比硬撈工具好。
const MAX_FALLBACK_TOOLS = 50;

// ---------------------------------------------------------------------------
// Lazy loaders (avoid circular requires)
// ---------------------------------------------------------------------------
let _generateTextSync, _MODEL_FLASH;
function getGemini() {
  if (!_generateTextSync) {
    const g = require('./gemini');
    _generateTextSync = g.generateTextSync;
    _MODEL_FLASH = g.MODEL_FLASH;
  }
  return { generateTextSync: _generateTextSync, MODEL_FLASH: _MODEL_FLASH };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON object from LLM text output.
 * Handles markdown fences and stray whitespace.
 * @param {string} raw
 * @returns {object|null}
 */
function safeParseJson(raw) {
  if (!raw) return null;
  // Strip markdown code fences if present
  let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract first JSON object
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

/**
 * Normalise a tag for matching: lowercase, trim, collapse whitespace.
 * @param {string} t
 * @returns {string}
 */
function norm(t) {
  return (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Extract intent tags from user message using Flash model.
 * @param {string} userMessage
 * @param {string} recentContext - summary of recent conversation
 * @returns {Promise<string[]>} intent tags (0-5)
 */
async function extractIntentTags(userMessage, recentContext) {
  const { generateTextSync, MODEL_FLASH } = getGemini();

  const contextSection = recentContext
    ? `\n【最近對話紀錄（供上下文參考）】\n${recentContext}\n`
    : '';

  const prompt = `你是意圖標籤提取器。根據使用者訊息，提取 0 到 5 個簡短的主題關鍵字標籤（中文或英文皆可）。
標籤應代表訊息的核心意圖主題，例如：「人資」「請假」「HR」「報表」「IT」「庫存」「ERP」「薪資」等。

規則：
- 只提取與使用者意圖直接相關的主題標籤
- 每個標籤 1~6 個字
- 若訊息是一般閒聊或無法歸類，回傳空陣列
- 若是跟進前一輪對話的回答，也要根據上下文提取標籤
${contextSection}
【使用者訊息】
「${userMessage}」

請只回覆純 JSON，格式：{"tags":["標籤1","標籤2"]} 或 {"tags":[]}`;

  try {
    const { text } = await generateTextSync(MODEL_FLASH, [], prompt);
    const parsed = safeParseJson(text);
    if (parsed && Array.isArray(parsed.tags)) {
      return parsed.tags
        .filter(t => typeof t === 'string' && t.trim())
        .slice(0, 5);
    }
    return [];
  } catch (e) {
    console.warn('[TagRouter] extractIntentTags failed:', e.message);
    return [];
  }
}

/**
 * Match intent tags against tool tags (bidirectional partial, case-insensitive).
 * "人資" matches "HR人資", "HR" matches "HR人資管理", etc.
 * @param {string[]} intentTags - from user message
 * @param {string[]} toolTags  - from tool definition
 * @returns {boolean} whether there's a match
 */
function tagsMatch(intentTags, toolTags) {
  if (!intentTags?.length || !toolTags?.length) return false;

  for (const it of intentTags) {
    const ni = norm(it);
    if (!ni) continue;
    for (const tt of toolTags) {
      const nt = norm(tt);
      if (!nt) continue;
      // Bidirectional partial match
      if (ni.includes(nt) || nt.includes(ni)) return true;
    }
  }
  return false;
}

/**
 * Filter candidates by description using Flash LLM.
 * @param {string} userMessage
 * @param {Array} candidates  - [{name, description, ...}]
 * @param {string} recentContext
 * @returns {Promise<Array>} filtered candidates
 */
async function filterByDescription(userMessage, candidates, recentContext) {
  if (candidates.length === 0) return [];
  const { generateTextSync, MODEL_FLASH } = getGemini();

  const toolList = candidates
    .map(c => `工具名稱: ${c.name}\n適用描述: ${(c.description || '').slice(0, 400)}`)
    .join('\n---\n');

  const contextSection = recentContext
    ? `\n【最近對話紀錄（供上下文參考）】\n${recentContext}\n`
    : '';

  const prompt = `你是工具呼叫意圖分類器，只需判斷哪些工具應被呼叫，不需要回答問題本身。

【工具清單】
${toolList}
${contextSection}
【使用者當前訊息】
「${userMessage}」

【判斷規則（嚴格執行）】
- 使用者問題的核心意圖必須完全符合工具的「適用描述」才能選用
- 若當前訊息是對上一輪 AI 問題的跟進回答（如選擇廠區、補充資訊），且上一輪對話顯示已使用某工具，應繼續使用同一工具
- 問題包含相同關鍵字但核心目的不同時，絕對不選用
- 一般知識問題、聊天、寫作等不需要工具的問題，一律不選任何工具
- **問題詢問的是外部公開資訊（如政府法規、國際政策、時事新聞、市場行情等），而非企業內部流程或資料時，一律不選用任何知識庫工具**
- 不確定時，不選用

請只回覆純 JSON，不要有其他文字，格式：{"call":["工具名稱"]} 或 {"call":[]}`;

  try {
    const { text } = await generateTextSync(MODEL_FLASH, [], prompt);
    const parsed = safeParseJson(text);
    if (!parsed || !Array.isArray(parsed.call)) return [];

    const callSet = new Set(parsed.call);
    const filtered = candidates.filter(c => callSet.has(c.name));
    console.log(`[TagRouter] filterByDescription "${userMessage.slice(0, 60)}" → [${filtered.map(c => c.name).join(',') || 'none'}]`);
    return filtered;
  } catch (e) {
    console.warn('[TagRouter] filterByDescription failed:', e.message);
    return [];
  }
}

/**
 * Main auto-routing function.
 * @param {string}  userMessage
 * @param {string}  recentContext
 * @param {Array}   allTools   - [{id, name, description, tags: string[], type: 'mcp'|'dify'|'selfkb'|'skill'}]
 * @param {object}  [db]       - database instance (unused for now, reserved for future model resolution)
 * @returns {Promise<{ selected: Array, intentTags: string[], method: 'tag'|'tag+description'|'fallback'|'fallback-skipped' }>}
 */
async function autoRouteByTags(userMessage, recentContext, allTools, db) {
  const result = { selected: [], intentTags: [], method: /** @type {'tag'|'tag+description'|'fallback'|'fallback-skipped'} */ ('fallback') };

  if (!allTools?.length) return result;

  // Step 1: Extract intent tags from user message
  const intentTags = await extractIntentTags(userMessage, recentContext);
  result.intentTags = intentTags;
  console.log(`[TagRouter] intentTags: [${intentTags.join(', ')}]`);

  // Step 2: TAG match — filter allTools by tagsMatch
  let candidates = [];
  if (intentTags.length > 0) {
    candidates = allTools.filter(tool => {
      const toolTags = Array.isArray(tool.tags) ? tool.tags : [];
      return toolTags.length > 0 && tagsMatch(intentTags, toolTags);
    });
    console.log(`[TagRouter] TAG match: ${candidates.length} candidates from ${allTools.length} tools`);
  }

  // Step 3: If candidates found, always confirm with description filtering
  if (candidates.length > 0) {
    const refined = await filterByDescription(userMessage, candidates, recentContext);
    // Fallback to TAG candidates if description filter returns nothing
    result.selected = refined.length > 0 ? refined : candidates;
    result.method = 'tag+description';
    console.log(`[TagRouter] TAG+Description refined ${candidates.length} → ${result.selected.length}`);
    return result;
  }

  // Step 5: No TAG match → fallback to description-based on ALL tools
  // 但若工具池過大,直接 degrade 為純 chat(見 MAX_FALLBACK_TOOLS 註解)
  if (allTools.length > MAX_FALLBACK_TOOLS) {
    console.log(`[TagRouter] No TAG match + ${allTools.length} > ${MAX_FALLBACK_TOOLS} tools → skip description fallback (degrade to pure chat)`);
    result.selected = [];
    result.method = 'fallback-skipped';
    return result;
  }
  console.log(`[TagRouter] No TAG match, falling back to description-based on all ${allTools.length} tools`);
  const fallbackResult = await filterByDescription(userMessage, allTools, recentContext);
  result.selected = fallbackResult;
  result.method = 'fallback';
  return result;
}

module.exports = { autoRouteByTags, extractIntentTags, tagsMatch, filterByDescription };
