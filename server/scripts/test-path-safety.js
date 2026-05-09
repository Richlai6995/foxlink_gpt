'use strict';

/**
 * pathSafety unit test。
 * Run: node scripts/test-path-safety.js
 */

const { isNumericId, isSafeId, safeExtension, ensureWithinRoot } = require('../utils/pathSafety');
const path = require('path');

const tests = [];
function t(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  tests.push({ name, ok, actual, expected });
}

// isNumericId
t('isNumericId("123")',         isNumericId('123'),         true);
t('isNumericId("0")',           isNumericId('0'),           true);
t('isNumericId("")',            isNumericId(''),            false);
t('isNumericId("../etc")',      isNumericId('../etc'),      false);
t('isNumericId("12a")',         isNumericId('12a'),         false);
t('isNumericId("99999999999999999")', isNumericId('99999999999999999'), false); // > 16 chars
t('isNumericId(123)',           isNumericId(123),           false); // 非 string

// isSafeId
t('isSafeId("abc-123")',        isSafeId('abc-123'),        true);
t('isSafeId("uuid_v4")',        isSafeId('uuid_v4'),        true);
t('isSafeId("../foo")',         isSafeId('../foo'),         false);
t('isSafeId("a/b")',            isSafeId('a/b'),            false);
t('isSafeId("")',               isSafeId(''),               false);

// safeExtension
const imgExts = ['.png', '.jpg', '.jpeg', '.webp'];
t('safeExtension photo.png',    safeExtension('photo.png', imgExts), '.png');
t('safeExtension photo.PNG',    safeExtension('photo.PNG', imgExts), '.png');
t('safeExtension evil.svg',     safeExtension('evil.svg', imgExts), null);
t('safeExtension shell.php',    safeExtension('shell.php', imgExts), null);
t('safeExtension noext',        safeExtension('noext', imgExts), null);
t('safeExtension foo.tar.gz',   safeExtension('foo.tar.gz', imgExts), null);

// ensureWithinRoot
const root = path.resolve('/app/uploads');
t('ensureWithinRoot inside',    ensureWithinRoot(root, '/app/uploads/kb/123/x.pdf'), true);
t('ensureWithinRoot exact',     ensureWithinRoot(root, '/app/uploads'), true);
t('ensureWithinRoot escape',    ensureWithinRoot(root, '/app/etc/passwd'), false);
t('ensureWithinRoot prefix attack', ensureWithinRoot(root, '/app/uploads_evil/x'), false);
t('ensureWithinRoot traversal', ensureWithinRoot(root, '/app/uploads/../etc'), false);

let pass = 0, fail = 0;
for (const r of tests) {
  console.log(r.ok ? '✅' : '❌', r.name);
  if (!r.ok) console.log('   actual:', r.actual, 'expected:', r.expected);
  r.ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail ? 1 : 0);
