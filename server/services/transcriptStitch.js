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
function _suffixPrefixOverlap(prevNorm, curNorm, minMatch) {
  const maxL = Math.min(prevNorm.length, curNorm.length, 600);
  for (let L = maxL; L >= minMatch; L--) {
    if (prevNorm.slice(prevNorm.length - L) === curNorm.slice(0, L)) return L;
  }
  return 0;
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

    let cutNormLen = _suffixPrefixOverlap(prevNorm, curNorm, minMatch);
    let method = cutNormLen > 0 ? 'string' : null;

    // 字串法找不到 → LLM 錨點 fallback(只定位不重寫,找不到就不剪)
    if (cutNormLen === 0 && llmAnchorFn) {
      try {
        const anchor = await llmAnchorFn(prevTail, curHead);
        const aNorm = anchor ? _normalizeWithMap(anchor).norm : '';
        if (aNorm && anchor.trim().toUpperCase() !== 'NONE' && aNorm.length >= 6) {
          const idx = curNorm.indexOf(aNorm.slice(0, Math.min(aNorm.length, 16)));
          if (idx > 0) { cutNormLen = idx; method = 'llm'; }
        }
      } catch (_) { /* LLM 失敗 → 不剪 */ }
    }

    if (cutNormLen > 0 && cutNormLen < curMap.length) {
      // 正規化 cut 位置 → 原始字串位置。cut 點就是 overlap/新內容的交界,不再往後 snap
      // (往後吸句界會在「新內容只有一句」時吃掉整段)。只去掉開頭殘留的標點/空白。
      const origCut = curMap[cutNormLen] ?? 0;
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
