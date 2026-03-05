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
async function transcribeAudio(filePath, mimeType) {
  const model = genAI.getGenerativeModel({ model: MODEL_FLASH });
  const audioPart = await fileToGeminiPart(filePath, mimeType);
  const result = await model.generateContent([
    audioPart,
    { text: '請完整轉錄這段音訊，只回傳轉錄文字，不要加任何說明。' },
  ]);
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

async function streamChat(apiModel, history, userParts, onChunk, extraSystemInstruction = '', disableSearch = false) {
  // apiModel is the resolved API model string (e.g. 'gemini-3-pro-preview')
  console.log(`[Gemini] streamChat model=${apiModel} history=${history.length} userParts=${userParts.length}`);

  // Disable Google Search grounding when inline file data is present
  // (Gemini API does not allow mixing googleSearch tool with inlineData parts)
  // Also disable when caller explicitly requests it (e.g. inject skill already provides data)
  const hasInlineData = userParts.some((p) => p.inlineData);
  const useSearch = !hasInlineData && !disableSearch;
  console.log(`[Gemini] hasInlineData=${hasInlineData}, googleSearch=${useSearch}`);

  const fullInstruction = extraSystemInstruction
    ? getSystemInstruction() + '\n\n---\n' + extraSystemInstruction
    : getSystemInstruction();

  const model = genAI.getGenerativeModel({
    model: apiModel,
    systemInstruction: fullInstruction,
    generationConfig: {
      maxOutputTokens: 65536,
    },
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

當使用者要求生成/匯出/下載/轉換/輸出任何格式的檔案時，你**必須**在回覆中直接寫出下方的程式碼區塊格式，並填入完整內容。
- 絕對不能只說「已生成」「系統會自動處理」「點擊下方連結」——這些說法無效，不會產生任何檔案。
- 必須實際把內容寫進代碼區塊中，系統才能偵測並生成可下載的檔案。
- 如果使用者要求 PDF 和 Word，就必須同時輸出兩個代碼區塊。

\`\`\`generate_xlsx:filename.xlsx
[JSON 陣列: [{"sheetName":"Sheet1","data":[[col1,col2],[val1,val2]]}]]
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
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_FLASH }); // use Flash for speed/cost
    const prompt = `根據以下對話內容，產生一個簡短的繁體中文標題（10字以內，不加引號、冒號或標點符號）：\n使用者: ${userMessage.slice(0, 300)}\nAI: ${aiResponse.slice(0, 300)}`;
    const result = await model.generateContent(prompt);
    const title = result.response.text().trim().replace(/^["「『]|["」』]$/g, '').slice(0, 50);
    return title || userMessage.trim().slice(0, 30);
  } catch (e) {
    return userMessage.trim().slice(0, 30);
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
async function generateWithTools(apiModel, history, userParts, functionDeclarations, toolHandler, extraSystemInstruction = '') {
  const fullInstruction = extraSystemInstruction
    ? getSystemInstruction() + '\n\n---\n' + extraSystemInstruction
    : getSystemInstruction();
  const model = genAI.getGenerativeModel({
    model: apiModel,
    systemInstruction: fullInstruction,
    tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : [],
  });

  const chat = model.startChat({ history });
  let result = await chat.sendMessage(userParts);

  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const usage = result.response.usageMetadata || {};
    inputTokens += usage.promptTokenCount || 0;
    outputTokens += usage.candidatesTokenCount || 0;

    const fnCalls = result.response.functionCalls?.() || [];
    if (fnCalls.length === 0) break;

    // Call each tool and collect responses
    const fnResponses = [];
    for (const call of fnCalls) {
      toolCallCount++;
      let toolResult;
      try {
        toolResult = await toolHandler(call.name, call.args || {});
      } catch (e) {
        toolResult = `[Tool error: ${e.message}]`;
      }
      fnResponses.push({
        functionResponse: {
          name: call.name,
          response: { content: String(toolResult) },
        },
      });
    }

    result = await chat.sendMessage(fnResponses);
  }

  const finalUsage = result.response.usageMetadata || {};
  inputTokens += finalUsage.promptTokenCount || 0;
  outputTokens += finalUsage.candidatesTokenCount || 0;

  return {
    text: result.response.text(),
    inputTokens,
    outputTokens,
    toolCallCount,
  };
}

module.exports = { streamChat, generateWithImage, generateTextSync, generateWithTools, transcribeAudio, extractTextFromFile, fileToGeminiPart, generateTitle, MODEL_PRO, MODEL_FLASH };
