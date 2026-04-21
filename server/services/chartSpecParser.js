/**
 * chartSpecParser — 從 LLM final text 中解析 ```generate_chart:type\n{...}``` 代碼區塊
 *
 * Phase 2:tolerant JSON(LLM 常吐多餘逗號、單引號)+ data_ref 解析 + rows cap/downsample。
 * 詳見 docs/chat-inline-chart-plan.md §4.4
 *
 * Output:
 *   {
 *     strippedText,          // 移除 chart 區塊後的文字
 *     charts: [               // 有效 chart spec 陣列(丟給前端 / 存 DB)
 *       { type, title, x_field, y_fields: [...], data: [...] }
 *     ],
 *     errors: [               // 解析失敗的區塊(保留 fenced block 在 text 中,只記 log)
 *       { reason, body_preview }
 *     ]
 *   }
 */

const CHART_BLOCK_RE = /```generate_chart:(\w+)\s*\n([\s\S]*?)```/g;
const VALID_TYPES = new Set(['bar', 'line', 'pie', 'scatter', 'area', 'heatmap', 'radar']);

// 單一 chart 內 inline data 硬上限(超過會 downsample 或拒絕)
const DATA_ROW_HARDMAX = 2000;
// 超過這個 rows 就線性採樣到這個數量
const DATA_ROW_SOFTCAP = 200;
// chart 整體 spec JSON 字元上限(LLM 吐爆就拒絕,避免 CLOB 爆量)
const SPEC_JSON_MAX_CHARS = 200000;

/**
 * tolerant JSON parse — LLM 常見錯誤修補:
 *  - 結尾多逗號  { "a": 1, }
 *  - 單引號屬性 {'a': 1}
 *  - JS-style 未 quote 的 key(先不處理,這會打爆 regex)
 * 如果失敗,回傳 null。
 */
function tolerantJsonParse(text) {
  const raw = text.trim();
  try {
    return JSON.parse(raw);
  } catch (_) {}
  // 嘗試:移除 dangling 逗號 + 單引號 → 雙引號
  const repaired = raw
    .replace(/,(\s*[\]}])/g, '$1')
    // 只替換 { 'key': 或 , 'key': 或 [ 'v' 這種 pattern,避免破壞字串內的單引號
    .replace(/([\{\[,]\s*)'([^'\\]*)'(\s*[:,\]}])/g, '$1"$2"$3');
  try {
    return JSON.parse(repaired);
  } catch (_) {
    return null;
  }
}

/**
 * 簡化版 JSONPath — 只支援:
 *   $          整個根
 *   $.a        物件屬性
 *   $.a.b      巢狀屬性
 *   $.a[0]     陣列索引
 *   $.a[*]     陣列所有元素(回傳陣列)
 *   $.a.b.rows LLM 最常用的 pattern
 *
 * 回傳 value 或 undefined。不支援 filter / recursive descent,夠用為止。
 */
function jsonpathExtract(obj, path) {
  if (!path || path === '$' || path === '') return obj;
  const clean = path.replace(/^\$\.?/, '');
  if (!clean) return obj;
  const tokens = clean.split(/\.(?![^\[]*\])/).filter(Boolean);

  let cur = obj;
  for (const tok of tokens) {
    if (cur == null) return undefined;
    const m = tok.match(/^([^\[]+)?((?:\[[^\]]+\])*)$/);
    if (!m) return undefined;
    const key = m[1];
    const indexers = m[2] || '';
    if (key) {
      cur = cur[key];
      if (cur == null) return undefined;
    }
    if (indexers) {
      const ixRe = /\[([^\]]+)\]/g;
      let im;
      while ((im = ixRe.exec(indexers)) !== null) {
        const ix = im[1];
        if (ix === '*') {
          // 展開陣列;後續 tokens 只有 leaf 有意義(我們不支援 nested *)
          if (!Array.isArray(cur)) return undefined;
          return cur; // 提早回傳,* 之後的 tokens 忽略
        }
        const num = Number(ix);
        if (Number.isInteger(num) && Array.isArray(cur)) {
          cur = cur[num];
        } else {
          cur = cur[ix.replace(/^["']|["']$/g, '')];
        }
        if (cur == null) return undefined;
      }
    }
  }
  return cur;
}

/**
 * 從 toolCallResults 依 tool_call_id 查結果,再用 path 抽資料。
 * toolCallResults 結構:Array<{ id, name, result }>
 *   - id:synthetic ID,格式 `${name}_r${round}_${index}` 或單純 `${name}`(最後一次)
 *   - result:string(tool_handler 回傳的字串,通常是 JSON)
 *
 * 解析策略:
 *   1. 嚴格 match id
 *   2. 失敗則 match name(取最後一次呼叫)
 *   3. 從 result string parse JSON,再用 path 抽
 */
function resolveDataRef(dataRef, toolCallResults) {
  if (!dataRef || !Array.isArray(toolCallResults) || toolCallResults.length === 0) return null;
  const { tool_call_id, path } = dataRef;
  if (!tool_call_id) return null;

  let entry = toolCallResults.find(r => r.id === tool_call_id);
  if (!entry) {
    // fallback:tool name match(最後一次)
    const byName = toolCallResults.filter(r => r.name === tool_call_id);
    if (byName.length > 0) entry = byName[byName.length - 1];
  }
  if (!entry) return null;

  let parsed;
  try {
    parsed = typeof entry.result === 'string' ? JSON.parse(entry.result) : entry.result;
  } catch (_) {
    return null; // 非 JSON,無法 path 抽
  }

  const val = jsonpathExtract(parsed, path || '$');
  return Array.isArray(val) ? val : null;
}

/**
 * 線性採樣 downsample:rows 太多時等距取樣到 targetCount。
 * 保留頭尾,中間等距採樣。
 */
function downsample(rows, targetCount = DATA_ROW_SOFTCAP) {
  if (!Array.isArray(rows) || rows.length <= targetCount) return rows;
  const out = [];
  const step = (rows.length - 1) / (targetCount - 1);
  for (let i = 0; i < targetCount; i++) {
    out.push(rows[Math.round(i * step)]);
  }
  return out;
}

/**
 * 驗證 spec 結構 — 夠嚴會擋 LLM 亂吐,太嚴會 false negative。
 * 失敗時回傳 { ok:false, reason },成功回傳 { ok:true }。
 */
function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'spec 非物件' };
  if (!VALID_TYPES.has(spec.type)) return { ok: false, reason: `未知 type: ${spec.type}` };
  if (typeof spec.x_field !== 'string' || !spec.x_field) return { ok: false, reason: '缺 x_field' };
  if (!Array.isArray(spec.y_fields) || spec.y_fields.length === 0) return { ok: false, reason: '缺 y_fields' };
  for (const yf of spec.y_fields) {
    if (!yf || typeof yf.field !== 'string') return { ok: false, reason: 'y_fields 元素缺 field' };
  }
  if (!Array.isArray(spec.data) || spec.data.length === 0) return { ok: false, reason: 'data 為空' };
  if (spec.data.length > DATA_ROW_HARDMAX) return { ok: false, reason: `data 超過 ${DATA_ROW_HARDMAX} rows` };
  return { ok: true };
}

/**
 * 主入口:解析 LLM final text 中的 chart 區塊。
 *
 * @param {string} text          LLM 最終累積文字
 * @param {Array}  toolCallResults   [{ id, name, result }],用於 data_ref 解析。可空。
 * @returns {{ strippedText, charts, errors }}
 */
function parseChartBlocks(text, toolCallResults = []) {
  if (!text || typeof text !== 'string') return { strippedText: text || '', charts: [], errors: [] };

  const charts = [];
  const errors = [];
  const stripRanges = [];

  // 每次跑要 reset regex 的 lastIndex(/g flag 有狀態)
  CHART_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = CHART_BLOCK_RE.exec(text)) !== null) {
    const type = m[1];
    const body = m[2].trim();
    const start = m.index;
    const end = start + m[0].length;

    if (body.length > SPEC_JSON_MAX_CHARS) {
      errors.push({ reason: `spec JSON 超過 ${SPEC_JSON_MAX_CHARS} chars`, body_preview: body.slice(0, 120) });
      continue; // 不 strip,讓 LLM 的原始輸出能被 user 看到(debug 用)
    }

    const spec = tolerantJsonParse(body);
    if (!spec) {
      errors.push({ reason: 'JSON parse 失敗', body_preview: body.slice(0, 120) });
      continue;
    }

    // type fence 與 body.type 不一致時,以 fence 為準(LLM 有時只寫 fence 沒寫 body.type)
    spec.type = spec.type || type;
    if (spec.type !== type) spec.type = type;

    // data_ref 解析
    if (!Array.isArray(spec.data) && spec.data_ref) {
      const resolved = resolveDataRef(spec.data_ref, toolCallResults);
      if (resolved) spec.data = resolved;
    }

    const v = validateSpec(spec);
    if (!v.ok) {
      errors.push({ reason: v.reason, body_preview: body.slice(0, 120) });
      continue;
    }

    // rows softcap(驗證通過才 downsample,避免把壞 spec 也留下來)
    spec.data = downsample(spec.data);

    // 只保留白名單欄位,避免把 data_ref 多餘欄位 / 隨便欄位存進 DB
    charts.push({
      version: spec.version || 1,
      type: spec.type,
      title: typeof spec.title === 'string' ? spec.title : undefined,
      x_field: spec.x_field,
      y_fields: spec.y_fields.map(yf => ({
        field: String(yf.field),
        name: typeof yf.name === 'string' ? yf.name : undefined,
        color: typeof yf.color === 'string' ? yf.color : undefined,
      })),
      data: spec.data,
    });
    stripRanges.push([start, end]);
  }

  // 從後往前 strip,避免 index 失效
  let strippedText = text;
  for (const [s, e] of stripRanges.sort((a, b) => b[0] - a[0])) {
    strippedText = strippedText.slice(0, s) + strippedText.slice(e);
  }
  // 清掉 strip 後殘留的多個連續空行
  strippedText = strippedText.replace(/\n{3,}/g, '\n\n').trim();

  return { strippedText, charts, errors };
}

module.exports = {
  parseChartBlocks,
  // 下列 export 只供測試
  _internals: { tolerantJsonParse, jsonpathExtract, resolveDataRef, downsample, validateSpec },
};
