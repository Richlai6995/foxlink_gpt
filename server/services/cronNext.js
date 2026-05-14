'use strict';
/**
 * 極簡 cron next-fire 計算器(Asia/Taipei timezone-aware)
 *
 * 為 alertRuleScheduler 提供「給定 cron expr,算下次 fire 的 UTC Date」。
 * 全 cron 太重不需要,只支援這個專案實際用到的三種 pattern:
 *
 *   1. daily   :`M H * * *`              (例:`0 8 * * *` 每日 8:00)
 *   2. weekly  :`M H * * D`              (例:`0 8 * * 1` 每週一 8:00, D=0-6 Sun=0)
 *   3. monthly :`M H D * *`              (例:`0 8 1 * *` 每月 1 號 8:00, D=1-31)
 *
 * 其他複雜 pattern(逗號列表 / 範圍 / step / 多月) — 一律 reject,維護成本不值得。
 * 真要用 full cron,後續再引 `cron-parser` dep。
 *
 * Timezone: Asia/Taipei(對齊 alertRuleScheduler / scheduledTaskService 既有設定)
 * 回傳:絕對時間 Date 物件(JS Date 本身是 UTC,setHours 用本機 tz 處理需小心)
 */

const TZ = 'Asia/Taipei';

// 解析 cron 表達式 → { kind, minute, hour, dayOfMonth, dayOfWeek }
// 失敗回 null
function parseCron(expr) {
  if (!expr || typeof expr !== 'string') return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;

  // month 一律 * (我們只 cover 「每月某天」/「每週某天」/「每日」)
  if (mon !== '*') return null;

  const minute = parseFixedInt(m, 0, 59);
  const hour = parseFixedInt(h, 0, 23);
  if (minute == null || hour == null) return null;

  const domIsStar = dom === '*';
  const dowIsStar = dow === '*';

  if (domIsStar && dowIsStar) {
    return { kind: 'daily', minute, hour };
  }
  if (!domIsStar && dowIsStar) {
    const d = parseFixedInt(dom, 1, 31);
    if (d == null) return null;
    return { kind: 'monthly', minute, hour, dayOfMonth: d };
  }
  if (domIsStar && !dowIsStar) {
    const d = parseFixedInt(dow, 0, 6);
    if (d == null) return null;
    return { kind: 'weekly', minute, hour, dayOfWeek: d };
  }
  // 同時指定 dom + dow:cron 慣例是「或」關係,我們不支援
  return null;
}

function parseFixedInt(s, lo, hi) {
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (n < lo || n > hi) return null;
  return n;
}

// 把 Date 轉成 Asia/Taipei 的 {y, mo, d, h, m, s, dow} 表示
// JS 沒原生 tz 計算,用 Intl.DateTimeFormat 取分量
function inTaipei(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: parseInt(parts.year, 10),
    mo: parseInt(parts.month, 10),
    d: parseInt(parts.day, 10),
    h: parseInt(parts.hour === '24' ? '00' : parts.hour, 10),
    m: parseInt(parts.minute, 10),
    s: parseInt(parts.second, 10),
    dow: dowMap[parts.weekday],
  };
}

// 從台北時間分量 {y, mo, d, h, m} 反算 UTC Date
// 做法:猜一個 UTC Date,把它 inTaipei,看到差就調整,迭代收斂(最多 2 次)
function fromTaipei({ y, mo, d, h, m }) {
  // 第一猜:當 UTC 給,然後 8 小時 offset 補(夏令時無,台北沒夏令時)
  let guess = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
  for (let i = 0; i < 3; i++) {
    const tp = inTaipei(guess);
    const deltaMs =
      (Date.UTC(y, mo - 1, d, h, m, 0) - Date.UTC(tp.y, tp.mo - 1, tp.d, tp.h, tp.m, 0));
    if (deltaMs === 0) break;
    guess = new Date(guess.getTime() + deltaMs);
  }
  return guess;
}

// daily: from 之後第一個 hh:mm(台北時)
function nextDaily(from, hour, minute) {
  const tp = inTaipei(from);
  let target = fromTaipei({ y: tp.y, mo: tp.mo, d: tp.d, h: hour, m: minute });
  if (target <= from) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
    // 跨日:設成今天的 +1 天 hh:mm(避免夏令時 ±1 小時偏移,雖然台北沒夏令時)
    const tp2 = inTaipei(target);
    target = fromTaipei({ y: tp2.y, mo: tp2.mo, d: tp2.d, h: hour, m: minute });
  }
  return target;
}

// weekly: from 之後第一個 (dow @ hh:mm) 台北時
function nextWeekly(from, hour, minute, dow) {
  const tp = inTaipei(from);
  let daysToAdd = (dow - tp.dow + 7) % 7;
  let target = fromTaipei({ y: tp.y, mo: tp.mo, d: tp.d, h: hour, m: minute });
  if (daysToAdd === 0 && target <= from) daysToAdd = 7;
  if (daysToAdd > 0) {
    target = new Date(target.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    const tp2 = inTaipei(target);
    target = fromTaipei({ y: tp2.y, mo: tp2.mo, d: tp2.d, h: hour, m: minute });
  }
  return target;
}

// monthly: from 之後第一個 (該月 dayOfMonth @ hh:mm)
function nextMonthly(from, hour, minute, dom) {
  const tp = inTaipei(from);
  let y = tp.y, mo = tp.mo;
  // 嘗試本月
  let target = fromTaipei({ y, mo, d: dom, h: hour, m: minute });
  // 驗證 fromTaipei 沒掉到別月(2 月 31 → 3 月 3)
  const tpT = inTaipei(target);
  const monthMismatch = (tpT.mo !== mo) || (tpT.d !== dom);
  if (monthMismatch || target <= from) {
    // 本月不行(已過 / 該月沒這天) → 跳下個月
    do {
      mo++;
      if (mo > 12) { mo = 1; y++; }
      target = fromTaipei({ y, mo, d: dom, h: hour, m: minute });
      const tpT2 = inTaipei(target);
      // 若 dom 大於該月日數,跳下月
      if (tpT2.mo === mo && tpT2.d === dom) break;
    } while (true);
  }
  return target;
}

// 主入口:給 cron expr 跟基準時間,回下次 fire 的 UTC Date(或 null)
function nextFire(cronExpr, fromDate = new Date()) {
  const c = parseCron(cronExpr);
  if (!c) return null;
  switch (c.kind) {
    case 'daily':   return nextDaily(fromDate, c.hour, c.minute);
    case 'weekly':  return nextWeekly(fromDate, c.hour, c.minute, c.dayOfWeek);
    case 'monthly': return nextMonthly(fromDate, c.hour, c.minute, c.dayOfMonth);
  }
  return null;
}

// 驗證 cron expr 是否被我們支援(給 admin UI / seed script 預驗)
function isSupportedCron(cronExpr) {
  return parseCron(cronExpr) != null;
}

module.exports = { nextFire, isSupportedCron, parseCron, inTaipei };
