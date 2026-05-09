'use strict';

/**
 * LDAP filter escape unit test。
 * Run: node scripts/test-ldap-escape.js
 */

// 重複 auth.js 內 escapeLdapFilter 的邏輯 (該函式為 module-private)
function escapeLdapFilter(s) {
  return String(s).replace(/[\\*()]/g, (c) => {
    switch (c) {
      case '\\': return '\\5c';
      case '*':  return '\\2a';
      case '(':  return '\\28';
      case ')':  return '\\29';
      default:   return c;
    }
  });
}

const cases = [
  ['ADMIN', 'ADMIN'],
  ['rich_lai', 'rich_lai'],
  ['user.with.dots', 'user.with.dots'],
  ['*', '\\2a'],
  ['*)(uid=*', '\\2a\\29\\28uid=\\2a'],
  ['admin)(|(cn=*', 'admin\\29\\28|\\28cn=\\2a'],
  ['back\\slash', 'back\\5cslash'],
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const out = escapeLdapFilter(input);
  const ok = out === expected;
  console.log(ok ? '✅' : '❌', JSON.stringify(input), '→', JSON.stringify(out),
              ok ? '' : `(expected ${JSON.stringify(expected)})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail ? 1 : 0);
