'use strict';

/**
 * empMatchService — ERP 補資料(姓名反查 ERP → 權威工號/Email,人工審核)
 *
 * 背景:各廠 AD 規則不一,登入建帳號後常缺工號/Email,且 [empIdExtractor] 從 displayName 猜的
 * 工號可能根本不是 ERP 真正的 EMPLOYEE_NO(猜錯 → orgSync 正查不到 → email 永遠空)。
 * 所以這裡改用「姓名」反查 ERP foxfl.fl_emp_exp_all 取得權威工號 + Email,人工審核後寫回。
 *
 * Pipeline:
 *   Stage 1 候選生成(純 SQL,批次):exact C_NAME IN → 補 LIKE(抓 ERP 側混英文的)
 *   Stage 2 分流:
 *     - 無中文名         → tier C / no_match(疑似共用帳號,建議豁免)
 *     - 0 候選           → tier C / no_match(ERP 查無在職)
 *     - 1 候選精確相等   → tier A(高信心,免 LLM)
 *     - 1 候選但混名     → tier B(中信心,免 LLM)
 *     - ≥2 候選          → tier B(LLM 語意比對挑一個)
 *   Stage 3 LLM(只 tier B 多候選):Flash + 結構化 JSON,批次打包省 token
 *
 * 寫入策略:一個 user 一筆建議(unique index),scan 用 delete-then-insert 刷新
 *   status IN (pending/no_match/conflict) 的舊列;accepted/rejected 不動、且 scan 不重撈。
 *
 * accept 時工號衝突(已被別的帳號占用)→ 擋下標 conflict 給人工處理,不自動寫。
 */

const erpDb = require('./erpDb');

const FLASH = () => process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash';
const LLM_BATCH = 15;

// 取核心中文姓名:抓最長的 CJK 連續段(把英文名/拼音/括號/工號雜訊濾掉)
function extractCoreName(name) {
  if (!name) return '';
  const runs = String(name).match(/[㐀-鿿豈-﫿·‧・]+/g);
  if (!runs || !runs.length) return '';
  return runs.sort((a, b) => b.length - a.length)[0].trim();
}

function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.search(/[\[{]/);
  if (s < 0) return null;
  t = t.slice(s);
  try { return JSON.parse(t); } catch (_) {}
  const e = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (e > 0) { try { return JSON.parse(t.slice(0, e + 1)); } catch (_) {} }
  return null;
}

// ── Stage 1:候選生成 ──────────────────────────────────────────────────────────
// 回傳 Map<coreName, candidate[]>;candidate = { emp_no, email, name, dept_code, profit_center }
async function fetchCandidates(coreNames) {
  const byCore = new Map();
  const addRow = (r) => {
    const core = extractCoreName(r.C_NAME);
    if (!core) return;
    if (!byCore.has(core)) byCore.set(core, []);
    const arr = byCore.get(core);
    const empNo = String(r.EMPLOYEE_NO || '').trim();
    if (arr.some((x) => x.emp_no === empNo)) return; // 去重
    arr.push({
      emp_no: empNo,
      email: (r.EMAIL || '').trim() || null,
      name: (r.C_NAME || '').trim(),
      dept_code: (r.DEPT_CODE || '').trim() || null,
      profit_center: (r.PROFIT_CENTER || '').trim() || null,
    });
  };

  const names = [...new Set(coreNames.filter(Boolean))];
  if (!names.length) return byCore;

  const BASE = `SELECT C_NAME, EMPLOYEE_NO, EMAIL, DEPT_CODE, PROFIT_CENTER
                FROM foxfl.fl_emp_exp_all
                WHERE CURRENT_FLAG='Y' AND END_DATE IS NULL`;

  // 1a. exact IN(分塊,避免 IN list 過長)
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    const binds = {};
    const ph = chunk.map((n, j) => { binds['c' + j] = n; return ':c' + j; }).join(',');
    const r = await erpDb.execute(`${BASE} AND C_NAME IN (${ph})`, binds);
    for (const row of (r?.rows || [])) addRow(row);
  }

  // 1b. 對 exact 沒命中的核心名跑 LIKE(抓 ERP 側 C_NAME 也含英文/括號的,如 "趙開心(Joy)")
  const unmatched = names.filter((n) => !byCore.has(n));
  for (let i = 0; i < unmatched.length; i += 40) {
    const chunk = unmatched.slice(i, i + 40);
    const binds = {};
    const ors = chunk.map((n, j) => { binds['l' + j] = '%' + n + '%'; return `C_NAME LIKE :l${j}`; }).join(' OR ');
    const r = await erpDb.execute(`${BASE} AND (${ors})`, binds);
    for (const row of (r?.rows || [])) addRow(row);
  }

  return byCore;
}

// ── Stage 3:LLM 語意比對(只 tier B 多候選)──────────────────────────────────
async function llmDisambiguate(items) {
  // items: [{ user, coreName, cands }]
  const { generateTextSync } = require('./gemini');
  const out = new Map(); // user_id → { emp_no, confidence, reason }

  for (let i = 0; i < items.length; i += LLM_BATCH) {
    const batch = items.slice(i, i + LLM_BATCH);
    const lines = batch.map((it, idx) => {
      const u = it.user;
      const org = [u.dept_name, u.profit_center_name, u.factory_code].filter(Boolean).join(' / ') || '(無)';
      const cands = it.cands.map((c, k) =>
        `${String.fromCharCode(65 + k)}) emp_no=${c.emp_no} name=${c.name} dept=${c.dept_code || '-'} pc=${c.profit_center || '-'}`
      ).join('  ');
      return `[${idx + 1}] user_id=${u.id} ad_name="${u.name || ''}" username="${u.username || ''}" 現有組織=${org}\n     候選: ${cands}`;
    }).join('\n');

    const prompt = `你是 HR 資料比對助手。下列「帳號」是從 AD 同步進來、缺工號或 Email 的使用者,需要從 ERP 員工主檔候選中挑出對應的真人。
AD 姓名可能含英文名或拼音;候選都是在職員工。判斷依據(優先序):中文姓名相符 > 部門/利潤中心與帳號既有組織線索一致 > username/email domain 的廠區線索。
無法合理判定就回 matched_emp_no=null(寧可讓人工選,不要亂猜)。

${lines}

只輸出 JSON 陣列,不要任何其他文字,格式:
[{"user_id":123,"matched_emp_no":"0012345","confidence":0.0,"reason":"中文姓名相符且部門一致"}]`;

    try {
      const r = await generateTextSync(FLASH(), [], prompt);
      const arr = parseJsonLoose(r.text);
      if (Array.isArray(arr)) {
        for (const o of arr) {
          if (o && o.user_id != null) {
            out.set(Number(o.user_id), {
              emp_no: o.matched_emp_no ? String(o.matched_emp_no).trim() : null,
              confidence: typeof o.confidence === 'number' ? o.confidence : null,
              reason: o.reason ? String(o.reason).slice(0, 900) : null,
            });
          }
        }
      }
    } catch (e) {
      console.warn('[empMatch] LLM batch error:', e.message);
    }
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function scanUsers(db, { userIds = null, useLLM = true } = {}) {
  if (!erpDb.isConfigured()) return { ok: false, reason: 'ERP not configured' };

  // 1. 撈待處理 users:缺工號 或 缺 Email、未豁免、且沒有 accepted/rejected 建議
  let sql = `
    SELECT u.id, u.username, u.name, u.employee_id, u.employee_id_source, u.email,
           u.dept_name, u.profit_center_name, u.factory_code
    FROM users u
    WHERE u.status='active'
      AND NVL(u.emp_match_exempt,0)=0
      AND ( u.employee_id IS NULL OR u.email IS NULL OR u.email='-' OR TRIM(u.email)='' )
      AND NOT EXISTS (
        SELECT 1 FROM emp_match_suggestions s
        WHERE s.user_id=u.id AND s.status IN ('accepted','rejected'))`;
  const params = [];
  if (Array.isArray(userIds) && userIds.length) {
    sql += ` AND u.id IN (${userIds.map(() => '?').join(',')})`;
    params.push(...userIds);
  }
  const users = await db.prepare(sql).all(...params);
  if (!users.length) return { ok: true, scanned: 0, tierA: 0, tierB: 0, tierC: 0, no_match: 0 };

  // 2. 候選生成
  for (const u of users) u._core = extractCoreName(u.name);
  const byCore = await fetchCandidates(users.map((u) => u._core));

  // 3. 分流
  const suggestions = []; // 每個 user 一筆
  const llmQueue = [];     // tier B 多候選,進 LLM
  for (const u of users) {
    const core = u._core;
    const cands = core ? (byCore.get(core) || []) : [];

    if (!core) {
      suggestions.push({ user: u, status: 'no_match', tier: 'C', reason: '無中文姓名,疑似共用/管理帳號,建議豁免', cands: [] });
      continue;
    }
    if (cands.length === 0) {
      suggestions.push({ user: u, status: 'no_match', tier: 'C', reason: 'ERP 查無在職員工', cands: [] });
      continue;
    }
    if (cands.length === 1) {
      const c = cands[0];
      const exact = c.name === core;
      suggestions.push({
        user: u, status: 'pending', tier: exact ? 'A' : 'B',
        confidence: exact ? 0.97 : 0.8, pick: c, cands,
        reason: exact ? '姓名精確唯一命中' : '唯一候選(ERP 側姓名含其他字元)',
      });
      continue;
    }
    // ≥2 候選 → LLM
    llmQueue.push({ user: u, coreName: core, cands });
  }

  // 3b. LLM 比對
  if (useLLM && llmQueue.length) {
    const verdicts = await llmDisambiguate(llmQueue);
    for (const it of llmQueue) {
      const v = verdicts.get(Number(it.user.id));
      const pick = v && v.emp_no ? it.cands.find((c) => c.emp_no === v.emp_no) : null;
      suggestions.push({
        user: it.user, status: 'pending', tier: 'B', cands: it.cands,
        pick: pick || null,
        confidence: pick ? (v.confidence ?? 0.7) : 0.3,
        reason: pick ? (v.reason || 'AI 比對') : 'AI 無法判定,請人工從候選挑選',
      });
    }
  } else if (llmQueue.length) {
    // 不跑 LLM:多候選一律交人工
    for (const it of llmQueue) {
      suggestions.push({ user: it.user, status: 'pending', tier: 'B', cands: it.cands, pick: null, confidence: 0.3, reason: '多個同名候選,請人工挑選' });
    }
  }

  // 4. 寫入(delete-then-insert,只動 pending/no_match/conflict)
  const ids = users.map((u) => u.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.prepare(
      `DELETE FROM emp_match_suggestions WHERE status IN ('pending','no_match','conflict')
        AND user_id IN (${chunk.map(() => '?').join(',')})`
    ).run(...chunk);
  }

  const counts = { tierA: 0, tierB: 0, tierC: 0, no_match: 0 };
  for (const sug of suggestions) {
    const p = sug.pick || null;
    await db.prepare(`
      INSERT INTO emp_match_suggestions
        (user_id, status, tier, suggested_emp_no, suggested_email, suggested_name, suggested_dept, confidence, reason, candidates_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sug.user.id, sug.status, sug.tier,
      p ? p.emp_no : null,
      p ? p.email : null,
      p ? p.name : null,
      p ? [p.dept_code, p.profit_center].filter(Boolean).join(' / ') || null : null,
      sug.confidence ?? null,
      sug.reason || null,
      sug.cands && sug.cands.length ? JSON.stringify(sug.cands) : null,
    );
    if (sug.status === 'no_match') counts.no_match++;
    else if (sug.tier === 'A') counts.tierA++;
    else if (sug.tier === 'B') counts.tierB++;
    else counts.tierC++;
  }

  return { ok: true, scanned: users.length, llm_used: useLLM ? llmQueue.length : 0, ...counts };
}

// ── 接受建議:寫回 user + 衝突擋下 + 回填組織 ──────────────────────────────────
async function acceptSuggestion(db, id, adminUsername, overrideEmpNo = null) {
  const s = await db.prepare('SELECT * FROM emp_match_suggestions WHERE id=?').get(id);
  if (!s) throw new Error('建議不存在');
  const empNo = (overrideEmpNo || s.suggested_emp_no || '').toString().trim();
  if (!empNo) throw new Error('此建議無工號可寫入,請改用人工挑選候選');

  // 工號衝突 → 擋下人工處理(不自動寫)
  const conflict = await db.prepare(
    `SELECT id, username, name FROM users WHERE employee_id=? AND id<>?`
  ).get(empNo, s.user_id);
  if (conflict) {
    await db.prepare(
      `UPDATE emp_match_suggestions SET status='conflict', conflict_user_id=?, suggested_emp_no=?,
         reviewed_by=?, reviewed_at=SYSTIMESTAMP WHERE id=?`
    ).run(conflict.id, empNo, adminUsername, id);
    return { ok: false, conflict: true, conflictUser: conflict };
  }

  // 決定要不要補 email(僅當 user 目前空白才覆蓋,避免蓋掉手動填的)
  let email = overrideEmpNo
    ? await _emailForEmpNo(empNo) // 人工改了工號 → 重抓對應 email
    : (s.suggested_email || null);

  await db.prepare(`
    UPDATE users SET
      employee_id=?, employee_id_source='ai_matched',
      email=CASE WHEN (email IS NULL OR email='-' OR TRIM(email)='') THEN ? ELSE email END
    WHERE id=?`
  ).run(empNo, email || null, s.user_id);

  await db.prepare(
    `UPDATE emp_match_suggestions SET status='accepted', suggested_emp_no=?, suggested_email=COALESCE(?, suggested_email),
       reviewed_by=?, reviewed_at=SYSTIMESTAMP WHERE id=?`
  ).run(empNo, email || null, adminUsername, id);

  // 回填組織(複用 orgSyncService,順便把 email/name 也補齊)
  try {
    const { syncOrgToUsers } = require('./orgSyncService');
    await syncOrgToUsers(db, [empNo], 'manual');
  } catch (e) {
    console.warn('[empMatch] orgSync after accept failed:', e.message);
  }

  return { ok: true, employee_id: empNo, email: email || null };
}

// 人工改工號時補抓 ERP email
async function _emailForEmpNo(empNo) {
  try {
    const r = await erpDb.execute(
      `SELECT EMAIL FROM foxfl.fl_emp_exp_all WHERE EMPLOYEE_NO=:e AND CURRENT_FLAG='Y' AND END_DATE IS NULL`,
      { e: String(empNo) }
    );
    const row = (r?.rows || [])[0];
    return row ? ((row.EMAIL || '').trim() || null) : null;
  } catch (_) { return null; }
}

async function rejectSuggestion(db, id, adminUsername) {
  await db.prepare(
    `UPDATE emp_match_suggestions SET status='rejected', reviewed_by=?, reviewed_at=SYSTIMESTAMP WHERE id=?`
  ).run(adminUsername, id);
  return { ok: true };
}

async function exemptUser(db, userId, reason, adminUsername) {
  await db.prepare(
    `UPDATE users SET emp_match_exempt=1, emp_match_exempt_reason=?, emp_match_exempt_by=?, emp_match_exempt_at=SYSTIMESTAMP WHERE id=?`
  ).run(reason || null, adminUsername, userId);
  // 清掉待審/查無/衝突列,讓審核清單乾淨(accepted/rejected 保留作 audit)
  await db.prepare(
    `DELETE FROM emp_match_suggestions WHERE user_id=? AND status IN ('pending','no_match','conflict')`
  ).run(userId);
  return { ok: true };
}

async function unexemptUser(db, userId) {
  await db.prepare(
    `UPDATE users SET emp_match_exempt=0, emp_match_exempt_reason=NULL, emp_match_exempt_by=NULL, emp_match_exempt_at=NULL WHERE id=?`
  ).run(userId);
  return { ok: true };
}

module.exports = {
  scanUsers, acceptSuggestion, rejectSuggestion, exemptUser, unexemptUser,
  extractCoreName, // 匯出供測試
};
