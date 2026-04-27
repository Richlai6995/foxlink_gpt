'use strict';

/**
 * PM Source List — Phase 5 Track F-3 監控對象
 *
 * 18 個 sources 對應 [PM] 全網金屬資料收集 排程的 prompt list。
 * 同步來源:server/services/pmScheduledTaskSeed.js L612-629
 *
 * 維護:若 prompt 內 source 改變,本檔需同步更新(避免監控不全)。
 * 之後若 source list 變動頻繁,可改成 DB-driven(寫進 system_settings)。
 */

// 健康檢查 URL — 不一定要跟 LLM 排程實際抓的 URL 完全一致
// 例 Mining/OilPrice 改用 RSS feed:RSS 是設計給 bot 的,不被 Cloudflare 擋,可靠驗證網站存活
// LLM 排程仍用 HTML URL(LLM fetch 工具帶完整 browser headers,通常能繞 anti-bot)
const PM_SOURCES = [
  { url: 'https://www.kitco.com/charts/livegold.html',                    label: 'Kitco Live Gold' },
  { url: 'https://www.kitco.com/charts/livesilver.html',                  label: 'Kitco Live Silver' },
  { url: 'https://www.kitco.com/news/',                                   label: 'Kitco News' },
  { url: 'https://www.westmetall.com/en/markdaten.php',                   label: 'Westmetall Market Data' },
  // Westmetall /en/news.php 2026-04-27 起回 404(可能改版),先移除
  // 若之後找到新 news URL 再補進來;現有 markdaten.php 仍能撈報價
  { url: 'https://tradingeconomics.com/commodity/copper',                 label: 'TE Copper' },
  { url: 'https://tradingeconomics.com/commodity/aluminum',               label: 'TE Aluminum' },
  { url: 'https://tradingeconomics.com/commodity/nickel',                 label: 'TE Nickel' },
  { url: 'https://tradingeconomics.com/commodity/zinc',                   label: 'TE Zinc' },
  { url: 'https://tradingeconomics.com/commodity/lead',                   label: 'TE Lead' },
  { url: 'https://tradingeconomics.com/commodity/gold',                   label: 'TE Gold' },
  { url: 'https://tradingeconomics.com/commodity/silver',                 label: 'TE Silver' },
  { url: 'https://tradingeconomics.com/commodity/platinum',               label: 'TE Platinum' },
  { url: 'https://tradingeconomics.com/commodity/palladium',              label: 'TE Palladium' },
  // Mining.com /feed/ 是 WordPress 標準 RSS,實測通(2026-04-27)
  { url: 'https://www.mining.com/feed/',                                  label: 'Mining.com (RSS)' },
  // OilPrice /rss/main 公開 RSS,實測通(2026-04-27)
  { url: 'https://oilprice.com/rss/main',                                 label: 'OilPrice (RSS)' },
  // LME 整站 Cloudflare 擋,連 RSS 都沒;預期持續 anti_bot
  { url: 'https://www.lme.com/Metals/Non-ferrous/LME-Copper',             label: 'LME Copper' },
  { url: 'https://www.investing.com/commodities/metals',                  label: 'Investing.com Metals' },
];

module.exports = { PM_SOURCES };
