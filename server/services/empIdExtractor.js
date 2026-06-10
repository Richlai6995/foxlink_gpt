'use strict';

/**
 * empIdExtractor — 多 tier 工號 extraction
 *
 * 背景:正崴每家子公司 AD 規則不同,displayName / sAMAccountName / email / LDAP 屬性
 * 塞工號的位置都不一樣。原本 [auth.js] 只認 "12345 王小明"(displayName 純數字 prefix),
 * 結果 KM492 張小春 / 純數字 sAMAccountName / 純 vendor 帳號通通失敗,要 admin 手動補。
 *
 * 這個 helper 把 extraction 邏輯抽出來集中管,加多個 fallback tier,大幅減少人工。
 *
 * 工號 pattern:
 *   - 純數字 4+ 位(foxlink/foxlinkxz 大宗:6651 / 9759 / 1872747 / 675815)
 *   - 1-3 個英文字母 + 3+ 數字(子公司或外部 vendor 格式:KM492 / U0033 / J0012)
 *
 * Tier 順序(優先序):
 *   1. ldap_attr        — LDAP `employeeID` / `employeeNumber` 屬性直接給(最權威)
 *   2. displayName_*    — displayName parse 出 token(prefix / suffix / 整串都是工號)
 *   3. sAMAccountName   — username 本身就是工號(像 `1872747` / `KM492` / `675815`)
 *   4. email_local_part — email @ 之前是工號(像 `675815@foxlinkxz.com`)
 *
 * 都失敗就回 null,讓 admin 在 UI 上看到「需要手動補」的警示。
 */

// 工號正規:純數字 4+ 位 或 1-3 字母 + 3+ 數字
// 不收 1-3 位純數字 — 太短的數字常是 sAMAccountName 後綴湊出來的 false positive
const EMP_RE = /^([A-Z]{1,3}\d{3,}|\d{4,})$/i;

function isEmpFormat(s) {
  if (!s || typeof s !== 'string') return false;
  return EMP_RE.test(s.trim());
}

function normalize(s) {
  return String(s).trim().toUpperCase();
}

/**
 * 多 tier extraction。輸入支援 LDAP 屬性 + SSO emp_cd hint。
 *
 * @param {object} input
 * @param {string} [input.displayName]
 * @param {string} [input.sAMAccountName]
 * @param {string} [input.mail]
 * @param {string|string[]} [input.ldapEmpAttr]   — `employeeID` / `employeeNumber` LDAP attr 直接給
 * @param {string} [input.cn]                      — 部分 AD 沒 displayName,落到 cn
 * @returns {{ empId: string|null, source: string|null, parsedName: string|null }}
 *   parsedName 只有 displayName_prefix / displayName_suffix 才會回(順便切出來給 caller 用)
 */
function extractEmpId(input = {}) {
  const ldapEmpAttrRaw = Array.isArray(input.ldapEmpAttr) ? input.ldapEmpAttr[0] : input.ldapEmpAttr;
  const ldapEmpAttr = ldapEmpAttrRaw ? String(ldapEmpAttrRaw).trim() : '';

  // Tier 1: LDAP 直接給的 employeeID / employeeNumber
  // 這個權威性最高,即使格式不符 EMP_RE 也接受(子公司亂取的格式 admin 可看 source 自行判斷)
  if (ldapEmpAttr) {
    return { empId: normalize(ldapEmpAttr), source: 'ldap_attr', parsedName: null };
  }

  // Tier 2: displayName / cn 拆 token 找
  const dn = (input.displayName && String(input.displayName).trim())
          || (input.cn          && String(input.cn).trim())
          || '';
  if (dn) {
    // 用空白 / 全形空白 / dash / underscore 都當分隔
    const tokens = dn.split(/[\s　_\-]+/).filter(Boolean);

    if (tokens.length >= 2 && isEmpFormat(tokens[0])) {
      return {
        empId: normalize(tokens[0]),
        source: 'displayName_prefix',
        parsedName: tokens.slice(1).join(' '),
      };
    }
    if (tokens.length >= 2 && isEmpFormat(tokens[tokens.length - 1])) {
      return {
        empId: normalize(tokens[tokens.length - 1]),
        source: 'displayName_suffix',
        parsedName: tokens.slice(0, -1).join(' '),
      };
    }
    if (tokens.length === 1 && isEmpFormat(tokens[0])) {
      return { empId: normalize(tokens[0]), source: 'displayName_only', parsedName: null };
    }
  }

  // Tier 3: sAMAccountName 本身就是工號
  // (子公司:純數字 username 大宗;父公司:KM 系列 / 子公司前綴格式)
  if (input.sAMAccountName && isEmpFormat(input.sAMAccountName)) {
    return { empId: normalize(input.sAMAccountName), source: 'sAMAccountName', parsedName: null };
  }

  // Tier 4: email local part(@ 之前)
  // 子公司 foxlinkxz / 越南廠 / 菲律賓廠常見:`675815@foxlinkxz.com`
  if (input.mail && typeof input.mail === 'string') {
    const local = input.mail.split('@')[0];
    if (isEmpFormat(local)) {
      return { empId: normalize(local), source: 'email_local_part', parsedName: null };
    }
  }

  return { empId: null, source: null, parsedName: null };
}

/**
 * 為了 audit log:顯示「來自 X tier」對應的中文標籤,給 admin UI badge 用
 */
const SOURCE_LABELS = {
  ldap_attr:           'LDAP 屬性',
  displayName_prefix:  'displayName 首碼',
  displayName_suffix:  'displayName 尾碼',
  displayName_only:    'displayName 整串',
  sAMAccountName:      'AD 帳號',
  email_local_part:    'Email 前綴',
  sso_emp_cd:          'SSO emp_cd',
  ai_matched:          'AI 比對',
  manual:              '人工手動',
};

function labelForSource(source) {
  return SOURCE_LABELS[source] || source || '未知';
}

module.exports = {
  extractEmpId,
  isEmpFormat,
  labelForSource,
  EMP_RE,
  SOURCE_LABELS,
};
