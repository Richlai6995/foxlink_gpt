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

const PM_SOURCES = [
  { url: 'https://www.kitco.com/charts/livegold.html',                    label: 'Kitco Live Gold' },
  { url: 'https://www.kitco.com/charts/livesilver.html',                  label: 'Kitco Live Silver' },
  { url: 'https://www.kitco.com/news/',                                   label: 'Kitco News' },
  { url: 'https://www.westmetall.com/en/markdaten.php',                   label: 'Westmetall Market Data' },
  { url: 'https://www.westmetall.com/en/news.php',                        label: 'Westmetall News' },
  { url: 'https://tradingeconomics.com/commodity/copper',                 label: 'TE Copper' },
  { url: 'https://tradingeconomics.com/commodity/aluminum',               label: 'TE Aluminum' },
  { url: 'https://tradingeconomics.com/commodity/nickel',                 label: 'TE Nickel' },
  { url: 'https://tradingeconomics.com/commodity/zinc',                   label: 'TE Zinc' },
  { url: 'https://tradingeconomics.com/commodity/lead',                   label: 'TE Lead' },
  { url: 'https://tradingeconomics.com/commodity/gold',                   label: 'TE Gold' },
  { url: 'https://tradingeconomics.com/commodity/silver',                 label: 'TE Silver' },
  { url: 'https://tradingeconomics.com/commodity/platinum',               label: 'TE Platinum' },
  { url: 'https://tradingeconomics.com/commodity/palladium',              label: 'TE Palladium' },
  { url: 'https://www.mining.com/news/',                                  label: 'Mining.com News' },
  { url: 'https://oilprice.com/Latest-Energy-News/',                      label: 'OilPrice News' },
  { url: 'https://www.lme.com/Metals/Non-ferrous/LME-Copper',             label: 'LME Copper' },
  { url: 'https://www.investing.com/commodities/metals',                  label: 'Investing.com Metals' },
];

module.exports = { PM_SOURCES };
