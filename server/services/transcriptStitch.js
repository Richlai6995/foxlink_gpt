'use strict';
/**
 * 逐字稿接縫去重(方案 B)
 *
 * 背景:長音檔切片有 lead-in overlap(每段開頭重轉上一段尾巴 ~60s 音訊,防接縫漏資料,
 *      見 gemini._splitAudio)。代價是接縫處內容重複。本模組在「合併成 .txt」時把這段
 *      重複的開頭剪掉,讓最終逐字稿「不漏也不重複」。
 *
 * 策略(保守 — 寧可留重複也絕不誤刪真內容):
 *   1. 字串法為主:上一段「尾」vs 這段「頭」找最長 suffix==prefix 重疊。
 *      同音檔 + 同模型 + temp0 → 重疊區文字幾乎一致,正規化後通常乾淨對得上。
 *   2. 字串法不足(模型在邊緣措辭差太多)且有 llmAnchorFn → 問 LLM「第一句新內容」當錨點。
 *   3. 都失敗 → 不剪(保留重複,退化成方案 A 的「標記重疊」,絕不誤刪)。
 *   4. 任一相鄰段非 ok / 失敗占位 / degenerate 截斷 → 跳過不剪。
 */

// 正規化:只留 CJK + 英數(去標點/空白,降低模型輸出差異),並記原始 index 對照表
function _normalizeWithMap(s) {
  const chars = [];
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/[一-鿿A-Za-z0-9]/.test(c)) {
      chars.push(c);
      map.push(i);
    }
  }
  return { norm: chars.join(''), map };
}

// 找最大 L 使「prev 尾 L 字 == cur 頭 L 字」(正規化後)。回傳 L(0 = 沒重疊)。
// 這正是 lead-in overlap 的模型:cur 頭 = prev 尾的同段音訊。
function _suffixPrefixOverlap(prevNorm, curNorm, minMatch, maxCap = 600) {
  // maxCap 隨 overlap 放大:overlap 180s ≈ 950 字重疊,寫死 600 會去不乾淨 → 殘留重複。
  const maxL = Math.min(prevNorm.length, curNorm.length, maxCap);
  for (let L = maxL; L >= minMatch; L--) {
    if (prevNorm.slice(prevNorm.length - L) === curNorm.slice(0, L)) return L;
  }
  return 0;
}

// ── 模糊去重(容忍「同段音訊轉成不同字」:廢液↔費用、L-pad↔AirPods)──────────────
// exact suffix==prefix 在 LLM 轉錄上常失敗(同段每次用字會變)。改句級 LCS 相似度比對:
// cur 開頭逐句去 prev 尾段找相似句(sim≥門檻),連續命中=重疊,截在第一句找不到對應的新內容。
function _lcsLen(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1).fill(0);
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : (prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1]);
    }
    prev = cur;
  }
  return prev[m];
}
function _sim(a, b) { return _lcsLen(a, b) / Math.max(a.length, b.length, 1); }
function _normSent(s) { return s.replace(/[^一-鿿A-Za-z0-9]/g, ''); }
function _splitSents(s) {
  return s.split(/(?<=[。！？!?\n])/).map(t => t.trim()).filter(t => _normSent(t).length >= 4);
}
// 回傳 curHead 開頭要剪掉的「原始字元數」(0 = 沒重疊 / 沒把握)
function _fuzzyPrefixOverlap(prevTail, curHead, simThreshold = 0.6) {
  const prevSents = _splitSents(prevTail);
  const curSents = _splitSents(curHead);
  if (prevSents.length < 2 || curSents.length < 2) return 0;
  const prevNorm = prevSents.map(_normSent);
  let lastMatchedCur = -1;
  let searchFrom = 0;     // prev 指標單調前進(重疊區順序一致)
  let misses = 0;
  for (let ci = 0; ci < curSents.length && ci < 40; ci++) {
    const cn = _normSent(curSents[ci]);
    if (cn.length < 4) continue;
    let found = -1;
    for (let pi = searchFrom; pi < prevNorm.length; pi++) {
      if (_sim(cn, prevNorm[pi]) >= simThreshold) { found = pi; break; }
    }
    if (found >= 0) { lastMatchedCur = ci; searchFrom = found + 1; misses = 0; }
    else if (lastMatchedCur >= 1) { if (++misses >= 2) break; } // 容忍 1 句改寫橋,連 2 句找不到才停
  }
  if (lastMatchedCur < 1) return 0; // 至少連 2 句命中才有把握剪
  // 算到「最後命中句」結尾的原始字元位置
  let offset = 0;
  for (let i = 0; i <= lastMatchedCur; i++) {
    const at = curHead.indexOf(curSents[i], offset);
    if (at < 0) break;
    offset = at + curSents[i].length;
  }
  return offset;
}

/**
 * @param {string[]} texts 各段逐字稿(index 對齊段序)
 * @param {object} opts { overlapSec, charsPerSec, minMatch, okFlags }
 * @param {Function|null} llmAnchorFn async (prevTail, curHead) => anchorStr | 'NONE'
 * @returns {Promise<{ texts: string[], info: Array<{cut,cutChars,method}> }>}
 */
async function stitchSegments(texts, opts = {}, llmAnchorFn = null) {
  const {
    overlapSec = 60,
    charsPerSec = 6,   // 中文語速估 ~6 字/s(偏高,寧可多看一點窗)
    minMatch = 24,     // 至少相符 N 正規化字才算重疊(避免短語誤剪)
    okFlags = null,
  } = opts;

  const window = Math.max(300, Math.ceil(overlapSec * charsPerSec)) * 2; // 看的字元窗(寬鬆)
  const out = texts.slice();
  const info = texts.map(() => ({ cut: false, cutChars: 0, method: null }));

  for (let i = 1; i < texts.length; i++) {
    const prev = texts[i - 1];
    const cur = texts[i];
    if (!prev || !cur) continue;
    if (okFlags && (!okFlags[i] || !okFlags[i - 1])) continue;
    if (cur.startsWith('[此段轉錄失敗') || cur.includes('已自動截斷')) continue;
    if (prev.includes('已自動截斷')) continue; // 上段尾被截 → 重疊不可靠,不剪

    const prevTail = prev.slice(-window);
    const curHead = cur.slice(0, window);
    const { norm: prevNorm } = _normalizeWithMap(prevTail);
    const { norm: curNorm, map: curMap } = _normalizeWithMap(curHead);

    // ① 精確 suffix==prefix(同段轉出相同字時最準)
    const cutNormLen = _suffixPrefixOverlap(prevNorm, curNorm, minMatch, window);
    let origCut = cutNormLen > 0 ? (curMap[cutNormLen] ?? 0) : 0;
    let method = origCut > 0 ? 'string' : null;

    // ② 模糊句級(精確法 under-cut 時補):同段被轉成不同字(廢液↔費用)→ exact 對不上,
    //    但句級 LCS 相似度抓得到。expect = overlap 秒數 × ~4 字/秒的下界,精確法低於一半就試 fuzzy。
    const expectChars = overlapSec * 4;
    if (origCut < expectChars * 0.5) {
      const fz = _fuzzyPrefixOverlap(prevTail, curHead);
      if (fz > origCut) { origCut = fz; method = 'fuzzy'; }
    }

    // ③ 都不夠 → LLM 錨點 fallback(只定位不重寫,找不到就不剪)
    if (origCut === 0 && llmAnchorFn) {
      try {
        const anchor = await llmAnchorFn(prevTail, curHead);
        const aNorm = anchor ? _normalizeWithMap(anchor).norm : '';
        if (aNorm && anchor.trim().toUpperCase() !== 'NONE' && aNorm.length >= 6) {
          const idx = curNorm.indexOf(aNorm.slice(0, Math.min(aNorm.length, 16)));
          if (idx > 0) { origCut = curMap[idx] ?? 0; method = 'llm'; }
        }
      } catch (_) { /* LLM 失敗 → 不剪 */ }
    }

    if (origCut > 0 && origCut < cur.length) {
      // cut 點 = overlap/新內容交界;只去掉開頭殘留標點/空白,不往後 snap(會吃掉只有一句的新內容)。
      const trimmed = cur.slice(origCut).replace(/^[\s。!?！？，、]+/, '');
      if (trimmed.length > 10) { // 剪完還有實質內容才採用,否則保留全文(不誤刪)
        out[i] = trimmed;
        info[i] = { cut: true, cutChars: origCut, method };
      }
    }
  }

  return { texts: out, info };
}

module.exports = { stitchSegments, _suffixPrefixOverlap, _normalizeWithMap };

// ── self-test:node transcriptStitch.js ───────────────────────────────────────
if (require.main === module) {
  (async () => {
    // 模擬:overlap 區(★)在 prev 尾 + cur 頭重複
    const overlap = '那我們看下一頁,這個訂單對我們整體影響很大,八月份會到九十五K。';
    const prev = '前面講完越南的部分基本上穩定了。' + overlap;
    const cur = overlap + '那接下來針對重大專案來報告,第一個是徐州連接器。';
    const r = await stitchSegments([prev, cur], { overlapSec: 60 });
    console.log('cut info:', JSON.stringify(r.info[1]));
    console.log('seg2 原長:', cur.length, '剪後:', r.texts[1].length);
    console.log('剪後 seg2:', r.texts[1]);
    console.log(r.texts[1].startsWith('那接下來') ? '✅ 重疊去除正確' : '❌ 去除錯誤');
    // 無重疊案例:不該剪
    const r2 = await stitchSegments(['完全不同的內容甲乙丙丁戊', '另一段毫不相干的內容己庚辛壬癸']);
    console.log(r2.info[1].cut === false ? '✅ 無重疊不誤剪' : '❌ 誤剪');
  })();
}
