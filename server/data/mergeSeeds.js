/**
 * Utility to merge _helpSeed_part1.js and _helpSeed_part2.js into helpSeedData.js
 * Run: node server/data/mergeSeeds.js
 */
const fs = require('fs');
const path = require('path');

const part1 = require('./_helpSeed_part1');
const part2 = require('./_helpSeed_part2');

// Merge and deduplicate (part2 wins if same id exists in both)
const seen = new Map();
for (const s of [...part1, ...part2]) {
  seen.set(s.id, s);
}
const merged = [...seen.values()];

// Re-sort by sort_order
merged.sort((a, b) => a.sort_order - b.sort_order);

const output = `/**
 * Help page seed data — zh-TW (source of truth)
 * Auto-extracted from HelpPage.tsx
 * Generated: ${new Date().toISOString().slice(0, 10)}
 *
 * Block types: para, tip, note, table, steps, code, list, subsection, card_grid, comparison
 */

const userSections = ${JSON.stringify(merged, null, 2)};

module.exports = { userSections };
`;

fs.writeFileSync(path.join(__dirname, 'helpSeedData.js'), output, 'utf8');
console.log(`Merged ${merged.length} sections into helpSeedData.js`);
