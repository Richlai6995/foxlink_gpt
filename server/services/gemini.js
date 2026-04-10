require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const MODEL_PRO = process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview';
const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';

/**
 * Parse uploaded file into Gemini Part
 */
async function fileToGeminiPart(filePath, mimeType) {
  const data = fs.readFileSync(filePath);
  return {
    inlineData: {
      data: data.toString('base64'),
      mimeType,
    },
  };
}

// Max characters per extracted file (~25k tokens); larger content is truncated
const MAX_EXTRACTED_CHARS = 100000;
// Max rows per sheet when reading Excel (xlsx sheetRows option)
const MAX_EXCEL_ROWS_PER_SHEET = 2000;
// Max pages to parse from PDF (prevent OOM on large files)
const MAX_PDF_PAGES = 80;

function truncate(text, label) {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return text.slice(0, MAX_EXTRACTED_CHARS) + `\n\n[⚠️ ${label} 內容過長，已截斷顯示前 ${MAX_EXTRACTED_CHARS} 字元]`;
}

/**
 * Extract text from Office/PDF files
 */
async function extractTextFromFile(filePath, mimeType, originalName) {
  try {
    console.log(`[Gemini] extractTextFromFile: "${originalName}" (${mimeType})`);
    if (mimeType === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const fileSize = fs.statSync(filePath).size;
      console.log(`[Gemini] PDF size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
      const dataBuffer = fs.readFileSync(filePath);
      // Limit pages to prevent OOM; wrap with 30s timeout to avoid hanging
      const parseTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PDF 解析超時 (30s)')), 30000)
      );
      const data = await Promise.race([
        pdfParse(dataBuffer, { max: MAX_PDF_PAGES }),
        parseTimeout,
      ]);
      const pages = data.numpages || '?';
      console.log(`[Gemini] PDF parsed: ${pages} pages, ${data.text.length} chars`);
      const note = pages > MAX_PDF_PAGES
        ? `\n\n[⚠️ PDF 共 ${pages} 頁，僅解析前 ${MAX_PDF_PAGES} 頁]`
        : '';
      return truncate(`[PDF: ${originalName}]\n${data.text}`, originalName) + note;
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return truncate(`[Word: ${originalName}]\n${result.value}`, originalName);
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      const XLSX = require('xlsx');
      // Limit rows per sheet to avoid memory explosion on large files
      const workbook = XLSX.readFile(filePath, { sheetRows: MAX_EXCEL_ROWS_PER_SHEET });
      const sheetNames = workbook.SheetNames;
      let text = `[Excel: ${originalName}]\n`;
      for (const name of sheetNames) {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
        if (csv.replace(/,/g, '').trim().length === 0) continue; // skip blank sheets
        text += `\nSheet: ${name}\n${csv}\n`;
        if (text.length > MAX_EXTRACTED_CHARS) {
          text = text.slice(0, MAX_EXTRACTED_CHARS);
          text += `\n\n[⚠️ Excel 內容過長，已截斷（共 ${sheetNames.length} 個工作表，僅顯示部分）]`;
          break;
        }
      }
      return text;
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-powerpoint'
    ) {
      const JSZip = require('jszip');
      const data = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(data);
      let text = `[PowerPoint: ${originalName}]\n`;
      const slideFiles = Object.keys(zip.files)
        .filter((f) => f.match(/ppt\/slides\/slide\d+\.xml/))
        .sort();
      for (const sf of slideFiles) {
        const content = await zip.files[sf].async('string');
        const plainText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        text += plainText + '\n';
        if (text.length > MAX_EXTRACTED_CHARS) {
          text = text.slice(0, MAX_EXTRACTED_CHARS) + '\n\n[⚠️ PPT 內容過長，已截斷]';
          break;
        }
      }
      return text;
    }

    if (mimeType.startsWith('text/')) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return truncate(`[Text: ${originalName}]\n${raw}`, originalName);
    }
  } catch (e) {
    console.error(`[Gemini] extractTextFromFile FAILED for "${originalName}":`, e.message);
    console.error(`[Gemini] Stack:`, e.stack);
  }
  return null;
}

/**
 * Transcribe audio file using Gemini
 */
async function transcribeAudio(filePath, mimeType, timeoutMs = 25 * 60 * 1000) {
  const model = genAI.getGenerativeModel({ model: MODEL_FLASH });
  const audioPart = await fileToGeminiPart(filePath, mimeType);

  const transcribePromise = model.generateContent([
    audioPart,
    { text: '請完整轉錄這段音訊，只回傳轉錄文字，不要加任何說明。' },
  ]);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Audio transcription timeout (5 min)')), timeoutMs)
  );

  const result = await Promise.race([transcribePromise, timeoutPromise]);
  const usage = result.response.usageMetadata || {};
  return {
    text: result.response.text(),
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/**
 * Build Gemini history from DB messages
 */
function buildHistory(messages) {
  return messages.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content || '' }],
  }));
}

/**
 * Stream chat response
 * @param {string} modelName - model identifier
 * @param {Array} history - previous messages [{role, parts}]
 * @param {Array} userParts - current user message parts
 * @param {Function} onChunk - callback(text)
 * @returns {Promise<{text: string, inputTokens: number, outputTokens: number}>}
 */
function buildSearchNotice(queries, sources) {
  let notice = '\n\n---\n🔍 **已使用 Google 搜尋取得最新資料**';
  if (queries.length) {
    notice += `\n搜尋關鍵字：${queries.map(q => `\`${q}\``).join('、')}`;
  }
  if (sources.length) {
    const unique = [...new Set(sources)].slice(0, 5);
    notice += '\n參考來源：\n' + unique.map(u => `- ${u}`).join('\n');
  }
  return notice;
}

async function streamChat(apiModel, history, userParts, onChunk, extraSystemInstruction = '', disableSearch = false, genConfig = null) {
  // apiModel is the resolved API model string (e.g. 'gemini-3-pro-preview')
  console.log(`[Gemini] streamChat model=${apiModel} history=${history.length} userParts=${userParts.length} genConfig=${JSON.stringify(genConfig)}`);

  // Disable Google Search grounding when inline file data is present
  // (Gemini API does not allow mixing googleSearch tool with inlineData parts)
  // Also disable when caller explicitly requests it (e.g. inject skill already provides data)
  const hasInlineData = userParts.some((p) => p.inlineData);
  const enableSearch = genConfig?.enable_search !== undefined ? genConfig.enable_search : true;
  const useSearch = !hasInlineData && !disableSearch && enableSearch;
  console.log(`[Gemini] hasInlineData=${hasInlineData}, googleSearch=${useSearch}`);

  const fullInstruction = extraSystemInstruction
    ? getSystemInstruction() + '\n\n---\n' + extraSystemInstruction
    : getSystemInstruction();

  // Build generationConfig from DB settings + defaults
  const generationConfig = {
    maxOutputTokens: genConfig?.max_output_tokens || 65536,
    ...(genConfig?.temperature != null ? { temperature: genConfig.temperature } : {}),
    ...(genConfig?.top_p != null ? { topP: genConfig.top_p } : {}),
    ...(genConfig?.thinking_budget != null ? { thinkingConfig: { thinkBudget: genConfig.thinking_budget } } : {}),
  };

  const model = genAI.getGenerativeModel({
    model: apiModel,
    systemInstruction: fullInstruction,
    generationConfig,
    tools: useSearch ? [{ googleSearch: {} }] : undefined,
  });

  const chat = model.startChat({ history });
  console.log(`[Gemini] Sending message stream...`);
  const result = await chat.sendMessageStream(userParts);

  let fullText = '';
  let searchUsed = false;
  for await (const chunk of result.stream) {
    let chunkText = '';
    try {
      chunkText = chunk.text();
    } catch (e) {
      const fr = chunk.candidates?.[0]?.finishReason;
      console.warn(`[Gemini] chunk.text() 失敗 finishReason=${fr}:`, e.message);
      if (fr === 'MAX_TOKENS') {
        console.warn(`[Gemini] 已達 maxOutputTokens 上限，輸出被截斷`);
        fullText += '\n\n[⚠️ 回應已達最大 Token 上限，內容可能不完整]';
        onChunk('\n\n[⚠️ 回應已達最大 Token 上限，內容可能不完整]');
        break;
      }
      if (fr && fr !== 'STOP') {
        throw new Error(`Gemini 回應被攔截 (finishReason: ${fr})`);
      }
      // STOP with empty text → just skip
      continue;
    }
    if (chunkText) {
      fullText += chunkText;
      onChunk(chunkText);
    }
    // Check if search grounding was used
    const meta = chunk.candidates?.[0]?.groundingMetadata;
    if (meta?.webSearchQueries?.length) searchUsed = true;
  }

  const response = await result.response;
  const usage = response.usageMetadata || {};

  // Append search notice if grounding was triggered
  if (searchUsed) {
    const groundingMeta = response.candidates?.[0]?.groundingMetadata;
    const queries = groundingMeta?.webSearchQueries || [];
    const sources = groundingMeta?.groundingChunks
      ?.map(c => c.web?.uri)
      .filter(Boolean) || [];
    if (queries.length || sources.length) {
      const notice = buildSearchNotice(queries, sources);
      fullText += notice;
      onChunk(notice);
    }
  }

  return {
    text: fullText,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

function getSystemInstruction() {
  return `# 檔案生成規則（最高優先級，必須嚴格遵守）

⚠️ **禁止自動生成檔案**：除非使用者在本次訊息中明確要求輸出/下載/生成/匯出特定格式的檔案（如 Word、PDF、Excel、PPT、TXT），否則**絕對不可**輸出任何 generate_xxx 代碼區塊。純文字分析、比較、建議、摘要等回應一律不得附帶檔案生成。

當使用者**明確**要求生成/匯出/下載/轉換/輸出特定格式的檔案時，你**必須**在回覆中直接寫出下方的程式碼區塊格式，並填入完整內容。
- 絕對不能只說「已生成」「系統會自動處理」「點擊下方連結」——這些說法無效，不會產生任何檔案。
- 必須實際把內容寫進代碼區塊中，系統才能偵測並生成可下載的檔案。
- 如果使用者要求 PDF 和 Word，就必須同時輸出兩個代碼區塊。

\`\`\`generate_xlsx:filename.xlsx
[{"sheetName":"Sheet1","data":[["欄位1","欄位2"],["值1","值2"]]}]
\`\`\`

\`\`\`generate_docx:filename.docx
[完整 Markdown 文件內容]
\`\`\`

\`\`\`generate_pdf:filename.pdf
[完整 Markdown 文件內容]
\`\`\`

\`\`\`generate_txt:filename.txt
[純文字內容]
\`\`\`

# 角色與基本設定

你是 FOXLINK GPT，正崴精密工業的企業內部 AI 助理。
請以繁體中文回覆（除非使用者明確要求其他語言）。
回答要準確、專業、有條理。支援 Markdown 格式輸出。

**生成 PPT:**

【重要】使用者請求生成 PPT 時，必須先詢問以下偏好（除非使用者已明確說明）：
1. 簡報風格主題：
   - 深色系：企業藍(corporate)、現代深色(dark)、清新綠(green)、活力橙(orange)、典雅紫(purple)
   - 淺色系/白底：白色專業(white)、淺灰(light)、淡綠(light_green)、淡紫(light_purple)
2. 是否要在投影片加入 Emoji 圖示以增加視覺效果？（如 📊 📈 ✅ 💡 🎯 等）
3. 是否需要封面頁、議程頁、結語頁等完整架構？

確認偏好後再使用以下格式生成：
\`\`\`generate_pptx:filename.pptx
{
  "global_theme": "corporate|dark|green|orange|purple",
  "slides": [
    {
      "type": "title",
      "title": "主標題",
      "subtitle": "副標題或日期/部門",
      "icon": "🏢"
    },
    {
      "type": "agenda",
      "title": "議程",
      "items": ["第一點", "第二點", "第三點"],
      "icon": "📋"
    },
    {
      "type": "content",
      "title": "投影片標題",
      "bullets": ["重點一", "重點二", "重點三"],
      "icon": "💡",
      "highlight": "可選：強調文字"
    },
    {
      "type": "two_col",
      "title": "雙欄比較",
      "left_title": "左欄標題", "left_bullets": ["..."],
      "right_title": "右欄標題", "right_bullets": ["..."],
      "icon": "⚖️"
    },
    {
      "type": "section",
      "title": "章節標題",
      "subtitle": "章節說明",
      "icon": "📌"
    },
    {
      "type": "quote",
      "quote": "引言或重點結論文字",
      "author": "來源或作者"
    },
    {
      "type": "closing",
      "title": "感謝聆聽",
      "subtitle": "聯絡資訊或下一步行動",
      "icon": "🙏"
    }
  ]
}
\`\`\`

**生成 TXT:**
\`\`\`generate_txt:filename.txt
[純文字內容]
\`\`\`

系統將自動偵測並生成下載連結。

# 知識庫工具使用規則（dify_kb_* 系列工具）

呼叫 dify_kb_* 工具時，必須遵守：

1. **精確意圖匹配**（最重要）：使用者問題的**核心意圖**必須與知識庫範疇完全吻合，「包含相同關鍵字」不代表「意圖相符」。
   - 判斷標準：知識庫能直接回答這個問題嗎？還是只是主題有交集？
   - ✅ 應呼叫：問題的目的就是要從該知識庫獲取資訊（例：查負責人聯絡窗口、查公司政策規定）
   - ❌ 不應呼叫：問題雖提到相同主題，但目的是技術操作、資料查詢、程式分析等（例：查誰開發某程式、查某資料庫資料、分析某系統邏輯）

2. 若不確定，**預設不呼叫**，直接以自身知識回答或表示無法取得。

3. 每個知識庫在同一次回覆中只能呼叫一次。`;
}

/**
 * Generate image(s) via Imagen-capable model (e.g. gemini-3-pro-image-preview).
 * Non-streaming; returns text + array of { data: base64, mimeType }.
 * @param {string} apiModel
 * @param {Array} history  [{role, parts}]
 * @param {Array} userParts
 * @returns {Promise<{text: string, images: Array<{data: string, mimeType: string}>, inputTokens: number, outputTokens: number}>}
 */
async function generateWithImage(apiModel, history, userParts) {
  console.log(`[Gemini] generateWithImage model=${apiModel}`);
  const model = genAI.getGenerativeModel({
    model: apiModel,
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  // Flatten history + current message into a single content array
  const contents = [
    ...history,
    { role: 'user', parts: userParts },
  ];

  const result = await model.generateContent({ contents });
  const response = result.response;
  const usage = response.usageMetadata || {};

  let text = '';
  const images = [];
  // rawParts: ordered list of non-thought parts for verbatim history replay
  // Images stored by index (imageIdx) so caller can substitute filename refs
  const rawParts = [];
  for (const part of (response.candidates?.[0]?.content?.parts || [])) {
    if (part.thought) continue;  // skip internal thought parts
    if (part.text) {
      text += part.text;
      rawParts.push({ _type: 'text', text: part.text, thoughtSignature: part.thoughtSignature || null });
    } else if (part.inlineData) {
      const imageIdx = images.length;
      images.push({ data: part.inlineData.data, mimeType: part.inlineData.mimeType, thoughtSignature: part.thoughtSignature || null });
      rawParts.push({ _type: 'image', imageIdx, mimeType: part.inlineData.mimeType, thoughtSignature: part.thoughtSignature || null });
    }
  }

  return {
    text,
    images,
    rawParts,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/**
 * Generate a short semantic title for a chat session
 */
async function generateTitle(userMessage, aiResponse) {
  const fallback = userMessage.trim().slice(0, 30);
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_FLASH });
    const prompt =
      `Based on the conversation below, generate a concise title in THREE languages.\n` +
      `Reply ONLY with valid JSON — no markdown, no extra text:\n` +
      `{"zh":"繁體中文標題（10字以內）","en":"English title (max 8 words)","vi":"tiêu đề tiếng Việt (tối đa 10 từ)"}\n\n` +
      `User: ${userMessage.slice(0, 300)}\nAI: ${aiResponse.slice(0, 300)}`;
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const usage = result.response.usageMetadata || {};
    // Parse JSON — strip any accidental markdown fences
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch (_) { parsed = {}; }
    const clean = (s) => (s || '').replace(/^["「『]|["」』]$/g, '').slice(0, 50) || fallback;
    const title_zh = clean(parsed.zh);
    const title_en = clean(parsed.en);
    const title_vi = clean(parsed.vi);
    // Detect content language for the primary `title` field (used as fallback)
    const isZh = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(userMessage);
    const isVi = !isZh && /[àáâãèéêìíòóôõùúýăđơư]/i.test(userMessage);
    const title = isZh ? title_zh : isVi ? title_vi : title_en;
    return {
      title, title_zh, title_en, title_vi,
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      model: MODEL_FLASH,
    };
  } catch (e) {
    return { title: fallback, title_zh: fallback, title_en: fallback, title_vi: fallback,
             inputTokens: 0, outputTokens: 0, model: MODEL_FLASH };
  }
}

/**
 * Non-streaming text generation for scheduled tasks.
 * Supports full history + system instruction.
 * @param {string} apiModel
 * @param {Array}  history   - [{role, parts}]
 * @param {string} prompt    - user prompt text (already variable-substituted)
 * @returns {Promise<{text, inputTokens, outputTokens}>}
 */
async function generateTextSync(apiModel, history, prompt) {
  const model = genAI.getGenerativeModel({
    model: apiModel,
    systemInstruction: getSystemInstruction(),
  });
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: prompt }] },
  ];
  const result = await model.generateContent({ contents });
  const response = result.response;
  const usage = response.usageMetadata || {};
  return {
    text: response.text(),
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/**
 * Non-streaming generation with MCP function calling loop.
 * Keeps calling tools until Gemini produces a final text response.
 * @param {string} apiModel
 * @param {Array}  history              - [{role, parts}]
 * @param {Array}  userParts            - Gemini content parts for the user message
 * @param {Array}  functionDeclarations - Gemini-format tool definitions
 * @param {Function} toolHandler        - async (toolName, args) => string result
 * @returns {Promise<{text, inputTokens, outputTokens, toolCallCount}>}
 */
async function generateWithTools(apiModel, history, userParts, functionDeclarations, toolHandler, extraSystemInstruction = '', opts = {}) {
  const fullInstruction = extraSystemInstruction
    ? getSystemInstruction() + '\n\n---\n' + extraSystemInstruction
    : getSystemInstruction();
  const model = genAI.getGenerativeModel({
    model: apiModel,
    systemInstruction: fullInstruction,
    tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : [],
  });

  // ⭐ 自管 contents — 不用 chat.startChat()，因為舊 SDK 會洗掉 thoughtSignature
  // 導致 Gemini 3 thinking model 多輪 tool call 失敗
  const contents = [...history, { role: 'user', parts: userParts }];
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  const MAX_TOOL_ROUNDS = 10;
  let lastResponse = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await model.generateContent({ contents });
    const response = result.response;
    lastResponse = response;
    const usage = response.usageMetadata || {};
    inputTokens += usage.promptTokenCount || 0;
    outputTokens += usage.candidatesTokenCount || 0;

    // ⭐ 從 candidates 取原始 parts (保留 thoughtSignature)
    const modelParts = response.candidates?.[0]?.content?.parts || [];
    if (modelParts.length > 0) {
      contents.push({ role: 'model', parts: modelParts });
    }

    const fnCalls = modelParts
      .filter(p => p.functionCall)
      .map(p => p.functionCall);

    if (fnCalls.length === 0) {
      return {
        text: response.text(),
        inputTokens,
        outputTokens,
        toolCallCount,
      };
    }

    // Call each tool and collect responses
    const fnResponses = [];
    let directAnswerText = null;
    for (const call of fnCalls) {
      toolCallCount++;
      let toolResult;
      try {
        toolResult = await toolHandler(call.name, call.args || {});
      } catch (e) {
        toolResult = `[Tool error: ${e.message}]`;
      }
      // Check if this tool is configured for direct-answer mode
      if (opts.directAnswerTools?.has(call.name)) {
        directAnswerText = String(toolResult);
      }
      fnResponses.push({
        functionResponse: {
          name: call.name,
          response: { content: String(toolResult) },
        },
      });
    }
    // Direct answer: return raw tool result without feeding back to LLM
    if (directAnswerText !== null) {
      return { text: directAnswerText, inputTokens, outputTokens, toolCallCount, isDirectAnswer: true };
    }

    contents.push({ role: 'user', parts: fnResponses });
  }

  // 達 MAX_TOOL_ROUNDS 仍未產生最終回答 — 回傳最後一個 response 中的文字（若有）
  let lastText = '';
  try {
    lastText = lastResponse?.text() || '';
  } catch {
    lastText = '';
  }
  return {
    text: lastText || '[達到工具呼叫上限，未取得最終回答]',
    inputTokens,
    outputTokens,
    toolCallCount,
  };
}

/**
 * Streaming version of generateWithTools — streams the final LLM response
 * while still handling multi-round tool calls.
 *
 * Tool-call rounds: Gemini returns function calls (no text) → execute tools → send responses.
 * Final round: Gemini streams the text answer → onChunk called per chunk.
 *
 * @param {string}   apiModel
 * @param {Array}    history
 * @param {Array}    userParts
 * @param {Array}    functionDeclarations
 * @param {Function} toolHandler    - async (name, args) => string
 * @param {Function} onChunk        - (chunkText) => void
 * @param {Function} onToolStatus   - (statusMsg) => void  — optional, notifies caller about tool activity
 * @param {string}   extraSystemInstruction
 * @param {object}   opts           - { directAnswerTools: Set }
 */
async function generateWithToolsStream(
  apiModel, history, userParts, functionDeclarations, toolHandler,
  onChunk, onToolStatus, extraSystemInstruction = '', opts = {}, genConfig = null
) {
  const fullInstruction = extraSystemInstruction
    ? getSystemInstruction() + '\n\n---\n' + extraSystemInstruction
    : getSystemInstruction();

  const generationConfig = {
    maxOutputTokens: genConfig?.max_output_tokens || 65536,
    ...(genConfig?.temperature != null ? { temperature: genConfig.temperature } : {}),
    ...(genConfig?.top_p != null ? { topP: genConfig.top_p } : {}),
    ...(genConfig?.thinking_budget != null ? { thinkingConfig: { thinkBudget: genConfig.thinking_budget } } : {}),
  };

  const model = genAI.getGenerativeModel({
    model: apiModel,
    systemInstruction: fullInstruction,
    generationConfig,
    tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : [],
  });

  // ⭐ 自管 contents — 不用 chat.startChat()，因為舊 SDK 會洗掉 thoughtSignature
  // 導致 Gemini 3 thinking model 多輪 tool call 失敗
  const contents = [...history, { role: 'user', parts: userParts }];
  let inputTokens = 0, outputTokens = 0;
  let toolCallCount = 0;
  let fullText = '';
  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await model.generateContentStream({ contents });

    // ⭐ 從 raw candidates 收集 parts，保留 thoughtSignature
    // streaming 時同 index 的 text part 會跨多個 chunk，需累積；其他 part type 取代
    const partsByIndex = new Map();
    let finishReason = null;

    for await (const chunk of result.stream) {
      const cand = chunk.candidates?.[0];
      if (!cand) continue;
      if (cand.finishReason) finishReason = cand.finishReason;

      const chunkParts = cand.content?.parts || [];
      chunkParts.forEach((p, i) => {
        if (p.text != null) {
          const existing = partsByIndex.get(i);
          if (existing && existing.text != null && !existing.functionCall) {
            existing.text += p.text;
            if (p.thoughtSignature) existing.thoughtSignature = p.thoughtSignature;
          } else {
            partsByIndex.set(i, { ...p });
          }
          if (!p.thought) {  // 不要把 thinking 內容串到使用者輸出
            fullText += p.text;
            onChunk(p.text);
          }
        } else {
          // functionCall / inlineData / 其他 — 整個取代
          partsByIndex.set(i, { ...p });
        }
      });
    }

    if (finishReason === 'MAX_TOKENS') {
      const msg = '\n\n[⚠️ 回應已達最大 Token 上限，內容可能不完整]';
      fullText += msg;
      onChunk(msg);
    } else if (finishReason && finishReason !== 'STOP' && finishReason !== 'TOOL_USE' && finishReason !== 'TOOL_CALLS') {
      // 其他異常 finishReason（SAFETY、RECITATION、OTHER 等）
      console.warn(`[Gemini] Unexpected finishReason: ${finishReason}`);
    }

    const response = await result.response;
    const usage = response.usageMetadata || {};
    inputTokens += usage.promptTokenCount || 0;
    outputTokens += usage.candidatesTokenCount || 0;

    // 組出完整 model turn（按 index 排序）
    const modelParts = [...partsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, p]) => p);

    // ⭐ 關鍵：原樣 append 回 contents，thoughtSignature 還在
    if (modelParts.length > 0) {
      contents.push({ role: 'model', parts: modelParts });
    }

    // 從 modelParts 抓 functionCall（不用 response.functionCalls()）
    const fnCalls = modelParts
      .filter(p => p.functionCall)
      .map(p => p.functionCall);

    if (fnCalls.length === 0) break; // No more tool calls — done

    // Execute tools
    const fnResponses = [];
    let directAnswerText = null;
    for (const call of fnCalls) {
      toolCallCount++;
      if (onToolStatus) onToolStatus(`呼叫工具：${call.name}`);
      let toolResult;
      try {
        toolResult = await toolHandler(call.name, call.args || {});
      } catch (e) {
        toolResult = `[Tool error: ${e.message}]`;
      }
      if (opts.directAnswerTools?.has(call.name)) {
        directAnswerText = String(toolResult);
      }
      fnResponses.push({
        functionResponse: {
          name: call.name,
          response: { content: String(toolResult) },
        },
      });
    }

    if (directAnswerText !== null) {
      return { text: directAnswerText, inputTokens, outputTokens, toolCallCount, isDirectAnswer: true };
    }

    contents.push({ role: 'user', parts: fnResponses });
  }

  return { text: fullText, inputTokens, outputTokens, toolCallCount };
}

module.exports = { streamChat, generateWithImage, generateTextSync, generateWithTools, generateWithToolsStream, transcribeAudio, extractTextFromFile, fileToGeminiPart, generateTitle, MODEL_PRO, MODEL_FLASH };
