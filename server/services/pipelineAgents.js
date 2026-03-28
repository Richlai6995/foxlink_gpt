'use strict';
/**
 * Pipeline Agents — Specialized Flash LLM agents for each stage
 *
 * P0 runPptxLayoutEngine      — content fitting, overflow split, layout selection
 * P1 validateAndFixSchema      — JSON schema check + Flash auto-fix
 * P2 extractTemplateValues     — Flash fallback extractor when Pro output is missing/malformed
 * P3 planDynamicTask           — Flash task decomposer → pipelineRunner-compatible nodes[]
 */

const { generateTextSync, MODEL_FLASH } = require('./gemini');

// ─── Shared helpers ────────────────────────────────────────────────────────────

function safeParseJson(raw) {
  if (!raw) return null;
  let s = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const arr = s.match(/\[[\s\S]*\]/);
  if (arr) try { return JSON.parse(arr[0]); } catch {}
  const obj = s.match(/\{[\s\S]*\}/);
  if (obj) try { return JSON.parse(obj[0]); } catch {}
  return null;
}

// ─── P0: PPTX Layout Engine ────────────────────────────────────────────────────

/**
 * Post-processes slides[] from AI output to fit template constraints:
 * - Splits slides exceeding MAX_BULLETS into multiple slides
 * - Compresses bullet points > MAX_CHARS characters
 * - Promotes 3-item parallel content to 3col layout when available
 *
 * @param {object} inputData    - parsed template_values JSON (contains .slides[])
 * @param {object} schema       - template schema (has pptx_settings.slide_config)
 * @returns {object}            - updated inputData with fitted slides[]
 */
async function runPptxLayoutEngine(inputData, schema) {
  const slideConfig = schema.pptx_settings?.slide_config || [];
  if (!slideConfig.some(c => c.type === 'layout_template')) return inputData;

  const slidesVar = schema.variables?.find(v => v.key === 'slides');
  const rawSlides = inputData.slides || [];
  if (!rawSlides.length || !slidesVar) return inputData;

  const layoutOpts = slidesVar.children?.find(c => c.key === 'type')?.options || ['bullets'];
  const has3col    = layoutOpts.includes('3col');
  const MAX_BULLETS  = 6;
  const MAX_CHARS    = 30;

  const prompt = `你是 PPTX 投影片排版引擎，職責是調整投影片內容使其符合版面限制。

【版面規則】
1. "bullets" 版型：每張 slide_content 最多 ${MAX_BULLETS} 條，超出必須拆分成新投影片
2. 每條重點 ≤ ${MAX_CHARS} 字（中文），過長請壓縮核心意思
3. slide_title 每張必須有，拆分後的續頁加括號說明如「標題（續）」
${has3col ? `4. "3col" 版型：適合 3 個平行比較項目（方案/優劣/比較）
5. 若 bullets 投影片的 slide_content 正好是 3 個平行項目，自動改用 3col 版型（每欄 col*_content 同樣用 \\n 分隔）` : '4. 只有 bullets 版型可用'}
6. 各投影片重點總量平均分配，避免一張過密一張過空

【輸入 slides（需要修正）】
${JSON.stringify(rawSlides, null, 2)}

【輸出規則】
- 只回傳修正後的 slides JSON 陣列
- 每個元素必須有 "type"、"slide_title" 和 "slide_content"（slide_content 用 \\n 分隔各條重點）
- slide_content 必須完整保留原始資訊，只做格式調整（壓縮過長句子、拆分過多重點），不可刪除內容
- slide_title 不可帶序號（如 "1. "、"2. "），若原始標題已帶序號必須移除，只保留標題本身
- 若有「參考來源」「參考文獻」「References」等僅含 URL 連結的投影片，直接刪除（不要輸出該 slide）
- 不加說明文字，不加 markdown，直接輸出 JSON 陣列`;

  try {
    const { text } = await generateTextSync(MODEL_FLASH, [], prompt);
    const fitted = safeParseJson(text);
    if (!Array.isArray(fitted) || fitted.length === 0) {
      console.warn('[P0:LayoutEngine] 非陣列回傳，保留原始 slides');
      return inputData;
    }
    console.log(`[P0:LayoutEngine] ${rawSlides.length} slides → ${fitted.length} slides`);
    // Hard filter: remove Google Search grounding reference slides
    const cleaned = fitted.filter(s => {
      const t = (s.slide_title || '').toLowerCase();
      const c = (s.slide_content || '').toLowerCase();
      if ((t.includes('參考來源') || t.includes('參考文獻') || t.includes('references'))
          && (c.includes('vertexaisearch') || c.includes('http') || c.includes('.google.'))) {
        console.log(`[P0:LayoutEngine] Filtered reference slide: "${s.slide_title}"`);
        return false;
      }
      return true;
    });
    // Diagnostic: log whether slide_content is present in each fitted slide
    cleaned.forEach((s, i) => {
      const hasContent = !!(s.slide_content && s.slide_content.trim());
      console.log(`[P0:LayoutEngine]   slide[${i}] type=${s.type} title="${(s.slide_title||'').slice(0,30)}" hasContent=${hasContent} contentLen=${(s.slide_content||'').length}`);
    });
    return { ...inputData, slides: cleaned };
  } catch (e) {
    console.warn('[P0:LayoutEngine] failed (non-fatal):', e.message);
    return inputData;
  }
}

// ─── P1: Schema Validator + Auto-fix ──────────────────────────────────────────

/**
 * Validate inputData against schema. If errors found, Flash attempts auto-fix.
 * Always returns an inputData object (original if fix fails).
 */
async function validateAndFixSchema(inputData, schema) {
  const errors = _checkSchemaErrors(inputData, schema);
  if (errors.length === 0) return inputData;

  console.log(`[P1:Validator] ${errors.length} schema errors, attempting Flash fix: ${errors.slice(0, 3).join(' | ')}`);

  const schemaDesc = (schema.variables || []).map(v => {
    if (v.type === 'loop') {
      return `${v.key}: loop 陣列, 子欄位 [${(v.children || []).map(c => `${c.key}(${c.type}${c.required ? ',必填' : ''})`).join(', ')}]`;
    }
    return `${v.key}: ${v.type}${v.required ? ' 必填' : ''}`;
  }).join('\n');

  const prompt = `修正以下 JSON 使其符合範本 schema。只輸出修正後的 JSON，不加說明。

【發現的錯誤】
${errors.join('\n')}

【Schema 定義】
${schemaDesc}

【當前 JSON（有問題）】
${JSON.stringify(inputData, null, 2)}`;

  try {
    const { text } = await generateTextSync(MODEL_FLASH, [], prompt);
    const fixed = safeParseJson(text);
    if (fixed && typeof fixed === 'object' && !Array.isArray(fixed)) {
      console.log('[P1:Validator] Auto-fix OK');
      return fixed;
    }
  } catch (e) {
    console.warn('[P1:Validator] Auto-fix failed:', e.message);
  }
  return inputData;
}

/** Rule-based schema error checker — no AI call */
function _checkSchemaErrors(data, schema) {
  const errors = [];
  for (const v of (schema.variables || [])) {
    if (v.type === 'loop') {
      const arr = data[v.key];
      if (v.required && (!Array.isArray(arr) || arr.length === 0)) {
        errors.push(`"${v.key}" 必填 loop 陣列為空或缺失`); continue;
      }
      if (Array.isArray(arr)) {
        arr.forEach((item, i) => {
          if (!item || typeof item !== 'object') { errors.push(`"${v.key}[${i}]" 不是物件`); return; }
          for (const c of (v.children || [])) {
            if (c.required && (item[c.key] === undefined || item[c.key] === null))
              errors.push(`"${v.key}[${i}].${c.key}" 必填欄位缺失`);
          }
        });
      }
    } else {
      if (v.required && (data[v.key] === undefined || data[v.key] === null || data[v.key] === ''))
        errors.push(`"${v.key}" 必填欄位缺失`);
    }
  }
  return errors;
}

// ─── P2: Template Values Extractor ────────────────────────────────────────────

/**
 * Fallback: when Pro's response is missing / malformed template_values block,
 * Flash re-reads the full response text and extracts the values.
 * Returns extracted JSON or null.
 */
async function extractTemplateValues(responseText, schema) {
  const vars = schema.variables || [];
  const schemaDesc = vars.map(v => {
    if (v.type === 'loop')
      return `${v.key} (loop 陣列): 子欄位 ${(v.children || []).map(c => `${c.key}(${c.type})`).join(', ')}`;
    return `${v.key} (${v.type}${v.required ? ', 必填' : ''})`;
  }).join('\n');

  const prompt = `從以下 AI 回覆中提取範本填寫值，輸出符合 schema 的 JSON 物件。

【Schema 欄位】
${schemaDesc}

【AI 回覆】
${responseText.slice(0, 7000)}

只回傳 JSON 物件，不加說明或 markdown。`;

  try {
    const { text } = await generateTextSync(MODEL_FLASH, [], prompt);
    const extracted = safeParseJson(text);
    if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) {
      console.log('[P2:Extractor] Fallback extraction OK');
      return extracted;
    }
  } catch (e) {
    console.warn('[P2:Extractor] failed:', e.message);
  }
  return null;
}

// ─── P3: Task Planner ─────────────────────────────────────────────────────────

/**
 * Fast complexity pre-check via regex — avoids Flash call for simple messages.
 */
function _isLikelyMultiStep(message) {
  const patterns = [
    /然後.{0,20}(寄|發送|通知|上傳|更新|儲存)/,
    /先.{2,40}再.{2,30}/,
    /完成後.{2,20}(寄|發|傳|通知)/,
    /(生成|產生|建立).{2,30}(並|且).{2,20}(寄|發|傳)/,
    /第[一二三四]步|step\s*[1-4]/i,
    /(生成|產生).{2,40}(發給|寄給|傳給)/,
  ];
  return patterns.some(p => p.test(message));
}

/**
 * Decompose a user message into a pipelineRunner-compatible nodes[] plan.
 * Returns null if the request is single-step (normal LLM flow should handle it).
 *
 * @param {string}   userMessage
 * @param {string}   recentContext     - recent conversation summary
 * @param {Array}    capabilities      - [{name, type, description}] available tools/skills/KBs
 * @returns {Array|null}               - pipelineRunner nodes[] or null
 */
async function planDynamicTask(userMessage, recentContext, capabilities) {
  if (!_isLikelyMultiStep(userMessage)) return null;

  const capList = capabilities.slice(0, 30).map(c =>
    `- [${c.type}] ${c.name}: ${(c.description || '').slice(0, 100)}`
  ).join('\n');

  const prompt = `你是任務規劃器，負責將使用者的多步驟請求拆解為可執行節點。

【可用能力清單】
${capList || '（無特定工具）'}

【使用者請求】
「${userMessage}」
${recentContext ? `\n【近期對話】\n${recentContext.slice(0, 800)}` : ''}

【判斷規則】
- 若請求可以單一 AI 回覆解決 → 回傳 {"nodes": null}
- 若請求明確需要 2+ 個獨立動作（例如：生成文件 + 發信、查詢資料 + 更新紀錄）→ 拆解
- 不確定時 → 回傳 {"nodes": null}（保守原則）

【節點類型說明】
- skill: 呼叫技能，需 name (技能名稱), input (可用 {{ai_output}} 或 {{node_<id>_output}})
- kb: 查詢知識庫，需 name (KB名稱), query
- ai: 額外 AI 呼叫，需 prompt (可含 {{}} 插值)
- generate_file: 生成檔案，需 file_type, filename，可加 template_id
- condition: 條件判斷，需 judge (text|ai), value/prompt, then_id, else_id

【輸出格式（多步驟時）】
{
  "summary": "一句話說明執行計劃",
  "nodes": [
    {"id": "step1", "type": "ai|skill|kb|generate_file", "name": "...", "input": "...", "prompt": "..."},
    {"id": "step2", "type": "skill", "name": "...", "input": "{{node_step1_output}}"}
  ]
}

只回傳 JSON，不加說明。`;

  try {
    const { text } = await generateTextSync(MODEL_FLASH, [], prompt);
    const plan = safeParseJson(text);
    if (!plan?.nodes || !Array.isArray(plan.nodes) || plan.nodes.length < 2) {
      return null; // single-step or no plan
    }
    console.log(`[P3:Planner] Multi-step plan (${plan.nodes.length} nodes): ${plan.summary || plan.nodes.map(n => n.id).join('→')}`);
    return plan;
  } catch (e) {
    console.warn('[P3:Planner] failed (falling back to normal flow):', e.message);
    return null;
  }
}

// ─── P3 Pipeline Execution Helper ─────────────────────────────────────────────

/**
 * Execute a dynamic plan (from planDynamicTask) using the existing pipelineRunner.
 * Streams status updates via sendEvent callback.
 *
 * @param {Array}    nodes          - pipelineRunner nodes[]
 * @param {string}   initialInput   - seed input text (user message or prior context)
 * @param {object}   db
 * @param {object}   context        - { userId, sessionId, user }
 * @param {Function} sendEvent      - SSE event sender
 * @returns {{ text, generatedFiles }}
 */
async function executeDynamicPlan(nodes, initialInput, db, context, sendEvent) {
  const { runPipeline } = require('./pipelineRunner');

  sendEvent({ type: 'status', message: `執行多步驟計劃（${nodes.length} 步）...` });

  const { generatedFiles, nodeOutputs, log } = await runPipeline(
    nodes,
    initialInput,
    db,
    { ...context, taskName: '動態任務' }
  );

  // Build summary text from all node outputs
  const outputParts = nodes
    .filter(n => nodeOutputs[n.id])
    .map(n => `**[${n.id}]** ${nodeOutputs[n.id]}`);

  const text = outputParts.join('\n\n') || '任務已完成。';

  // Log any errors
  const errors = log.filter(l => l.status === 'error');
  if (errors.length > 0) {
    console.warn(`[P3:Execute] ${errors.length} node errors:`, errors.map(e => `${e.id}: ${e.error}`).join('; '));
  }

  return { text, generatedFiles };
}

module.exports = {
  // P0
  runPptxLayoutEngine,
  // P1
  validateAndFixSchema,
  // P2
  extractTemplateValues,
  // P3
  planDynamicTask,
  executeDynamicPlan,
  // exposed for testing
  _checkSchemaErrors,
  _isLikelyMultiStep,
};
