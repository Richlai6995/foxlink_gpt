'use strict';

/**
 * PM(貴金屬)排程任務自動 seed
 *
 * Server 啟動時 idempotent 註冊一系列 PM 平台的預設排程(news / macro / daily report / weekly / monthly)。
 *
 * 設計原則:
 *   - 只「INSERT if not exists」by name — 不覆蓋 admin 既有調整(prompt / schedule / pipeline_json 一旦動過就不再 touch)
 *   - status='paused' 預設 — admin 必須先檢查 prompt / 補 kb_id / 加收件人才 enable
 *   - owner = 預設 admin user(env DEFAULT_ADMIN_ACCOUNT)
 *   - 每個 task 含 _seed_version,跟程式裡的 SEED_VERSION 比對,差距太大 admin 可手動觸發 reseed(目前不自動)
 *
 * 包含的任務(Phase 2 D10-D14 + Phase 3.1 全網收集):
 *   - [PM] 每日金屬新聞抓取(D10)— multi_time 9:00 / 14:30        → KB: PM-新聞庫
 *   - [PM] 總體經濟指標日抓(D11)— daily 09:00
 *   - [PM] 每日金屬日報(D12)— daily 18:00                        → KB: PM-分析庫
 *   - [PM] 週報(D14)— weekly Mon 08:30                            → KB: PM-分析庫
 *   - [PM] 月報(D14)— monthly day 1 09:00                         → KB: PM-分析庫
 *   - [PM] 全網金屬資料收集(P3.1)— daily 06:00 + interval 8 小時 → KB: PM-原始資料庫
 *
 * 註:
 *   - 依賴 pmKnowledgeBaseSeed 先跑(autoSeedPmKnowledgeBases 回傳 kbMap),
 *     kb_write 節點的 kb_id 直接從 kbMap 帶入,admin 不用再手動選
 *   - 若 kbMap 缺對應 KB(seed 失敗 / 被刪),kb_id 留空,admin 還是可以手動補
 *   - 對於既有任務(已 INSERT 過的)會在最後跑一次 patchExistingTaskKbIds:
 *     掃 pipeline_json 的 kb_write 節點,若 kb_id 空但 kb_name 有值且能對到 kbMap,自動填回去
 *   - 部分 prompt 引用了 {{scrape:URL}} 以 LLM tool 自動抓網頁,前提是來源 URL 在公司防火牆白名單
 */

const SEED_VERSION = '1.0.0';

function newNodeId(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 8)}`; }

// ── [PM] 每日金屬新聞抓取(D10)──────────────────────────────────────────────
function buildNewsTask(kbMap, models = {}) {
  const flashModel = models.flash || 'flash';
  const dbWriteId = newNodeId('dbw');
  const kbWriteId = newNodeId('kbw');

  const prompt = `今天是 {{date}}。請抓取以下來源,過濾出與「銅(CU)/ 鋁(AL)/ 鎳(NI)/ 錫(SN)/ 鋅(ZN)/ 鉛(PB)/ 金(AU)/ 銀(AG)/ 鉑(PT)/ 鈀(PD)/ 銠(RH)」相關的近 24 小時新聞與專業評論。

⏰ **時間 cutoff(嚴格遵守)**:**published_at 必須 ≥ {{date}} 往前 7 天**。
   超過 7 天的舊文章(例:WPIC quarterly outlook 上次發在 3 月、JM 早期 expert insight)**不要抽出來**,
   即使該 source 頁面看到也跳過。理由:採購要的是「新聞快訊」,7 天前的東西沒時效性,佔列表位置。
   特別注意:WPIC / JM expert-insights 的 article published_at 經常是 1-3 個月前,**這些舊 article 一律跳過**;
   只抽他們「近 7 天」內新發的(若沒有就空過,不要塞舊的湊筆數)。

═══ 資料源 1:Mining.com 全球礦業新聞(RSS,主源)═══
{{fetch:https://www.mining.com/feed/}}
↑ 36+ items 含完整內文,涵蓋全球金屬 / 礦業 / 採礦公司動態。**主新聞源**

═══ 資料源 2:MoneyDJ 商品原物料(中文,台灣財經角度)═══
{{scrape:https://www.moneydj.com/KMDJ/News/NewsRealList.aspx?a=MB07}}
↑ MoneyDJ 商品原物料分類,含時間 + 標題列表(中文台灣商品行情)

═══ 資料源 3:SMM 上海有色網(中文,中國市場視角)═══
{{scrape:https://news.smm.cn/}}
↑ 上海有色網「金属要闻」首頁,含當日中國有色金屬要聞

═══ 資料源 4:日經中文網 大宗商品(政經視角)═══
{{fetch:https://zh.cn.nikkei.com/politicsaeconomy/commodity.html}}
↑ 日經「政經觀察 > 大宗商品」,含日期 + 文章 URL + 摘要

注意:**KITCO Latest News 與 MarketWatch 已驗證無法爬**(KITCO 列表頁 JS-rendered,
MarketWatch 對非登入回 401)。Mining.com RSS 涵蓋同類新聞,可作 KITCO 替代。

═══ 資料源 5:PGM(Pt/Pd/Rh)機構級評論(權威性 > 一般新聞)═══
{{scrape:https://platinuminvestment.com/news}}
{{scrape:https://matthey.com/news/expert-insights}}
{{scrape:https://matthey.com/products-and-markets/pgms-and-circularity/pgm-markets}}
↑ WPIC 是 World Platinum Investment Council,提供 quarterly 鉑金供需報告;
  matthey expert-insights 是 Johnson Matthey PGM 專家文章。兩者更新頻率不如每日新聞,
  但每篇都是業界基準級分析,**找到 PGM 相關文章請務必抽出**:
   - source = "WPIC" 或 "JohnsonMatthey"
   - related_metals 一定要標 ["PT"] / ["PD"] / ["RH"] 對應金屬
   - sentiment_label 多半是 "neutral"(機構分析較中性)

═══ 任務 ═══
從以上 7 個資料源,**選 12-25 篇最相關的金屬新聞**(不是全部都抽 — 過多會浪費 token)。
每篇相關新聞做以下處理:
1. 抽出 title / url / source / published_at
2. **content = 原文整段拷貝**(英文 / 中文 / 日文 等,LLM 看到的原始文章 body 直接放,
   **不翻譯、不重寫、不濃縮**;單篇上限 3000 字,夠長就 OK,別只給一兩句)
3. **summary = 繁體中文濃縮摘要 80-150 字**(這是 content 的中文濃縮,跟 content 不同)
4. 情緒打分 sentiment_score(-1.0 ~ +1.0,LLM 判斷對該金屬「未來 1-7 天」價格的影響面)
5. 對應 sentiment_label("very_negative" / "negative" / "neutral" / "positive" / "very_positive")
6. 標註 related_metals(代碼陣列,例 ["CU","AL"])
7. 列出 topics(主題標籤,例 ["supply","policy","fed","inventory"])

⚠️ **content vs summary 必須是不同欄位不同內容**:
   - content:**原文 raw text**(英文新聞給英文 / 中文新聞給中文,直接拷貝整段 1500-3000 字)
   - summary:**LLM 用繁體中文寫的 80-150 字濃縮**
   兩者**內容不同、語言可能不同、長度差距大**(content 是 summary 的 10-30 倍)。
   採購會用 content 看完整原文做引用,用 summary 快速掃過 — 兩者都重要,不要混為一談。

═══ ⚠️ 輸出格式(務必嚴格遵守,違反會導致 0 筆寫入)═══

**必須輸出兩段**:

**A. 繁體中文簡報摘要**(給人看,放最前面,200-400 字即可,不要太長)

**B. JSON 落地段(MANDATORY,不可省略)**:在 markdown 末尾用 \`\`\`json ... \`\`\` 包起來。
   即使 A 段寫得再多,**B 段一定要有**,沒有 = pipeline 0 inserted = 等於沒跑。
   無新聞時輸出 \`\`\`json [] \`\`\`(空陣列也要包 fence),不可只寫文字「今日無新聞」。

JSON 格式範例(注意 content 是英文原文整段、summary 是中文濃縮):

\`\`\`json
[
  {
    "url": "https://www.mining.com/some-article",
    "title": "China's silver imports surge 78% in March...",
    "source": "Mining.com",
    "published_at": "2026-04-28T08:00:00Z",
    "language": "en",
    "content": "China's silver imports surged 78% in March as investors and manufacturers scrambled to secure physical metal. Customs data released Tuesday showed total inflows reached 480 metric tons, the highest March figure in a decade. The surge comes amid growing industrial demand from solar panel manufacturers and electronics producers, who together account for over 60% of China's industrial silver consumption. Analysts at the China Nonferrous Metals Industry Association noted that ... (整篇英文原文 1500-3000 字,直接從 source 拷貝過來,不翻譯不重寫)",
    "summary": "中國 3 月白銀進口量大增 78%,主因投資者與太陽能 / 電子業者搶實體金屬。海關數據顯示總流入量達 480 公噸,創 10 年同期高。中國有色金屬工業協會分析師指出工業需求(太陽能 + 電子)佔白銀消費 60% 以上。",
    "sentiment_score": 0.6,
    "sentiment_label": "positive",
    "related_metals": ["AG"],
    "topics": ["demand","china","industrial"]
  }
]
\`\`\`

═══ 自我檢查清單(輸出前最後一遍)═══
- [ ] 我有寫 A 段中文簡報嗎?
- [ ] **我有在末尾寫 \`\`\`json [...] \`\`\` 區塊嗎?**(這條失敗 = 0 inserted)
- [ ] JSON 內每筆都有 url + title + source + published_at + content + summary?
- [ ] **content 是原文整段拷貝(1500-3000 字)而非縮減版?**(這條失敗 = KB 全文只剩 60 字無法引用)
- [ ] **summary 跟 content 不一樣?**(summary 是 content 的中文濃縮,不該幾乎相同)
- [ ] published_at 是 ISO 格式(YYYY-MM-DDTHH:MM:SSZ)?
- [ ] **每筆 published_at 都在 {{date}} 往前 7 天內?**(超過 7 天的 WPIC / JM 舊評論一律刪掉,不要佔位)
- [ ] 沒有把 A 段內容跟 JSON 段混在一起?(JSON 必須是獨立 \`\`\`json ... \`\`\` block)`;

  const pipeline = [
    {
      id: dbWriteId,
      type: 'db_write',
      label: '寫入 pm_news 表',
      table: 'pm_news',
      // upsert by url_hash:重複 URL 改成更新 summary/sentiment 而非 silent skip
      // 不然 LLM 抓回一樣的 source 會撞 UQ_NEWS_URL_HASH 全部 skipped,
      // 跑 5 次都看不到新資料(這就是 user 觀察到的「跑成功但匯總沒更新」)
      operation: 'upsert',
      key_columns: ['url_hash'],
      input: '{{ai_output}}',
      on_row_error: 'skip',
      max_rows: 200,
      column_mapping: [
        { jsonpath: '$.url',             column: 'url',             transform: '',                required: true },
        { jsonpath: '$.url',             column: 'url_hash',        transform: 'sha256',          required: true },
        { jsonpath: '$.title',           column: 'title',           transform: '' },
        { jsonpath: '$.source',          column: 'source',          transform: '' },
        { jsonpath: '$.published_at',    column: 'published_at',    transform: 'date' },
        { jsonpath: '$.language',        column: 'language',        transform: '' },
        { jsonpath: '$.summary',         column: 'summary',         transform: '' },
        { jsonpath: '$.sentiment_score', column: 'sentiment_score', transform: 'number' },
        { jsonpath: '$.sentiment_label', column: 'sentiment_label', transform: '' },
        { jsonpath: '$.related_metals',  column: 'related_metals',  transform: 'array_join_comma' },
        { jsonpath: '$.topics',          column: 'topics',          transform: 'array_join_comma' },
      ],
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-新聞庫',
      kb_id: (kbMap && kbMap.get('PM-新聞庫')) || '',
      kb_name: 'PM-新聞庫',
      title_field: '$.title',
      url_field: '$.url',
      summary_field: '$.summary',
      content_field: '$.content',
      source_field: '$.source',
      published_at_field: '$.published_at',
      chunk_strategy: 'mixed',
      dedupe_mode: 'url',
      max_chunks_per_run: 100,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 每日金屬新聞抓取',
    schedule_type: 'multi_time',
    schedule_hour: 9,
    schedule_minute: 0,
    schedule_times_json: JSON.stringify(['09:00', '14:30']),
    schedule_interval_hours: null,
    model: flashModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 金屬新聞日報 — {{date}}',
    email_body: '今日金屬新聞重點如下,完整資料已落地到 pm_news + KB(若已配置)。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── 通用 by-source 新聞 task pipeline 建構(2026-04-29 新增 B + E 策略)──
// 每個 source 一 task,prompt 專注該 source,LLM 不容易偷懶
// pm_news + KB:PM-新聞庫 沿用 url_hash / source_hash dedupe → 跨 task 自動去重
function _buildBySourceNewsPipeline(kbMap) {
  const dbWriteId = newNodeId('dbw');
  const kbWriteId = newNodeId('kbw');
  return [
    {
      id: dbWriteId, type: 'db_write', label: '寫入 pm_news 表',
      table: 'pm_news', operation: 'upsert', key_columns: ['url_hash'],
      input: '{{ai_output}}', on_row_error: 'skip', max_rows: 200,
      column_mapping: [
        { jsonpath: '$.url',             column: 'url',             transform: '',                required: true },
        { jsonpath: '$.url',             column: 'url_hash',        transform: 'sha256',          required: true },
        { jsonpath: '$.title',           column: 'title',           transform: '' },
        { jsonpath: '$.source',          column: 'source',          transform: '' },
        { jsonpath: '$.published_at',    column: 'published_at',    transform: 'date' },
        { jsonpath: '$.language',        column: 'language',        transform: '' },
        { jsonpath: '$.summary',         column: 'summary',         transform: '' },
        { jsonpath: '$.sentiment_score', column: 'sentiment_score', transform: 'number' },
        { jsonpath: '$.sentiment_label', column: 'sentiment_label', transform: '' },
        { jsonpath: '$.related_metals',  column: 'related_metals',  transform: 'array_join_comma' },
        { jsonpath: '$.topics',          column: 'topics',          transform: 'array_join_comma' },
      ],
    },
    {
      id: kbWriteId, type: 'kb_write', label: '寫入 PM-新聞庫',
      kb_id: (kbMap && kbMap.get('PM-新聞庫')) || '', kb_name: 'PM-新聞庫',
      title_field: '$.title', url_field: '$.url',
      summary_field: '$.summary', content_field: '$.content',
      source_field: '$.source', published_at_field: '$.published_at',
      chunk_strategy: 'mixed', dedupe_mode: 'url', max_chunks_per_run: 100,
      on_row_error: 'skip', input: '{{ai_output}}',
    },
  ];
}

// 共用 prompt 後段(輸出格式 + 自我檢查清單)
// cutoffDays 預設 7(daily 新聞);PGM 評論等更新頻率低的 source 可放寬到 60-90
function _commonNewsPromptTail(targetMin, targetMax, cutoffDays = 7) {
  return `

═══ ⚠️ 輸出格式(務必嚴格遵守)═══

A. **繁體中文簡報摘要**(給人看,放最前面,200-300 字)

B. **JSON 落地段(MANDATORY)**:markdown 末尾用 \`\`\`json ... \`\`\` 包起來。
   即使 A 段寫得再多,**B 段一定要有**,沒有 = pipeline 0 inserted。
   無新聞時輸出 \`\`\`json [] \`\`\`(空陣列也要包 fence),不可只寫文字。

每筆 article 結構:
\`\`\`json
[
  {
    "url": "https://www.example.com/article-specific-url",
    "title": "article 標題",
    "source": "Mining.com",
    "published_at": "2026-04-29T08:00:00Z",
    "language": "en",
    "content": "原文整段拷貝(英文 / 中文 / 日文等),1500-3000 字,不翻譯不重寫。",
    "summary": "繁體中文 80-150 字濃縮摘要(跟 content 不同)",
    "sentiment_score": 0.4,
    "sentiment_label": "positive",
    "related_metals": ["CU","AU"],
    "topics": ["supply","policy"]
  }
]
\`\`\`

═══ 規則(嚴格遵守)═══
- **目標 ${targetMin}-${targetMax} 篇**(這是 MUST,不是 nice-to-have;少於 ${targetMin} 篇就再讀一次 source 多挖)
- **published_at 必須在 {{date}} 往前 ${cutoffDays} 天內**,超過 ${cutoffDays} 天的舊 article 一律跳過
- **url 必須是具體 article URL**,不是首頁 / list 頁(如果上游給你的 source 只有 list 頁,**逐個 article URL 點進去抓**,不要把 list 頁 url 當 article 抽出來)
- **content 必須是真 article body**,≥ 200 字真實文字 / 評論 / 分析。報價快照 / 牌價公告不算
- **content 跟 summary 是不同欄位不同內容**(content 1500-3000 字原文,summary 80-150 字繁中濃縮)

═══ 自我檢查清單(輸出前最後一遍)═══
- [ ] B 段 \`\`\`json [...] \`\`\` 區塊有寫?
- [ ] 篇數達 ${targetMin}-${targetMax}?(LLM 偷懶問題:不要只給 ${targetMin-2} 篇就交差)
- [ ] 每筆 url 是具體 article 不是首頁?
- [ ] 每筆 published_at 在 ${cutoffDays} 天內?
- [ ] 每筆 content 是 ≥ 200 字真 article body 不是報價快照?`;
}

// ── [PM] 新聞 Mining.com(RSS-first,主源)──────────────────────────────────
function buildNewsMiningComTask(kbMap, models = {}) {
  const flashModel = models.flash || 'flash';
  const prompt = `今天是 {{date}}。請從 Mining.com RSS 抓取近 7 天內與「銅(CU)/鋁(AL)/鎳(NI)/錫(SN)/鋅(ZN)/鉛(PB)/金(AU)/銀(AG)/鉑(PT)/鈀(PD)/銠(RH)」相關的英文新聞。

═══ 唯一資料源 — Mining.com RSS Feed(36+ items 含完整內文)═══
{{fetch:https://www.mining.com/feed/}}

↑ 這是結構化的 article list,**每個 <item> 已經是一篇完整 article**(含 title / link / pubDate / description / content)。
  不需要去推理「哪些是 article」,直接逐一處理 RSS items。
  RSS feed 多數情況提供 36+ items,你應該至少處理 15-20 個跟金屬相關的(過濾掉純股市 / 非金屬礦業的)。${_commonNewsPromptTail(15, 20)}`;

  return {
    name: '[PM] 新聞 Mining.com',
    schedule_type: 'daily',
    schedule_hour: 9,
    schedule_minute: 0,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: flashModel,
    prompt,
    output_type: 'text', file_type: null, filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 新聞 Mining.com — {{date}}',
    email_body: '今日 Mining.com 新聞已抓取完成,寫入 pm_news + KB:PM-新聞庫。',
    status: 'paused',
    pipeline_json: JSON.stringify(_buildBySourceNewsPipeline(kbMap)),
  };
}

// ── [PM] 新聞 Nikkei(中文網大宗商品)──────────────────────────────────────
function buildNewsNikkeiTask(kbMap, models = {}) {
  const flashModel = models.flash || 'flash';
  const prompt = `今天是 {{date}}。請從日經中文網「政經 > 大宗商品」抓取近 7 天金屬相關新聞(政經角度,中文)。

═══ 唯一資料源 ═══
{{fetch:https://zh.cn.nikkei.com/politicsaeconomy/commodity.html}}

↑ 列表頁,需從上面 list 抽出 article URL,**逐個點進去抓內文**(不要把 list 頁 url 當 article 抽出來)。
  從列表挑出與「銅 / 鋁 / 鎳 / 錫 / 鋅 / 鉛 / 金 / 銀 / 鉑 / 鈀 / 銠」相關的 article(政經角度為主,有些是貿易戰 / 制裁 / 政策對金屬影響的)。${_commonNewsPromptTail(5, 10)}`;

  return {
    name: '[PM] 新聞 Nikkei',
    schedule_type: 'daily',
    schedule_hour: 9, schedule_minute: 30,
    schedule_times_json: null, schedule_interval_hours: null,
    model: flashModel, prompt,
    output_type: 'text', file_type: null, filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 新聞 Nikkei — {{date}}',
    email_body: '今日日經中文網大宗商品新聞已抓取。',
    status: 'paused',
    pipeline_json: JSON.stringify(_buildBySourceNewsPipeline(kbMap)),
  };
}

// ── [PM] 新聞 SMM(上海有色網,中文)─────────────────────────────────────
function buildNewsSmmTask(kbMap, models = {}) {
  const flashModel = models.flash || 'flash';
  const prompt = `今天是 {{date}}。請從上海有色網(SMM)抓取近 7 天有色金屬相關新聞(中國市場視角,中文)。

═══ 唯一資料源 ═══
{{scrape:https://news.smm.cn/}}

↑ SMM「金属要闻」首頁,這是 list 頁。**請從首頁挑出當日各 article 的具體 URL,逐個點進去抓內文**。
  ⚠️ **不要把 \`https://news.smm.cn/\`(首頁)當 article URL 抽出來**!每篇 article 都有自己的具體 URL(通常是 /news/<id> 之類)。
  抓 5-10 篇跟 11 個金屬相關的中國市場動態(現貨價、政策、產能、進出口等)。${_commonNewsPromptTail(5, 10)}`;

  return {
    name: '[PM] 新聞 SMM',
    schedule_type: 'daily',
    schedule_hour: 10, schedule_minute: 0,
    schedule_times_json: null, schedule_interval_hours: null,
    model: flashModel, prompt,
    output_type: 'text', file_type: null, filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 新聞 SMM — {{date}}',
    email_body: '今日 SMM 上海有色網新聞已抓取。',
    status: 'paused',
    pipeline_json: JSON.stringify(_buildBySourceNewsPipeline(kbMap)),
  };
}

// ── [PM] 新聞 MoneyDJ(台灣財經,商品原物料)──────────────────────────────
function buildNewsMoneyDjTask(kbMap, models = {}) {
  const flashModel = models.flash || 'flash';
  const prompt = `今天是 {{date}}。請從 MoneyDJ「商品原物料」分類抓取近 7 天金屬相關新聞(台灣財經角度,中文)。

═══ 唯一資料源 ═══
{{scrape:https://www.moneydj.com/KMDJ/News/NewsRealList.aspx?a=MB07}}

↑ MoneyDJ 商品原物料分類列表頁。**請從上面 list 抽出每篇 article 的具體 URL,逐個點進去抓內文**。
  ⚠️ **不要把 list 頁 URL 當 article 抽出來**(那是 list 不是 article)。
  挑出與 11 個金屬相關的 5-10 篇(LME 行情、台灣供應鏈影響、台股相關公司動態等)。${_commonNewsPromptTail(5, 10)}`;

  return {
    name: '[PM] 新聞 MoneyDJ',
    schedule_type: 'daily',
    schedule_hour: 10, schedule_minute: 30,
    schedule_times_json: null, schedule_interval_hours: null,
    model: flashModel, prompt,
    output_type: 'text', file_type: null, filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 新聞 MoneyDJ — {{date}}',
    email_body: '今日 MoneyDJ 商品原物料新聞已抓取。',
    status: 'paused',
    pipeline_json: JSON.stringify(_buildBySourceNewsPipeline(kbMap)),
  };
}

// ── [PM] 新聞 PGM評論(WPIC + matthey,週一/週三)─────────────────────
function buildNewsPgmCommentaryTask(kbMap, models = {}) {
  const flashModel = models.flash || 'flash';
  const prompt = `今天是 {{date}}。請從 WPIC + Johnson Matthey 抓取近 7 天 PGM(鉑 PT / 鈀 PD / 銠 RH)機構級評論文章。

═══ 資料源 ═══
{{scrape:https://platinuminvestment.com/news}}
{{scrape:https://matthey.com/news/expert-insights}}
{{scrape:https://matthey.com/products-and-markets/pgms-and-circularity/pgm-markets}}

↑ 從 list 頁抽出每篇 article 的具體 URL,**逐個點進去抓內文**(不要把 list 頁 URL 當 article)。
  WPIC 是 World Platinum Investment Council 的官方 quarterly outlook;
  matthey expert-insights 是 Johnson Matthey PGM 專家分析。**機構級報告權威性 > 一般新聞**。
  - source = "WPIC" 或 "JohnsonMatthey"
  - related_metals 必須含 ["PT"] / ["PD"] / ["RH"] 至少一個
  - sentiment 多半 neutral(機構分析較中性)
  - **published_at 在 60 天內**(WPIC quarterly 是季度發布,JM expert-insights 月度發,
    60 天 cutoff 能涵蓋上一季 outlook + 過去兩個月專家觀點;7 天太嚴會常常空抓)${_commonNewsPromptTail(1, 5, 60)}

⚠️ 機構級評論更新頻率不像每日新聞那麼高,**真的沒有 60 天內 article 才輸出 \`\`\`json [] \`\`\`,不要硬塞超過 60 天的舊文**。
   url_hash dedupe 會把已抓過的同篇自動 skip,所以不必擔心同篇 quarterly 每次都被重塞。`;

  return {
    name: '[PM] 新聞 PGM評論',
    // 週一 + 週三 09:30(機構級評論更新頻率低,daily 跑浪費)
    schedule_type: 'cron_raw',
    schedule_hour: 9, schedule_minute: 30,
    schedule_times_json: null, schedule_interval_hours: null,
    schedule_cron_expr: '30 9 * * 1,3',
    model: flashModel, prompt,
    output_type: 'text', file_type: null, filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 新聞 PGM評論 — {{date}}',
    email_body: '本期 WPIC + Johnson Matthey PGM 評論已抓取。',
    status: 'paused',
    pipeline_json: JSON.stringify(_buildBySourceNewsPipeline(kbMap)),
  };
}

// ── [PM] 總體經濟指標日抓(D11 — 設計留 placeholder,實作在 D11)──────────
function buildMacroTask(models = {}) {
  const flashModel = models.flash || 'flash';
  const dbWriteId = newNodeId('dbw');
  const prompt = `今天是 {{date}}。請取得以下總體經濟指標的「最新可得值」:

═══ 指標清單 ═══
- DXY(美元指數)
- VIX(恐慌指數)
- FED_FUNDS(聯邦基金利率,%)
- UST10Y(美國 10 年期公債殖利率,%)
- WTI(WTI 原油,USD/barrel)
- EURUSD(歐元兌美元)
- TWDUSD(美元兌台幣)

═══ 資料源(可選用)═══
{{scrape:https://tradingeconomics.com/united-states/currency}}
{{scrape:https://tradingeconomics.com/united-states/government-bond-yield}}
{{scrape:https://www.investing.com/economic-calendar/}}

═══ 輸出 ═══
A. 一段繁體中文簡報(列出每個指標的當前值 + 與前日 / 上週的變化)
B. markdown 末尾另外輸出 \`\`\`json [...] \`\`\` 給 db_write 落地:

\`\`\`json
[
  {
    "indicator_code": "DXY",
    "indicator_name": "美元指數",
    "as_of_date": "{{date}}",
    "value": 104.23,
    "unit": "index",
    "source": "TradingEconomics",
    "source_url": "https://tradingeconomics.com/..."
  }
]
\`\`\`

若任何指標抓不到,該欄 value=null + source_url 寫 "unavailable"(其他欄正常輸出)。`;

  const pipeline = [
    {
      id: dbWriteId,
      type: 'db_write',
      label: '寫入 pm_macro_history',
      table: 'pm_macro_history',
      operation: 'upsert',
      // 同一指標一天一筆。原本 key 包 source 但 LLM 偶爾漏 source 整列就 skip,
      // 現在 (indicator_code, as_of_date) 就足夠唯一。source 改非必填,LLM 漏寫也照寫。
      key_columns: ['indicator_code', 'as_of_date'],
      input: '{{ai_output}}',
      on_row_error: 'skip',
      max_rows: 50,
      column_mapping: [
        { jsonpath: '$.indicator_code', column: 'indicator_code', transform: 'upper', required: true },
        { jsonpath: '$.indicator_name', column: 'indicator_name', transform: '' },
        { jsonpath: '$.as_of_date',     column: 'as_of_date',     transform: 'date',  required: true },
        { jsonpath: '$.value',          column: 'value',          transform: 'number' },
        { jsonpath: '$.unit',           column: 'unit',           transform: '' },
        { jsonpath: '$.source',         column: 'source',         transform: '' },
        { jsonpath: '$.source_url',     column: 'source_url',     transform: '' },
        // 註:不寫 is_estimated — pm_macro_history schema 沒這欄,
        // 連同 prompt 也拿掉(2026-04-28 修)
      ],
    },
  ];

  return {
    name: '[PM] 總體經濟指標日抓',
    schedule_type: 'daily',
    schedule_hour: 9,
    schedule_minute: 0,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: flashModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 總體經濟指標日報 — {{date}}',
    email_body: '今日 7 大總體經濟指標已落地。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 每日金屬日報(D12)─────────────────────────────────────────────────
// Pipeline:ai 主回應 → db_write(forecast_history)→ db_write(pm_analysis_report)
//          → generate_file DOCX → kb_write(PM-分析庫)
function buildDailyReportTask(kbMap, models = {}) {
  const proModel = models.pro || 'pro';
  const dbForecastId  = newNodeId('dbw');
  const dbReportId    = newNodeId('dbw');
  const generateId    = newNodeId('gen');
  const kbWriteId     = newNodeId('kbw');

  const prompt = `今天是 {{date}}({{weekday}}),撰寫一份「金屬市場日報」。

═══ 上下文(admin 啟用前請把以下 placeholder 改成實際存在的 KB 名)═══
{{kb:PM-新聞庫}}    ← 近 24 小時新聞 RAG
{{kb:PM-分析庫}}    ← 過去日報沿革 RAG(若有)

═══ 撰寫要求 ═══
1. 開場 200 字市場概覽(整體情緒 + 主旋律事件)
2. 11 種金屬(CU 銅 / AL 鋁 / NI 鎳 / SN 錫 / ZN 鋅 / PB 鉛 / AU 金 / AG 銀 / PT 鉑 / PD 鈀 / RH 銠)逐一講當日表現 + 主要驅動
3. 連結最近新聞與宏觀指標(DXY / VIX / UST10Y / 原油)的影響
4. 對未來 7 天的展望(每金屬 1-2 句)
5. 給採購單位的具體建議

═══ 輸出格式(雙段)═══
A. **報告全文**(繁體中文 markdown,給人看 + 給 generate_file 寫 DOCX 用)

B. **JSON 落地段**(供 db_write 解析,放在 markdown 末尾的 \`\`\`json 區塊)

\`\`\`json
{
  "report_type": "daily",
  "as_of_date": "{{date}}",
  "title": "金屬市場日報 — {{date}}",
  "summary": "200-300 字摘要,給人快速掃過用",
  "full_content": "完整報告全文(把上方 A 段複製進來)",
  "key_findings": "用換行分隔的 3-7 條重點",
  "sentiment_overall": "negative" | "neutral" | "positive",
  "model_used": "{{model_used}}",

  "forecasts": [
    {
      "entity_type": "metal",
      "entity_code": "CU",
      "forecast_date": "{{date}}",
      "target_date": "<日期 YYYY-MM-DD,N=7 後的日期>",
      "horizon_days": 7,
      "predicted_mean": <number>,
      "predicted_lower": <number>,
      "predicted_upper": <number>,
      "confidence": "low" | "medium" | "high",
      "rationale": "...",
      "key_drivers": "LME 庫存,DXY,中國需求"
    }
    // 11 個金屬各一筆,共 11 筆
  ]
}
\`\`\`

注意:**只輸出一個 \`\`\`json\`\`\` 區塊**,不要分多個。forecasts 內 11 筆都要,缺資料時 predicted_* 給 null + confidence='low'。`;

  const pipeline = [
    {
      id: dbForecastId,
      type: 'db_write',
      label: '寫入 forecast_history(11 個金屬預測)',
      table: 'forecast_history',
      operation: 'upsert',
      key_columns: ['entity_type', 'entity_code', 'forecast_date', 'target_date', 'model_used'],
      input: '{{ai_output}}',
      array_path: '$.forecasts',  // drill 進 ai_output.forecasts 子陣列當 rows
      on_row_error: 'skip',
      max_rows: 50,
      column_mapping: [
        { jsonpath: '$.entity_type',     column: 'entity_type',     transform: 'lower', required: true },
        { jsonpath: '$.entity_code',     column: 'entity_code',     transform: 'upper', required: true },
        { jsonpath: '$.forecast_date',   column: 'forecast_date',   transform: 'date',  required: true },
        { jsonpath: '$.target_date',     column: 'target_date',     transform: 'date',  required: true },
        { jsonpath: '$.horizon_days',    column: 'horizon_days',    transform: 'number' },
        { jsonpath: '$.predicted_mean',  column: 'predicted_mean',  transform: 'number' },
        { jsonpath: '$.predicted_lower', column: 'predicted_lower', transform: 'number' },
        { jsonpath: '$.predicted_upper', column: 'predicted_upper', transform: 'number' },
        { jsonpath: '$.confidence',      column: 'confidence',      transform: '' },
        { jsonpath: '$.rationale',       column: 'rationale',       transform: '' },
        { jsonpath: '$.key_drivers',     column: 'key_drivers',     transform: '' },
        // model_used:LLM 沒填會留 null → 撞 UNIQUE (entity_type,entity_code,forecast_date,target_date,model_used)
        // 固定填 'cortex-daily' 區分 daily/weekly/monthly 預測來源,UNIQUE 才能正常 upsert
        { jsonpath: '$.model_used',      column: 'model_used',      transform: '', default: 'cortex-daily' },
      ],
    },
    {
      id: dbReportId,
      type: 'db_write',
      label: '寫入 pm_analysis_report(報告 metadata)',
      table: 'pm_analysis_report',
      operation: 'upsert',
      key_columns: ['report_type', 'as_of_date'],
      input: '{{ai_output}}',
      on_row_error: 'stop',
      max_rows: 1,
      column_mapping: [
        { jsonpath: '$.report_type',       column: 'report_type',       transform: '',     required: true },
        { jsonpath: '$.as_of_date',        column: 'as_of_date',        transform: 'date', required: true },
        { jsonpath: '$.title',             column: 'title',             transform: '' },
        { jsonpath: '$.summary',           column: 'summary',           transform: '' },
        { jsonpath: '$.full_content',      column: 'full_content',      transform: '' },
        { jsonpath: '$.key_findings',      column: 'key_findings',      transform: '' },
        { jsonpath: '$.sentiment_overall', column: 'sentiment_overall', transform: '' },
        { jsonpath: '$.model_used',        column: 'model_used',        transform: '' },
      ],
    },
    {
      id: generateId,
      type: 'generate_file',
      label: '產出 DOCX 日報',
      output_file: 'docx',
      filename: '金屬市場日報_{{date}}.docx',
      input: '{{ai_output}}',
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-分析庫(日報)',
      kb_id: (kbMap && kbMap.get('PM-分析庫')) || '',
      kb_name: 'PM-分析庫',
      title_field: '$.title',
      url_field: '',  // 報告無 URL
      summary_field: '$.summary',
      content_field: '$.full_content',
      source_field: '',
      published_at_field: '$.as_of_date',
      chunk_strategy: 'mixed',
      dedupe_mode: 'title',  // 同標題視為同一份報告
      max_chunks_per_run: 50,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 每日金屬日報',
    schedule_type: 'daily',
    schedule_hour: 18,
    schedule_minute: 0,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: proModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 金屬市場日報 — {{date}}',
    email_body: '今日金屬市場日報請參閱附件(若已啟用 generate_file 節點)。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 週報(D14)─────────────────────────────────────────────────────────
function buildWeeklyReportTask(kbMap, models = {}) {
  const proModel = models.pro || 'pro';
  const dbReportId = newNodeId('dbw');
  const generateId = newNodeId('gen');
  const kbWriteId  = newNodeId('kbw');

  const prompt = `今天是 {{date}}({{weekday}}),撰寫「金屬市場週報」(回顧過去 7 天)。

═══ 上下文 ═══
{{kb:PM-新聞庫}}     ← 過去 7 天新聞 RAG
{{kb:PM-分析庫}}     ← 過去 7 天日報 RAG

═══ 撰寫要求 ═══
1. 本週市場主軸(300 字內)
2. 11 金屬週漲跌幅統計 + 領漲 / 領跌排序
3. 本週重大事件回顧(政策 / 庫存 / 地緣)
4. 下週展望 + 關鍵觀察點
5. 採購策略建議(進貨節奏、避險建議)

═══ JSON 落地段(放 markdown 末尾)═══
\`\`\`json
{
  "report_type": "weekly",
  "as_of_date": "{{date}}",
  "title": "金屬市場週報 — {{date}}",
  "summary": "300 字內週報摘要",
  "full_content": "完整週報全文",
  "key_findings": "本週 3-5 條核心發現,換行分隔",
  "sentiment_overall": "negative" | "neutral" | "positive",
  "model_used": "{{model_used}}"
}
\`\`\``;

  const pipeline = [
    {
      id: dbReportId,
      type: 'db_write',
      label: '寫入 pm_analysis_report(週報)',
      table: 'pm_analysis_report',
      operation: 'upsert',
      key_columns: ['report_type', 'as_of_date'],
      input: '{{ai_output}}',
      on_row_error: 'stop',
      max_rows: 1,
      column_mapping: [
        { jsonpath: '$.report_type',       column: 'report_type',       transform: '',     required: true },
        { jsonpath: '$.as_of_date',        column: 'as_of_date',        transform: 'date', required: true },
        { jsonpath: '$.title',             column: 'title',             transform: '' },
        { jsonpath: '$.summary',           column: 'summary',           transform: '' },
        { jsonpath: '$.full_content',      column: 'full_content',      transform: '' },
        { jsonpath: '$.key_findings',      column: 'key_findings',      transform: '' },
        { jsonpath: '$.sentiment_overall', column: 'sentiment_overall', transform: '' },
        { jsonpath: '$.model_used',        column: 'model_used',        transform: '' },
      ],
    },
    {
      id: generateId,
      type: 'generate_file',
      label: '產出 DOCX 週報',
      output_file: 'docx',
      filename: '金屬市場週報_{{date}}.docx',
      input: '{{ai_output}}',
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-分析庫(週報)',
      kb_id: (kbMap && kbMap.get('PM-分析庫')) || '',
      kb_name: 'PM-分析庫',
      title_field: '$.title',
      url_field: '',
      summary_field: '$.summary',
      content_field: '$.full_content',
      source_field: '',
      published_at_field: '$.as_of_date',
      chunk_strategy: 'mixed',
      dedupe_mode: 'title',
      max_chunks_per_run: 30,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 金屬市場週報',
    schedule_type: 'weekly',
    schedule_hour: 8,
    schedule_minute: 30,
    schedule_weekday: 1,  // Monday
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: proModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 金屬市場週報 — {{date}}',
    email_body: '本週金屬市場週報請參閱附件。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 月報(D14)─────────────────────────────────────────────────────────
function buildMonthlyReportTask(kbMap, models = {}) {
  const proModel = models.pro || 'pro';
  const dbReportId = newNodeId('dbw');
  const generateId = newNodeId('gen');
  const kbWriteId  = newNodeId('kbw');

  const prompt = `今天是 {{date}}(月初),撰寫「金屬市場月報」(回顧上個月)。

═══ 上下文 ═══
{{kb:PM-新聞庫}}     ← 過去 30 天重大新聞
{{kb:PM-分析庫}}     ← 過去 30 天週報 / 日報

═══ 撰寫要求 ═══
1. 上月市場總覽(主旋律 / 結構性變化)
2. 11 金屬月漲跌統計 + Top 3 漲幅 + Top 3 跌幅
3. 上月重大政策 / 地緣 / 供需事件回顧
4. 本月展望(主要事件日曆 + 關鍵觀察)
5. 對採購預算編列的影響評估

═══ JSON 落地段 ═══
\`\`\`json
{
  "report_type": "monthly",
  "as_of_date": "{{date}}",
  "title": "金屬市場月報 — {{date}}",
  "summary": "400 字內月報摘要",
  "full_content": "完整月報全文",
  "key_findings": "本月 5-8 條核心發現",
  "sentiment_overall": "negative" | "neutral" | "positive",
  "model_used": "{{model_used}}"
}
\`\`\``;

  const pipeline = [
    {
      id: dbReportId,
      type: 'db_write',
      label: '寫入 pm_analysis_report(月報)',
      table: 'pm_analysis_report',
      operation: 'upsert',
      key_columns: ['report_type', 'as_of_date'],
      input: '{{ai_output}}',
      on_row_error: 'stop',
      max_rows: 1,
      column_mapping: [
        { jsonpath: '$.report_type',       column: 'report_type',       transform: '',     required: true },
        { jsonpath: '$.as_of_date',        column: 'as_of_date',        transform: 'date', required: true },
        { jsonpath: '$.title',             column: 'title',             transform: '' },
        { jsonpath: '$.summary',           column: 'summary',           transform: '' },
        { jsonpath: '$.full_content',      column: 'full_content',      transform: '' },
        { jsonpath: '$.key_findings',      column: 'key_findings',      transform: '' },
        { jsonpath: '$.sentiment_overall', column: 'sentiment_overall', transform: '' },
        { jsonpath: '$.model_used',        column: 'model_used',        transform: '' },
      ],
    },
    {
      id: generateId,
      type: 'generate_file',
      label: '產出 DOCX 月報',
      output_file: 'docx',
      filename: '金屬市場月報_{{date}}.docx',
      input: '{{ai_output}}',
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-分析庫(月報)',
      kb_id: (kbMap && kbMap.get('PM-分析庫')) || '',
      kb_name: 'PM-分析庫',
      title_field: '$.title',
      url_field: '',
      summary_field: '$.summary',
      content_field: '$.full_content',
      source_field: '',
      published_at_field: '$.as_of_date',
      chunk_strategy: 'mixed',
      dedupe_mode: 'title',
      max_chunks_per_run: 50,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 金屬市場月報',
    schedule_type: 'monthly',
    schedule_hour: 9,
    schedule_minute: 0,
    schedule_monthday: 1,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: proModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 金屬市場月報 — {{date}}',
    email_body: '上月金屬市場月報請參閱附件。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 全網金屬資料收集(P3.1)───────────────────────────────────────────
// 每天凌晨 06:00 + 加 multi_time(若需要更頻繁)
// 預設只 daily 一次,因為這是「全網總覽」性質,8 個 source × Pro 模型成本不低。
// admin 想加密度可改 schedule_type='interval' + schedule_interval_hours=8
function buildMasterScrapeTask(kbMap, models = {}) {
  const proModel = models.pro || 'pro';
  const dbNewsId   = newNodeId('dbw');
  const dbPriceId  = newNodeId('dbw');
  const kbWriteId  = newNodeId('kbw');
  const generateId = newNodeId('gen');

  const prompt = `今天是 {{date}}({{weekday}})。
這個任務是 PM 平台的「**全網金屬資料總覽收集**」,目的是把當日各官方 / 權威網站的金屬市場資料一次抓回來,
用 LLM 整合分析後寫進「PM-原始資料庫」KB + 報價落地到 pm_price_history,
讓後續日報 / 週報 / 戰情室 / RAG 查詢都能引用最新一手資料。

═══ AU 黃金主源:台灣銀行黃金存摺(USD/oz 牌價)═══
{{fetch:https://rate.bot.com.tw/gold/obu?Lang=zh-TW}}
↑ 台銀外幣計價黃金存摺牌價,**AU 的 price_usd 取「美金 / 1 英兩 / 本行賣出價」**
  原因:正崴採購黃金多透過台銀做交易 / 避險,台銀牌價(含 spread)就是實際結算價,
       不是 LBMA London Fixing。LBMA Gold/Silver 已將資料權獨家授權給 ICE/IBA,公開網頁無法爬。

═══ PGM 業界基準價:Johnson Matthey Base Price(RSS)═══
{{fetch:https://matthey.com/pgm-prices/rss-feed.xml}}
↑ Pt / Pd / Rh / Ir / Ru 五金屬的 USD/oz 基準價,JM 每天 08:30 HK 時間更新。
  正崴採購合約多以 JM Base Price 為準,**PGM 的 price_usd 一律以此為主源**。
  RSS 不帶日變動 %,所以下面再抓 TradingEconomics 補 day_change_pct。

═══ AG 白銀(LBMA 抓不到,改用 Westmetall + Kitco 雙源)═══
{{scrape:https://www.kitco.com/charts/livesilver.html}}
↑ Westmetall 也含 Silver Fixing(EUR/kg 要換算),Kitco 即時 spot(USD/oz 直接用),
  兩個都看;Westmetall 為主、Kitco 為備援/交叉驗證。

═══ PGM 機構級評論(WPIC + matthey 專家觀點)═══
{{scrape:https://platinuminvestment.com/news}}
{{scrape:https://matthey.com/news/expert-insights}}
{{scrape:https://matthey.com/products-and-markets/pgms-and-circularity/pgm-markets}}

═══ 全網資料源(基本金屬 + 一般新聞;若 URL 在公司防火牆未通,LLM 會自動 skip)═══
{{scrape:https://www.kitco.com/charts/livegold.html}}
{{scrape:https://www.kitco.com/charts/livesilver.html}}
{{scrape:https://www.kitco.com/news/}}
{{scrape:https://www.westmetall.com/en/markdaten.php}}
{{scrape:https://www.westmetall.com/en/news.php}}
{{scrape:https://tradingeconomics.com/commodity/copper}}
{{scrape:https://tradingeconomics.com/commodity/aluminum}}
{{scrape:https://tradingeconomics.com/commodity/nickel}}
{{scrape:https://tradingeconomics.com/commodity/zinc}}
{{scrape:https://tradingeconomics.com/commodity/lead}}
{{scrape:https://tradingeconomics.com/commodity/gold}}
{{scrape:https://tradingeconomics.com/commodity/silver}}
{{scrape:https://tradingeconomics.com/commodity/platinum}}
{{scrape:https://tradingeconomics.com/commodity/palladium}}
{{scrape:https://www.mining.com/news/}}
{{scrape:https://oilprice.com/Latest-Energy-News/}}
{{scrape:https://www.lme.com/Metals/Non-ferrous/LME-Copper}}
{{scrape:https://www.investing.com/commodities/metals}}

═══ 任務 ═══
1. 解析每個來源的「結構化資料」(報價 / 漲跌 / 庫存 / 圖表數值)+「市場敘事」(評論 / 新聞)
2. 撰寫一段 500-800 字的「當日全市場綜述」(中文)— 涵蓋:
   - 11 種金屬(銅/鋁/鎳/錫/鋅/鉛/金/銀/鉑/鈀/銠)的當日表現
   - 主要驅動事件(政策 / 庫存 / 地緣 / 美元動態)
   - 跨資產關聯觀察(金 vs 美元 / 銅 vs 中國需求 / 銀 vs 太陽能)
   - **PGM 重點**:JM Base Price 變動 + WPIC / matthey 對 Pt/Pd/Rh 供需的觀察

3. **news 陣列(只放「真新聞 / 真評論文章」,絕對不要放純報價公告)**:
   ✅ 算 news 的:
      - Mining.com / 日經 / SMM / MoneyDJ 等的 article(供需事件 / 政策 / 公司動態 / 地緣)
      - WPIC quarterly outlook / matthey expert-insights / pgm-markets 的 PGM 評論文章
      - 各 source「news / 評論」分頁的 article(westmetall.com/en/news.php、kitco.com/news/、tradingeconomics 評論段)
   ❌ **不要放進 news**(這些是報價來源,只進 prices):
      - 台灣銀行黃金存摺牌價(rate.bot.com.tw/gold/obu)
      - Johnson Matthey PGM Base Price RSS(matthey.com/pgm-prices/rss-feed.xml)
      - Kitco live 報價頁(charts/livegold.html / livesilver.html / liveplatinum.html / livepalladium.html)
      - Westmetall markdaten(報價表)
      - TradingEconomics commodity/* 純圖表頁(只有報價數字 + 7 天 chart,沒文字評論)
   ⚠️ 規則:條目本身要有 ≥ 200 字真實內文 / 分析 / 觀點才算 news;只抓到報價數字的 → 進 prices,不進 news

4. **11 個金屬的當日報價快照**(USD 等價統一),寫進 pm_price_history
   - **AU 黃金的 price_usd 從台銀取**,source="台灣銀行", source_url=台銀 URL, price_type="fixing", market="BOT"
     (取「美金 / 1英兩 / 本行賣出」價;1英兩 = 1 troy oz)
   - **PGM(Pt/Pd/Rh)的 price_usd 一律從 JM RSS 取**,source="JohnsonMatthey", price_type="fixing", market="JM"
   - day_change_pct 從 TradingEconomics 補(JM RSS / 台銀都沒帶 %)
   - **AG 白銀**:Westmetall(EUR/kg → USD/oz 換算)為主,Kitco 為備援

═══ 輸出格式(三段)═══
A. **綜述全文**(markdown,給人看 + DOCX 報告用,放最前面)

B. **JSON 落地段**(放 markdown 末尾的單一 \`\`\`json 區塊;內含 news 與 prices 兩個 key)

\`\`\`json
{
  "news": [
    {
      "title": "WPIC: Fourth consecutive platinum market deficit — 240 koz expected in 2026",
      "url": "https://platinuminvestment.com/news/fourth-consecutive-platinum-market-deficit",
      "source": "WPIC",
      "language": "en",
      "published_at": "{{date}}T08:00:00Z",
      "summary": "繁體中文摘要 80-150 字,濃縮這篇 article 的供需論點與對 PT 價格的影響。",
      "content": "原文 article body 整段拷貝(英文/中文都接受),1500-3000 字。內容必須是真評論 / 分析 / 新聞事件,不能是純報價數字。",
      "sentiment_score": 0.6,
      "sentiment_label": "positive",
      "related_metals": ["PT"],
      "topics": ["supply", "demand", "forecast"]
    }
    // 每篇都要有 ≥ 200 字真實 article body。報價來源(JM RSS / 台銀 / Kitco live / Westmetall markdaten / TE commodity)不要放這裡!
    // 共 ~8-15 篇真新聞。如果某天確實沒抓到任何 article,寧可給空陣列 [] 也別塞報價公告充數
  ],
  "prices": [
    {
      "as_of_date": "{{date}}",
      "metal_code": "AU",
      "metal_name": "金",
      "price_usd": 4689.20,
      "unit": "USD/oz",
      "original_price": 4689.20,
      "original_currency": "USD",
      "original_unit": "USD/oz (1英兩=1 troy oz)",
      "fx_rate_to_usd": 1.0,
      "day_change_pct": -0.39,
      "price_type": "fixing",
      "market": "BOT",
      "source": "台灣銀行",
      "source_url": "https://rate.bot.com.tw/gold/obu?Lang=zh-TW",
      "raw_snippet": "台銀黃金存摺 11:10 美金 / 1英兩 / 本行賣出 4689.20"
    },
    {
      "as_of_date": "{{date}}",
      "metal_code": "PT",
      "metal_name": "鉑",
      "price_usd": 2019.0,
      "unit": "USD/oz",
      "original_price": 2019.0,
      "original_currency": "USD",
      "original_unit": "USD/troy oz",
      "fx_rate_to_usd": 1.0,
      "day_change_pct": -1.87,
      "price_type": "fixing",
      "market": "JM",
      "source": "JohnsonMatthey",
      "source_url": "https://matthey.com/pgm-prices/rss-feed.xml",
      "raw_snippet": "JM Base Price: US$ 2019 per troy oz (28 Apr 2026 08:30 HK);day_change 從 TradingEconomics 補"
    }
    // **必須 11 筆**,順序:AU AG PT PD CU AL NI ZN PB SN RH
    // 找不到資料的金屬 → 仍輸出該筆但 price_usd / day_change_pct 給 null,source 給 'unknown'
  ]
}
\`\`\`

═══ AU 寫入規則(2026-04-28 改台銀)═══
- **price_usd 取台銀「美金 / 1英兩 / 本行賣出」價**(USD/oz)
- source = "台灣銀行" / source_url = "https://rate.bot.com.tw/gold/obu?Lang=zh-TW"
- price_type = "fixing" / market = "BOT"
- 注意:台銀牌價含 spread,跟 LBMA London Fixing 略有差距,但這是正崴實際採購結算價

═══ PGM 寫入規則 ═══
- **PT / PD / RH 的 price_usd 一律從 JM RSS 取**(資料源:matthey RSS)
  - source = "JohnsonMatthey"
  - source_url = "https://matthey.com/pgm-prices/rss-feed.xml"
  - price_type = "fixing"(JM Base Price 是日 fixing,不是 spot)
  - market = "JM"
- day_change_pct 從 TradingEconomics 的「down/up X.XX%」補
- JM RSS 也含 Iridium / Ruthenium,但目前 metal_code 只有 11 個(沒 IR/RU),先不寫 row

═══ AG 寫入規則 ═══
- **Westmetall 為主**(EUR/kg → USD/oz 換算,is_estimated=1)
- Kitco 為備援/交叉驗證(scrape https://www.kitco.com/charts/livesilver.html)
- LBMA 不能爬(資料權獨家授權給 ICE/IBA)

═══ 寫入規則(務必遵守)═══
- **prices 必 11 筆**(metal_code 全部到齊),即使部分金屬今天沒資料,給 null 也要列出
- price_usd 一律換算成 **USD 等價**(EUR → USD 用 fx_rate_to_usd;ton ↔ kg 看 unit 欄位記錄原單位)
- as_of_date 統一用今天 = {{date}}(YYYY-MM-DD)
- summary 必繁體中文;content 可英文 + 部分中譯
- sentiment_score -1 ~ +1 是「對該金屬未來 1-7 天價格的影響」
- 任何 source scrape 失敗就 skip 該 news 條目,但 prices 永遠 11 筆
- **只輸出一個 \`\`\`json\`\`\` 區塊**,內含 news 與 prices 兩個 key

═══ 自我檢查清單(輸出前最後一遍)═══
- [ ] 我有寫 A 段中文綜述嗎?
- [ ] news 陣列每筆都有 ≥ 200 字真實 article body 嗎?(只有報價數字 = 不該進 news)
- [ ] **news 裡有沒有混進報價公告?**(JM RSS / 台銀牌價 / Kitco live / Westmetall markdaten / TE commodity 純圖表 → 一律刪掉,只留 prices)
- [ ] prices 是 11 筆 + metal_code 全部到齊?
- [ ] AU 用台銀價、PT/PD/RH 用 JM Base Price?
- [ ] published_at 是 ISO 格式?
- [ ] 整份輸出只有一個 \`\`\`json\`\`\` 區塊(不是兩個分開的 news / prices)?`;

  const pipeline = [
    {
      id: dbNewsId,
      type: 'db_write',
      label: '寫入 pm_news(各 source 條目)',
      table: 'pm_news',
      operation: 'insert',
      key_columns: [],
      input: '{{ai_output}}',
      array_path: '$.news',
      array_path_optional: true,  // 舊 prompt 還是頂層 array 時也能 silent fallback
      on_row_error: 'skip',
      max_rows: 50,
      column_mapping: [
        { jsonpath: '$.url',             column: 'url',             transform: '',                required: true },
        { jsonpath: '$.url',             column: 'url_hash',        transform: 'sha256',          required: true },
        { jsonpath: '$.title',           column: 'title',           transform: '' },
        { jsonpath: '$.source',          column: 'source',          transform: '' },
        { jsonpath: '$.published_at',    column: 'published_at',    transform: 'date' },
        { jsonpath: '$.language',        column: 'language',        transform: '' },
        { jsonpath: '$.summary',         column: 'summary',         transform: '' },
        { jsonpath: '$.sentiment_score', column: 'sentiment_score', transform: 'number' },
        { jsonpath: '$.sentiment_label', column: 'sentiment_label', transform: '' },
        { jsonpath: '$.related_metals',  column: 'related_metals',  transform: 'array_join_comma' },
        { jsonpath: '$.topics',          column: 'topics',          transform: 'array_join_comma' },
      ],
    },
    {
      id: dbPriceId,
      type: 'db_write',
      label: '寫入 pm_price_history(11 個金屬報價快照)',
      table: 'pm_price_history',
      operation: 'upsert',
      key_columns: ['metal_code', 'as_of_date'],
      input: '{{ai_output}}',
      array_path: '$.prices',
      array_path_optional: true,  // LLM 沒輸出 prices key 時 silent skip,不擋 pipeline
      on_row_error: 'skip',
      max_rows: 20,
      column_mapping: [
        { jsonpath: '$.as_of_date',        column: 'as_of_date',        transform: 'date',   required: true },
        { jsonpath: '$.metal_code',        column: 'metal_code',        transform: 'upper',  required: true },
        { jsonpath: '$.metal_name',        column: 'metal_name',        transform: '' },
        { jsonpath: '$.price_usd',         column: 'price_usd',         transform: 'number' },
        { jsonpath: '$.unit',              column: 'unit',              transform: '' },
        { jsonpath: '$.original_price',    column: 'original_price',    transform: 'number' },
        { jsonpath: '$.original_currency', column: 'original_currency', transform: '' },
        { jsonpath: '$.original_unit',     column: 'original_unit',     transform: '' },
        { jsonpath: '$.fx_rate_to_usd',    column: 'fx_rate_to_usd',    transform: 'number' },
        { jsonpath: '$.day_change_pct',    column: 'day_change_pct',    transform: 'number' },
        { jsonpath: '$.price_type',        column: 'price_type',        transform: '' },
        { jsonpath: '$.market',            column: 'market',            transform: '' },
        { jsonpath: '$.source',            column: 'source',            transform: '' },
        { jsonpath: '$.source_url',        column: 'source_url',        transform: '' },
        { jsonpath: '$.raw_snippet',       column: 'raw_snippet',       transform: '' },
      ],
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-原始資料庫(各 source 全文)',
      kb_id: (kbMap && kbMap.get('PM-原始資料庫')) || '',
      kb_name: 'PM-原始資料庫',
      title_field: '$.title',
      url_field: '$.url',
      summary_field: '$.summary',
      content_field: '$.content',
      source_field: '$.source',
      published_at_field: '$.published_at',
      chunk_strategy: 'mixed',
      dedupe_mode: 'url',
      max_chunks_per_run: 200,
      on_row_error: 'skip',
      input: '{{ai_output}}',
      array_path: '$.news',
      array_path_optional: true,  // 舊 prompt 還是頂層 array 時 fallback
    },
    {
      id: generateId,
      type: 'generate_file',
      label: '產出 DOCX 全網綜述',
      output_file: 'docx',
      filename: '貴金屬全網綜述_{{date}}.docx',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 全網金屬資料收集',
    schedule_type: 'daily',
    schedule_hour: 6,
    schedule_minute: 0,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: proModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 貴金屬全網資料綜述 — {{date}}',
    email_body: '今日全網金屬資料(Kitco / Westmetall / TradingEconomics 等)綜述已抓取整合,完整內文已寫入 PM-原始資料庫 KB。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── Patch 早期 seed 進去的 [PM]% task,kb_write 節點 kb_id + kb_name 都空時 ──
// task name → kb_name 的對應(直接從 buildXxxTask 寫死的對應表反推)。
// 觸發場景:task 早期 seed 進去時 KB 還沒建,kb_name 也漏了 → patchExistingTaskKbIds
// 因為 `if (!n.kb_name) continue` 整條 skip → 永遠救不回來。
const TASK_NAME_TO_KB = {
  '[PM] 每日金屬新聞抓取': 'PM-新聞庫',
  '[PM] 每日金屬日報':     'PM-分析庫',
  '[PM] 週度金屬報告':     'PM-分析庫',
  '[PM] 月度金屬報告':     'PM-分析庫',
  '[PM] 全網金屬資料收集': 'PM-原始資料庫',
  // 2026-04-29:by-source 新聞 task(B + E 策略)
  '[PM] 新聞 Mining.com':  'PM-新聞庫',
  '[PM] 新聞 Nikkei':      'PM-新聞庫',
  '[PM] 新聞 SMM':         'PM-新聞庫',
  '[PM] 新聞 MoneyDJ':     'PM-新聞庫',
  '[PM] 新聞 PGM評論':     'PM-新聞庫',
};

async function patchKbWriteRestoreNamesByTask(db, kbMap) {
  if (!kbMap || kbMap.size === 0) return;
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] restore kb_name select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const taskName = r.name || r.NAME || '';
    const expectedKbName = TASK_NAME_TO_KB[taskName];
    if (!expectedKbName) continue;
    const raw = r.pipeline_json || r.PIPELINE_JSON;
    if (!raw) continue;
    let nodes;
    try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { continue; }
    if (!Array.isArray(nodes)) continue;

    let dirty = false;
    for (const n of nodes) {
      if (n?.type !== 'kb_write') continue;
      const hasName = !!(n.kb_name && String(n.kb_name).trim());
      const hasId   = !!(n.kb_id   && String(n.kb_id).trim());
      if (hasName && hasId) continue;
      if (!hasName) { n.kb_name = expectedKbName; dirty = true; }
      if (!hasId) {
        const kbId = kbMap.get(n.kb_name || expectedKbName);
        if (kbId) { n.kb_id = kbId; dirty = true; }
      }
    }
    if (dirty) {
      try {
        await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
          .run(JSON.stringify(nodes), r.id || r.ID);
        patched++;
        console.log(`[PMScheduledTaskSeed] restored kb_name+kb_id for task #${r.id || r.ID} "${taskName}" → ${expectedKbName}`);
      } catch (e) {
        console.warn(`[PMScheduledTaskSeed] restore task #${r.id || r.ID} failed:`, e.message);
      }
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] restored kb_write names+ids on ${patched} task(s)`);
}

// ── Patch 既有任務:fill in kb_id where kb_name matches but kb_id is empty ───
async function patchExistingTaskKbIds(db, kbMap) {
  if (!kbMap || kbMap.size === 0) return;
  // 找所有 [PM] 開頭的任務,檢查 pipeline_json 內 kb_write 節點
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const raw = r.pipeline_json || r.PIPELINE_JSON;
    if (!raw) continue;
    let nodes;
    try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { continue; }
    if (!Array.isArray(nodes)) continue;

    let dirty = false;
    for (const n of nodes) {
      if (n?.type !== 'kb_write') continue;
      if (n.kb_id && String(n.kb_id).trim()) continue;  // 已填,不動
      if (!n.kb_name) continue;
      const kbId = kbMap.get(n.kb_name);
      if (kbId) {
        n.kb_id = kbId;
        dirty = true;
      }
    }
    if (dirty) {
      try {
        await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
          .run(JSON.stringify(nodes), r.id || r.ID);
        patched++;
        console.log(`[PMScheduledTaskSeed] patched kb_id for task #${r.id || r.ID} "${r.name || r.NAME}"`);
      } catch (e) {
        console.warn(`[PMScheduledTaskSeed] patch task #${r.id || r.ID} failed:`, e.message);
      }
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] patched ${patched} existing task(s) with seed kb_id`);
}

/**
 * 補既有 [PM]% task 的 db_write(table='pm_news')mapping 缺漏的 published_at 欄位
 * (Phase 5 後發現的 schema-mapping 漏洞:LLM 有輸出 $.published_at 但 mapping 沒撈)
 * Idempotent — 已含 published_at mapping 的不動
 */
async function patchExistingNewsPublishedAtMapping(db) {
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch published_at: select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const raw = r.pipeline_json || r.PIPELINE_JSON;
    if (!raw) continue;
    let nodes;
    try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { continue; }
    if (!Array.isArray(nodes)) continue;

    let dirty = false;
    for (const n of nodes) {
      if (n?.type !== 'db_write') continue;
      if (String(n.table || '').toLowerCase() !== 'pm_news') continue;
      if (!Array.isArray(n.column_mapping)) continue;
      const hasPublishedAt = n.column_mapping.some(m => String(m?.column || '').toLowerCase() === 'published_at');
      if (hasPublishedAt) continue;

      // insert published_at mapping 接在 'source' 之後(若沒 source 就放最後)
      const sourceIdx = n.column_mapping.findIndex(m => String(m?.column || '').toLowerCase() === 'source');
      const newRow = { jsonpath: '$.published_at', column: 'published_at', transform: 'date' };
      if (sourceIdx >= 0) n.column_mapping.splice(sourceIdx + 1, 0, newRow);
      else n.column_mapping.push(newRow);
      dirty = true;
    }
    if (dirty) {
      try {
        await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
          .run(JSON.stringify(nodes), r.id || r.ID);
        patched++;
        console.log(`[PMScheduledTaskSeed] patched published_at mapping for task #${r.id || r.ID} "${r.name || r.NAME}"`);
      } catch (e) {
        console.warn(`[PMScheduledTaskSeed] patch published_at task #${r.id || r.ID} failed:`, e.message);
      }
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] patched ${patched} existing task(s) with published_at mapping`);
}

/**
 * 補既有 [PM]% task 的 db_write(table='forecast_history')缺漏的 array_path
 * (原 seed 的 column_mapping 第一筆是 placeholder marker '__expand__',實際 input
 *  是 {report:..., forecasts:[...]} 但沒 drill,導致 forecast_history 寫不進去)
 * Idempotent — 已有 array_path 的不動;順手把 placeholder marker mapping 拿掉
 */
async function patchExistingForecastArrayPath(db) {
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch forecast array_path: select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const raw = r.pipeline_json || r.PIPELINE_JSON;
    if (!raw) continue;
    let nodes;
    try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { continue; }
    if (!Array.isArray(nodes)) continue;

    let dirty = false;
    for (const n of nodes) {
      if (n?.type !== 'db_write') continue;
      if (String(n.table || '').toLowerCase() !== 'forecast_history') continue;

      // 補 array_path
      if (!n.array_path || !String(n.array_path).trim()) {
        n.array_path = '$.forecasts';
        dirty = true;
      }

      // 移除舊 placeholder mapping(column='__expand__')
      if (Array.isArray(n.column_mapping)) {
        const before = n.column_mapping.length;
        n.column_mapping = n.column_mapping.filter(m => String(m?.column || '').toLowerCase() !== '__expand__');
        if (n.column_mapping.length !== before) dirty = true;
      }

      // 移掉過時的 _note_for_admin
      if (n._note_for_admin) {
        delete n._note_for_admin;
        dirty = true;
      }

      // 2026-04-29:model_used 補 default='cortex-daily',否則 LLM 沒填 → null →
      //   撞 UQ_FORECAST_UNIQUE (entity_type,entity_code,forecast_date,target_date,model_used)
      //   既有同 forecast/target_date 都 null 的 row → ORA-00001
      if (Array.isArray(n.column_mapping)) {
        for (const m of n.column_mapping) {
          if (String(m?.column || '').toLowerCase() === 'model_used') {
            if (!m.default || !String(m.default).trim()) {
              m.default = 'cortex-daily';
              dirty = true;
            }
          }
        }
      }
    }
    if (dirty) {
      try {
        await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
          .run(JSON.stringify(nodes), r.id || r.ID);
        patched++;
        console.log(`[PMScheduledTaskSeed] patched forecast array_path for task #${r.id || r.ID} "${r.name || r.NAME}"`);
      } catch (e) {
        console.warn(`[PMScheduledTaskSeed] patch forecast array_path task #${r.id || r.ID} failed:`, e.message);
      }
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] patched ${patched} existing task(s) with forecast_history array_path`);
}

// 升級既有 [PM] 每日金屬新聞抓取 task:db_write→pm_news 從 insert 改 upsert by url_hash
// 為何:每天 9:00 / 14:30 跑兩次,LLM 通常抓回相同 url(news source 沒幾個),
// insert 撞 UQ_NEWS_URL_HASH → ORA-00001 → 全部 skipped → 看起來「跑成功 0 inserted」。
// upsert 後重複 url 改成 update,讓最新 summary / sentiment 蓋上去。
// Idempotent — 已是 upsert + key 含 url_hash 就 skip。Prompt 不動。
async function patchExistingNewsToUpsert(db) {
  let row;
  try {
    row = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name='[PM] 每日金屬新聞抓取'`).get();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch news upsert select failed:', e.message);
    return;
  }
  if (!row) return;
  const id = row.id || row.ID;
  let raw = row.pipeline_json || row.PIPELINE_JSON;
  if (raw && typeof raw !== 'string' && raw.toString) raw = raw.toString();
  if (!raw) return;
  let nodes;
  try { nodes = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(nodes)) return;

  let dirty = false;
  for (const n of nodes) {
    if (n?.type !== 'db_write') continue;
    if (String(n.table || '').toLowerCase() !== 'pm_news') continue;
    if (n.operation === 'upsert' && Array.isArray(n.key_columns) && n.key_columns.includes('url_hash')) continue;
    n.operation = 'upsert';
    n.key_columns = ['url_hash'];
    dirty = true;
  }
  if (dirty) {
    try {
      await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
        .run(JSON.stringify(nodes), id);
      console.log(`[PMScheduledTaskSeed] Upgraded "[PM] 每日金屬新聞抓取" #${id}: db_write → upsert by url_hash`);
    } catch (e) {
      console.warn(`[PMScheduledTaskSeed] patch news upsert #${id} failed:`, e.message);
    }
  }
}

// 升級既有 [PM] 總體經濟指標日抓 task:db_write→pm_macro_history 把 source 從 key + required 拿掉
// 為何:原 seed `key_columns: [indicator_code, as_of_date, source]` + source required,
// LLM 偶爾漏 source 欄就整列 skip 不寫;source 從 key 拿掉後 (indicator_code, as_of_date)
// 自然唯一,source 也不再強制必填,容錯度高。
// Idempotent。Prompt 不動。
async function patchExistingMacroLooserKeys(db) {
  let row;
  try {
    row = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name='[PM] 總體經濟指標日抓'`).get();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch macro keys select failed:', e.message);
    return;
  }
  if (!row) return;
  const id = row.id || row.ID;
  let raw = row.pipeline_json || row.PIPELINE_JSON;
  if (raw && typeof raw !== 'string' && raw.toString) raw = raw.toString();
  if (!raw) return;
  let nodes;
  try { nodes = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(nodes)) return;

  let dirty = false;
  for (const n of nodes) {
    if (n?.type !== 'db_write') continue;
    if (String(n.table || '').toLowerCase() !== 'pm_macro_history') continue;
    // 1) key_columns 拿掉 source
    if (Array.isArray(n.key_columns) && n.key_columns.includes('source')) {
      n.key_columns = n.key_columns.filter(k => k !== 'source');
      dirty = true;
    }
    // 2) source mapping 移除 required:true
    if (Array.isArray(n.column_mapping)) {
      for (const m of n.column_mapping) {
        if (String(m?.column || '').toLowerCase() === 'source' && m.required === true) {
          delete m.required;
          dirty = true;
        }
      }
    }
  }
  if (dirty) {
    try {
      await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
        .run(JSON.stringify(nodes), id);
      console.log(`[PMScheduledTaskSeed] Upgraded "[PM] 總體經濟指標日抓" #${id}: source 從 key + required 拿掉`);
    } catch (e) {
      console.warn(`[PMScheduledTaskSeed] patch macro keys #${id} failed:`, e.message);
    }
  }
}

// 升級既有 [PM] 總體經濟指標日抓 task:把 is_estimated 從 column_mapping 拿掉
// + 把 prompt 內的 is_estimated 範例 / 規則也清掉,LLM 不再浪費 token 出這欄
// (pm_macro_history schema 沒這欄,LLM 出了會被 silent drop,但乾脆讓 LLM 不再出)
// Idempotent。
async function patchExistingMacroDropIsEstimated(db) {
  let row;
  try {
    row = await db.prepare(`SELECT id, name, prompt, pipeline_json FROM scheduled_tasks WHERE name='[PM] 總體經濟指標日抓'`).get();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch macro is_estimated select failed:', e.message);
    return;
  }
  if (!row) return;
  const id = row.id || row.ID;

  // 1) pipeline_json:從 column_mapping 拿掉 is_estimated
  let raw = row.pipeline_json || row.PIPELINE_JSON;
  if (raw && typeof raw !== 'string' && raw.toString) raw = raw.toString();
  let nodes;
  try { nodes = JSON.parse(raw || '[]'); } catch { nodes = []; }
  let pipelineDirty = false;
  for (const n of nodes) {
    if (n?.type !== 'db_write') continue;
    if (String(n.table || '').toLowerCase() !== 'pm_macro_history') continue;
    if (!Array.isArray(n.column_mapping)) continue;
    const before = n.column_mapping.length;
    n.column_mapping = n.column_mapping.filter(m => String(m?.column || '').toLowerCase() !== 'is_estimated');
    if (n.column_mapping.length !== before) pipelineDirty = true;
  }

  // 2) prompt:刪掉 is_estimated 字眼(JSON 範例那行 + 註腳)
  let prompt = row.prompt || row.PROMPT;
  if (prompt && typeof prompt !== 'string' && prompt.toString) prompt = prompt.toString();
  let promptDirty = false;
  if (prompt && /is_estimated/.test(prompt)) {
    let p = prompt;
    // 移除 JSON 物件範例內 "is_estimated": 0 那行(連前面的逗號 + 換行一起清)
    p = p.replace(/,\s*\n?\s*"is_estimated"\s*:\s*\d+/g, '');
    // 移除 prompt 結尾「value=null + is_estimated=1 + source_url 寫 "unavailable"」之類規則
    p = p.replace(/\s*\+\s*is_estimated\s*=\s*\d+/g, '');
    if (p !== prompt) {
      prompt = p;
      promptDirty = true;
    }
  }

  if (!pipelineDirty && !promptDirty) return;

  try {
    await db.prepare(`
      UPDATE scheduled_tasks
      SET pipeline_json = ?, prompt = ?, updated_at = SYSTIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(nodes), prompt, id);
    console.log(`[PMScheduledTaskSeed] Upgraded "[PM] 總體經濟指標日抓" #${id}: 拿掉 is_estimated mapping${promptDirty ? ' + prompt' : ''}`);
  } catch (e) {
    console.warn(`[PMScheduledTaskSeed] patch macro is_estimated #${id} failed:`, e.message);
  }
}

// 升級既有 [PM] 全網金屬資料收集 task:
// - 若 pipeline 沒 db_write→pm_price_history,就整個 prompt + pipeline 重 build(用最新 seed)
// - 保留 admin 已調過的 schedule / status / recipients 等執行面欄位
// Idempotent — 已有 pm_price_history 節點就 skip
//
// 設計考量:LLM prompt 必須跟 pipeline 對齊(輸出 { news, prices } 物件 vs 頂層 array),
// 所以無法只 surgical 加節點,必須一起 force-update prompt。
async function patchExistingMasterScrapeAddPriceWrite(db, kbMap, models) {
  const newSeed = buildMasterScrapeTask(kbMap, models);
  const targetName = newSeed.name;
  let row;
  try {
    row = await db.prepare(`SELECT id, name, prompt, pipeline_json FROM scheduled_tasks WHERE name=?`).get(targetName);
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch master scrape select failed:', e.message);
    return;
  }
  if (!row) return; // task 還沒被 seed,autoSeed 主流程會建

  const id = row.id || row.ID;
  const raw = row.pipeline_json || row.PIPELINE_JSON;
  let nodes = [];
  if (raw) {
    try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { nodes = []; }
  }
  let promptStr = row.prompt || row.PROMPT;
  if (promptStr && typeof promptStr !== 'string' && promptStr.toString) promptStr = promptStr.toString();

  const hasPriceWrite = Array.isArray(nodes) && nodes.some(
    n => n?.type === 'db_write' && String(n.table || '').toLowerCase() === 'pm_price_history'
  );
  // marker:JohnsonMatthey(2026-04-28 加 PGM RSS)+ rate.bot.com.tw(2026-04-28 加台銀金)
  //       + news vs prices 規則(2026-04-28 加,避 LLM 把 JM RSS / 台銀牌價當 news 抽出來)
  const hasJmMarker        = !!promptStr && /JohnsonMatthey/.test(promptStr);
  const hasBotMarker       = !!promptStr && /rate\.bot\.com\.tw/.test(promptStr);
  const hasNewsRulesMarker = !!promptStr && /絕對不要放純報價公告/.test(promptStr);

  if (hasPriceWrite && hasJmMarker && hasBotMarker && hasNewsRulesMarker) return; // 四條件都 ok 才 skip

  try {
    await db.prepare(`
      UPDATE scheduled_tasks
      SET pipeline_json = ?, prompt = ?, updated_at = SYSTIMESTAMP
      WHERE id = ?
    `).run(newSeed.pipeline_json, newSeed.prompt, id);
    const missing = [
      !hasPriceWrite && 'pm_price_history',
      !hasJmMarker && 'JM RSS',
      !hasBotMarker && '台銀金 fetch',
      !hasNewsRulesMarker && 'news vs prices 規則',
    ].filter(Boolean).join(' + ');
    console.log(`[PMScheduledTaskSeed] Upgraded "${targetName}" #${id}: ${missing}`);
  } catch (e) {
    console.warn(`[PMScheduledTaskSeed] patch master scrape update #${id} failed:`, e.message);
  }
}

// 升級既有 [PM] 每日金屬新聞抓取 task:加 PGM 機構級評論源(WPIC + matthey)
// 用 platinuminvestment.com marker 判斷,沒這 URL 就 force update prompt。
// pipeline 不動(沿用之前 upsert by url_hash patch)。
// Idempotent。
async function patchExistingNewsAddPgmSources(db) {
  const newSeed = buildNewsTask(undefined, {});
  let row;
  try {
    row = await db.prepare(`SELECT id, name, prompt FROM scheduled_tasks WHERE name='[PM] 每日金屬新聞抓取'`).get();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch news pgm sources select failed:', e.message);
    return;
  }
  if (!row) return;
  const id = row.id || row.ID;
  let promptStr = row.prompt || row.PROMPT;
  if (promptStr && typeof promptStr !== 'string' && promptStr.toString) promptStr = promptStr.toString();
  // marker:platinuminvestment.com(PGM 評論源,2026-04-28 加)
  //       + moneydj.com(中文新聞源,2026-04-28 後加)
  //       + 自我檢查清單(2026-04-28 加 JSON mandatory 提示)
  //       + 「原文整段拷貝」(2026-04-28 修 content 太短 60 字 issue)
  //       + 「往前 7 天內」(2026-04-28 加 published_at cutoff,擋 WPIC / JM 舊 article)
  // 五 marker 都有才視為已升級到最新版
  const hasWpic        = !!promptStr && /platinuminvestment\.com/.test(promptStr);
  const hasMoneydj     = !!promptStr && /moneydj\.com/.test(promptStr);
  const hasSelfCheck   = !!promptStr && /自我檢查清單/.test(promptStr);
  const hasFullContent = !!promptStr && /原文整段拷貝/.test(promptStr);
  const has7DayCutoff  = !!promptStr && /往前 7 天/.test(promptStr);
  if (hasWpic && hasMoneydj && hasSelfCheck && hasFullContent && has7DayCutoff) return;

  try {
    await db.prepare(`UPDATE scheduled_tasks SET prompt=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(newSeed.prompt, id);
    const missing = [
      !hasWpic && 'WPIC + matthey',
      !hasMoneydj && 'Mining RSS + MoneyDJ + SMM + 日經',
      !has7DayCutoff && '7 天 cutoff',
    ].filter(Boolean).join(' + ');
    console.log(`[PMScheduledTaskSeed] Upgraded "[PM] 每日金屬新聞抓取" #${id}: ${missing}`);
  } catch (e) {
    console.warn(`[PMScheduledTaskSeed] patch news pgm sources update #${id} failed:`, e.message);
  }
}

// ── Patch 既有 [PM] 新聞 PGM評論:7 天 cutoff → 60 天 cutoff(2026-04-29)─────
// PGM 機構級評論更新頻率低(WPIC quarterly / JM monthly),7 天常常空抓
// 用 marker「往前 60 天」判斷,沒這字串就 force update prompt
async function patchExistingPgmCommentaryCutoff60(db) {
  const newSeed = buildNewsPgmCommentaryTask(undefined, {});
  let row;
  try {
    row = await db.prepare(`SELECT id, name, prompt FROM scheduled_tasks WHERE name='[PM] 新聞 PGM評論'`).get();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch PGM cutoff 60 select failed:', e.message);
    return;
  }
  if (!row) return;
  const id = row.id || row.ID;
  let promptStr = row.prompt || row.PROMPT;
  if (promptStr && typeof promptStr !== 'string' && promptStr.toString) promptStr = promptStr.toString();
  if (!!promptStr && /往前 60 天/.test(promptStr)) return; // 已升級

  try {
    await db.prepare(`UPDATE scheduled_tasks SET prompt=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(newSeed.prompt, id);
    console.log(`[PMScheduledTaskSeed] Upgraded "[PM] 新聞 PGM評論" #${id}: cutoff 7d → 60d`);
  } catch (e) {
    console.warn(`[PMScheduledTaskSeed] patch PGM cutoff 60 update #${id} failed:`, e.message);
  }
}

// 升級 user 自建 task `[PM] 每日貴金屬行情`(prefix [PM] 但非內建 seed)
// 採用 array-of-objects 頂層結構(跟 user 既有 prompt 同),保留 user pipeline_json 不動,
// 只 force update prompt 加進新數據源:台銀金 / matthey RSS / Kitco silver
// marker:rate.bot.com.tw(沒這字串才升級;有 = 已升級過或 user 自己加過)
async function patchUserDailyMetalQuoteTask(db) {
  let row;
  try {
    row = await db.prepare(`SELECT id, name, prompt FROM scheduled_tasks WHERE name='[PM] 每日貴金屬行情'`).get();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch user daily quote select failed:', e.message);
    return;
  }
  if (!row) return; // user 沒建這個 task,跳過
  const id = row.id || row.ID;
  let promptStr = row.prompt || row.PROMPT;
  if (promptStr && typeof promptStr !== 'string' && promptStr.toString) promptStr = promptStr.toString();
  const hasBotMarker = !!promptStr && /rate\.bot\.com\.tw/.test(promptStr);
  const hasJmMarker  = !!promptStr && /JohnsonMatthey/.test(promptStr);
  if (hasBotMarker && hasJmMarker) return; // 已升級

  // 對應 user 既有 array-of-objects 結構 prompt(跟 buildMasterScrapeTask 的物件結構不同)
  // 採用 user 上次貼的版本作 base,加進台銀 / matthey / kitco silver
  const newPrompt = `今天是 {{date}}({{weekday}}),請為「{{task_name}}」整理今日全球主要金屬行情,以繁體中文輸出。

═══ 資料源 1 — Westmetall(LME 基本金屬 + Silver Fixing 二手轉發)═══
{{scrape:https://www.westmetall.com/en/markdaten.php}}

═══ 資料源 2 — 台灣銀行黃金存摺(Gold 主源,USD/oz)═══
{{fetch:https://rate.bot.com.tw/gold/obu?Lang=zh-TW}}
↑ 取「美金 / 1英兩 / 本行賣出」價作 AU 的 price_usd
  原因:正崴採購黃金透過台銀,台銀牌價(含 spread)就是實際結算價。
       LBMA Gold 已將資料權獨家授權給 ICE/IBA,公開網頁無法爬。

═══ 資料源 3 — Johnson Matthey PGM Base Price(Pt/Pd/Rh 主源,RSS)═══
{{fetch:https://matthey.com/pgm-prices/rss-feed.xml}}
↑ Pt / Pd / Rh / Ir / Ru 五金屬 USD/oz 基準價,JM 每天 08:30 HK 更新。
  正崴 PGM 採購多以 JM Base Price 為合約結算基準。

═══ 資料源 4 — Trading Economics(PGM 日變動 % 補充)═══
Platinum: {{scrape:https://tradingeconomics.com/commodity/platinum}}
Palladium: {{scrape:https://tradingeconomics.com/commodity/palladium}}
Rhodium: {{scrape:https://tradingeconomics.com/commodity/rhodium}}

═══ 資料源 5 — Kitco(Silver / PGM 備援,僅在主源失敗時用)═══
Silver 備援: {{scrape:https://www.kitco.com/charts/livesilver.html}}
Platinum 備援: {{scrape:https://www.kitco.com/charts/liveplatinum.html}}
Palladium 備援: {{scrape:https://www.kitco.com/charts/livepalladium.html}}
Rhodium 備援: {{scrape:https://www.kitco.com/charts/liverhodium.html}}

═══ 解析規則(請嚴格遵守)═══

1. **基本金屬(Copper / Aluminium / Nickel / Tin / Zinc / Lead)** 來源:Westmetall
   擷取:LME cash 結算價(USD/ton)+ 當日庫存(公噸)+ 庫存變動

2. **Gold(AU)** 主源:**台灣銀行**(資料源 2)
   - 取「美金 / 1英兩 / 本行賣出」(USD/oz,1英兩=1 troy oz)
   - source="台灣銀行", price_type="fixing", market="BOT"
   - 台銀失敗才 fallback 用 Westmetall 的 LBMA Gold Fixing 二手轉發

3. **Silver(AG)** 主源:Westmetall(EUR/kg → USD/oz 換算)+ Kitco 備援
   - Westmetall 給 EUR/kg → 保留 original_price 是 EUR/kg + 換算 USD/oz
     (1 kg = 32.1507 oz,EUR/USD 匯率取 Westmetall 當日值,is_estimated=1)
     必須附換算公式
   - Westmetall 失敗才 fallback Kitco(USD/oz 直接用,is_estimated=0)
   - **不可用 LBMA**:資料權已獨家授權 ICE/IBA 付費,公開網頁沒數字

4. **Platinum / Palladium / Rhodium** 主源:**Johnson Matthey RSS**(資料源 3)
   - **price_usd 一律以 JM RSS 為主**,source="JohnsonMatthey", price_type="fixing", market="JM"
   - **day_change_pct 從 TradingEconomics 補**(JM RSS 沒帶日變動)
   - JM RSS 抓不到該金屬才 fallback 用 TE 的價(source="TradingEconomics", price_type="spot")
   - JM + TE 都失敗才用 Kitco Bid/Ask 平均(source="Kitco")
   - **禁止用歷史數據當今日價**

═══ 輸出第一部分:繁中 markdown 表格 ═══

| 金屬 | 最新報價 (USD) | 計價單位 | 日變動 | LME 庫存(公噸) | 庫存變動 |
| ---- | -------------: | :------: | -----: | -------------: | -------: |

規則:
- 基本金屬 USD/噸、貴金屬 USD/oz
- 貴金屬庫存欄一律填「—」
- 日變動欄:有「down 1.87%」填「-1.87%」;只有價格無比較填「—」
- **絕對禁止編造數字**

表格下方加:
- 3 條重點觀察(漲最多 / 跌最多 / 庫存異動 >1%)
- 資料時間戳記(各來源日期 — 台銀「11:10」/JM「08:30 HK」照實寫)
- 資料來源清單(列出本次實際使用到的 URL)

═══ 輸出第二部分:結構化 JSON 供 DB 落地 ═══

**⚠️ 這段是給 Pipeline 自動抓去寫資料庫,欄位嚴格對齊,數字型別用 number 非 string,
抓不到的欄位用 null,日期一律 YYYY-MM-DD 格式。**

每一筆 = 一個金屬從一個資料源的報價。欄位規範:

- \`metal_code\`:大寫縮寫 CU/AL/NI/SN/ZN/PB/AU/AG/PT/PD/RH
- \`original_price\` / \`original_currency\` / \`original_unit\`:來源網頁實際看到的報價(不做換算)
- \`price_usd\` / \`unit\`:換算後 USD 統一單位(基本金屬 \`USD/ton\`,貴金屬 \`USD/oz\`)
- \`fx_rate_to_usd\`:1 原幣 = N USD(USD→1.0,EUR 用當日抓到的匯率)
- \`conversion_note\`:有換算才填公式字串,無換算填 null
- \`price_type\`:\`spot\`/\`futures\`/\`fixing\`(JM Base Price / 台銀 / LBMA / LME 定盤)/\`estimate\`
- \`market\`:\`LME\`(基本金屬)/\`BOT\`(台銀金)/\`LBMA\`(Westmetall Silver)/\`JM\`(JM PGM)/\`COMEX\`
- \`grade\`:抓不到填 null
- \`source\` + \`source_url\`:**台銀 → "台灣銀行"**;**JM → "JohnsonMatthey"**;Westmetall / Kitco / TradingEconomics 用品牌名
- \`as_of_date\`:{{date}}

\`\`\`json
[
  {
    "metal_code":"CU","metal_name":"銅",
    "original_price":13190.00,"original_currency":"USD","original_unit":"USD/ton",
    "price_usd":13190.00,"unit":"USD/ton","fx_rate_to_usd":1.0,
    "conversion_note":null,
    "price_type":"spot","market":"LME","grade":"Grade A",
    "day_change_pct":null,"lme_stock":396000,"stock_change":425,
    "source":"Westmetall","source_url":"https://www.westmetall.com/en/markdaten.php",
    "as_of_date":"{{date}}"
  },
  {
    "metal_code":"AU","metal_name":"金",
    "original_price":4689.20,"original_currency":"USD","original_unit":"USD/oz (1英兩)",
    "price_usd":4689.20,"unit":"USD/oz","fx_rate_to_usd":1.0,
    "conversion_note":null,
    "price_type":"fixing","market":"BOT","grade":null,
    "day_change_pct":null,"lme_stock":null,"stock_change":null,
    "source":"台灣銀行","source_url":"https://rate.bot.com.tw/gold/obu?Lang=zh-TW",
    "as_of_date":"{{date}}"
  },
  {
    "metal_code":"AG","metal_name":"銀",
    "original_price":2119.35,"original_currency":"EUR","original_unit":"EUR/kg",
    "price_usd":77.07,"unit":"USD/oz","fx_rate_to_usd":1.1691,
    "conversion_note":"2,119.35 EUR/kg × 1.1691 ÷ 32.1507 oz/kg = 77.07 USD/oz",
    "price_type":"estimate","market":"LBMA","grade":null,
    "day_change_pct":null,"lme_stock":null,"stock_change":null,
    "source":"Westmetall","source_url":"https://www.westmetall.com/en/markdaten.php",
    "as_of_date":"{{date}}"
  },
  {
    "metal_code":"PT","metal_name":"鉑",
    "original_price":2019.00,"original_currency":"USD","original_unit":"USD/troy oz",
    "price_usd":2019.00,"unit":"USD/oz","fx_rate_to_usd":1.0,
    "conversion_note":null,
    "price_type":"fixing","market":"JM","grade":null,
    "day_change_pct":-1.87,"lme_stock":null,"stock_change":null,
    "source":"JohnsonMatthey","source_url":"https://matthey.com/pgm-prices/rss-feed.xml",
    "as_of_date":"{{date}}"
  },
  {
    "metal_code":"PD","metal_name":"鈀",
    "original_price":1500.00,"original_currency":"USD","original_unit":"USD/troy oz",
    "price_usd":1500.00,"unit":"USD/oz","fx_rate_to_usd":1.0,
    "conversion_note":null,
    "price_type":"fixing","market":"JM","grade":null,
    "day_change_pct":-0.57,"lme_stock":null,"stock_change":null,
    "source":"JohnsonMatthey","source_url":"https://matthey.com/pgm-prices/rss-feed.xml",
    "as_of_date":"{{date}}"
  },
  {
    "metal_code":"RH","metal_name":"銠",
    "original_price":10000.00,"original_currency":"USD","original_unit":"USD/troy oz",
    "price_usd":10000.00,"unit":"USD/oz","fx_rate_to_usd":1.0,
    "conversion_note":null,
    "price_type":"fixing","market":"JM","grade":null,
    "day_change_pct":0.00,"lme_stock":null,"stock_change":null,
    "source":"JohnsonMatthey","source_url":"https://matthey.com/pgm-prices/rss-feed.xml",
    "as_of_date":"{{date}}"
  }
]
\`\`\``;

  try {
    await db.prepare(`UPDATE scheduled_tasks SET prompt=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(newPrompt, id);
    const missing = [
      !hasBotMarker && '台銀金 fetch',
      !hasJmMarker && 'JM RSS',
    ].filter(Boolean).join(' + ');
    console.log(`[PMScheduledTaskSeed] Force-updated user task "[PM] 每日貴金屬行情" #${id}: ${missing}`);
  } catch (e) {
    console.warn(`[PMScheduledTaskSeed] patch user daily quote update #${id} failed:`, e.message);
  }
}

// ── 主 seed 入口 ────────────────────────────────────────────────────────────
async function autoSeedPmScheduledTasks(db, kbMap) {
  if (!db) {
    console.warn('[PMScheduledTaskSeed] db not ready, skip');
    return;
  }

  // 找一個 admin 當 owner
  let ownerId = null;
  try {
    const adminRow = await db.prepare(
      `SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`
    ).get();
    ownerId = adminRow?.id || null;
  } catch (_) {}
  if (!ownerId) {
    console.warn('[PMScheduledTaskSeed] no admin user, skip seeding');
    return;
  }

  // kbMap 沒給 → 自己跑一次 KB seed(獨立呼叫場景)
  if (!kbMap || !(kbMap instanceof Map)) {
    try {
      const { autoSeedPmKnowledgeBases } = require('./pmKnowledgeBaseSeed');
      kbMap = await autoSeedPmKnowledgeBases(db);
    } catch (e) {
      console.warn('[PMScheduledTaskSeed] inline pmKnowledgeBaseSeed failed:', e.message);
      kbMap = new Map();
    }
  }

  // 動態 pick model key — 優先 system_settings.pm_pro/pm_flash → default_chat → fuzzy match
  // 解決:dev 寫 'pro'/'flash',prod 是 'Gemini 3 Pro' lookup miss 崩潰
  const { pickModelKey } = require('./llmDefaults');
  const [proKey, flashKey] = await Promise.all([
    pickModelKey(db, 'pro').catch(() => ''),
    pickModelKey(db, 'flash').catch(() => ''),
  ]);
  const models = {
    pro: proKey || '',           // 空字串走 resolveTaskModel → default
    flash: flashKey || proKey || '',
  };
  console.log(`[PMScheduledTaskSeed] resolved models: pro="${models.pro}" flash="${models.flash}"`);
  if (!models.pro) {
    console.warn(`[PMScheduledTaskSeed] 找不到任何 active LLM 可當 PM Pro 模型;PM 任務 model 欄會空,執行時走系統 default_chat fallback。請到「PM 平台設定」UI 指定。`);
  }

  const tasks = [
    buildNewsTask(kbMap, models),  // 舊版整合 task (paused),user 自己決定砍或留
    // by-source 新聞 task (2026-04-29 B + E 策略,RSS-first + 拆 source)
    buildNewsMiningComTask(kbMap, models),
    buildNewsNikkeiTask(kbMap, models),
    buildNewsSmmTask(kbMap, models),
    buildNewsMoneyDjTask(kbMap, models),
    buildNewsPgmCommentaryTask(kbMap, models),
    buildMacroTask(models),
    buildDailyReportTask(kbMap, models),
    buildWeeklyReportTask(kbMap, models),
    buildMonthlyReportTask(kbMap, models),
    buildMasterScrapeTask(kbMap, models),
  ];

  let inserted = 0;
  let skippedExisting = 0;

  for (const t of tasks) {
    try {
      const existing = await db.prepare(`SELECT id FROM scheduled_tasks WHERE name=?`).get(t.name);
      if (existing) { skippedExisting++; continue; }

      await db.prepare(`
        INSERT INTO scheduled_tasks (
          user_id, name, schedule_type, schedule_hour, schedule_minute,
          schedule_weekday, schedule_monthday,
          schedule_times_json, schedule_interval_hours, schedule_cron_expr,
          model, prompt, output_type, file_type, filename_template,
          recipients_json, email_subject, email_body, status, pipeline_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ownerId, t.name, t.schedule_type, t.schedule_hour, t.schedule_minute,
        t.schedule_weekday ?? 1, t.schedule_monthday ?? 1,
        t.schedule_times_json, t.schedule_interval_hours, t.schedule_cron_expr || null,
        t.model, t.prompt, t.output_type, t.file_type, t.filename_template,
        t.recipients_json, t.email_subject, t.email_body, t.status, t.pipeline_json
      );
      inserted++;
      console.log(`[PMScheduledTaskSeed] Inserted (paused): ${t.name}`);
    } catch (e) {
      console.error(`[PMScheduledTaskSeed] INSERT ${t.name} failed:`, e.message);
    }
  }

  if (inserted > 0) {
    console.log(`[PMScheduledTaskSeed] v${SEED_VERSION} — ${inserted} inserted, ${skippedExisting} already existed`);
    console.log(`[PMScheduledTaskSeed] 提醒:這些任務預設 status='paused',admin 需檢查 prompt / 加收件人後才能 enable(kb_id 已自動帶入)`);
  } else if (skippedExisting > 0) {
    console.log(`[PMScheduledTaskSeed] All ${skippedExisting} tasks already exist, no insert needed`);
  }

  // Patch 既有任務:fill in kb_id where empty
  await patchExistingTaskKbIds(db, kbMap);

  // Patch 早期 seed 進去 kb_id + kb_name 都空的 task(早期 patchExistingTaskKbIds 因為
  // `if (!n.kb_name) continue` skip 救不到)。從 task name 反推 KB,補 name + id。
  await patchKbWriteRestoreNamesByTask(db, kbMap);

  // Patch 既有任務:把 model='pro'/'flash'(舊 seed 寫死的)替換成新 pickModelKey 結果
  await patchExistingTaskModels(db, models);

  // Patch 既有任務:db_write(pm_news)補 published_at mapping(Phase 5 後修正)
  await patchExistingNewsPublishedAtMapping(db);

  // Patch 既有任務:db_write(forecast_history)補 array_path(原 seed 是 placeholder)
  await patchExistingForecastArrayPath(db);

  // Patch 既有任務:[PM] 全網金屬資料收集 加 db_write→pm_price_history(2026-04-28)
  // 升級 prompt 為 { news, prices } object 格式 + 加新 db_write 節點
  // 2026-04-28 進一步:沒 JohnsonMatthey marker 也升級到新版 prompt(JM RSS 為 PGM 主源)
  await patchExistingMasterScrapeAddPriceWrite(db, kbMap, models);

  // Patch 既有任務:[PM] 每日金屬新聞抓取 加 PGM 機構級評論源(WPIC + matthey)
  await patchExistingNewsAddPgmSources(db);

  // 2026-04-29:patch [PM] 新聞 PGM評論 cutoff 7d → 60d(WPIC/JM 更新慢)
  await patchExistingPgmCommentaryCutoff60(db);

  // Patch user 自建任務:[PM] 每日貴金屬行情(台銀金 + JM RSS + Kitco silver)
  await patchUserDailyMetalQuoteTask(db);

  // Patch 既有任務:[PM] 每日金屬新聞抓取 改 upsert by url_hash(2026-04-28)
  // 解決重複 url 撞 UQ_NEWS_URL_HASH 全部 skipped
  await patchExistingNewsToUpsert(db);

  // Patch 既有任務:[PM] 總體經濟指標日抓 source 從 key + required 拿掉(2026-04-28)
  // 解決 LLM 漏 source 欄就整列 skip
  await patchExistingMacroLooserKeys(db);

  // Patch 既有任務:[PM] 總體經濟指標日抓 拿掉 is_estimated(prompt + mapping)
  // pm_macro_history schema 沒這欄,LLM 別再浪費 token 輸出(2026-04-28)
  await patchExistingMacroDropIsEstimated(db);
}

// ── 把既有 PM 任務的 model 從舊 alias('pro'/'flash')patch 到 pickModelKey 的結果 ───
async function patchExistingTaskModels(db, models) {
  if (!models || (!models.pro && !models.flash)) return;
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, model FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch model select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const cur = String(r.model || '').toLowerCase();
    // 只 patch 看起來像 alias 的(短字 / 完全等於 'pro'/'flash')— 不動 admin 已改成具體 api name 的
    const isOldAlias = cur === 'pro' || cur === 'flash';
    if (!isOldAlias) continue;

    const isFlashTask = /新聞|總體經濟/.test(r.name);
    const targetKey = isFlashTask ? (models.flash || models.pro) : models.pro;
    if (!targetKey || targetKey === r.model) continue;

    try {
      await db.prepare(`UPDATE scheduled_tasks SET model=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(targetKey, r.id);
      patched++;
      console.log(`[PMScheduledTaskSeed] patched task #${r.id} "${r.name || r.NAME}" model: ${cur} → ${targetKey}`);
    } catch (e) {
      console.warn(`[PMScheduledTaskSeed] patch model task #${r.id} failed:`, e.message);
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] patched ${patched} existing task(s) model alias → real key`);
}

module.exports = {
  autoSeedPmScheduledTasks,
  SEED_VERSION,
};
