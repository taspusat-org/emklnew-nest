/* eslint-disable */
/**
 * One-off codemod: make every real-table insert generate its `id` via uuidV7.
 *
 *   trx(this.tableName).insert(insertData)
 *     -> trx(this.tableName).insert(await withUuidV7(trx, insertData))
 *   trx('penerimaandetail').insert(insertedDataQuery)   // array
 *     -> trx('penerimaandetail').insert(await withUuidV7(trx, insertedDataQuery))
 *
 * Only transforms inserts whose target table is `this.tableName` or a quoted
 * real (non-temp) table name AND whose argument is a plain identifier.
 * Temp-table inserts (trx(tempXxx)...) use a bare identifier table name and are
 * skipped automatically; inline-object inserts are left for manual handling.
 *
 * Usage: node scripts/uuidv7-codemod.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src', 'modules');

// Self-manage id via buildInsertData (fixed separately).
const SKIP_FILES = new Set([
  'alatbayar.service.ts',
  'alatbayarlocking.service.ts',
]);

const insertRe =
  /([\w.$]+)\(\s*(this\.tableName|'[^']+'|`[^`]+`)\s*\)(\s*\.insert\(\s*)([A-Za-z_$][\w$]*)(\s*\))/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.service.ts')) out.push(full);
  }
  return out;
}

function addImport(content) {
  if (/\bwithUuidV7\b/.test(content.split('\n').filter((l) => l.includes('import')).join('\n'))) {
    // withUuidV7 already imported somewhere near the top
    if (/import[\s\S]*?withUuidV7[\s\S]*?from\s*['"]src\/utils\/utils\.service['"]/.test(content)) {
      return content;
    }
  }
  const utilsImportRe =
    /import\s*\{([^}]*)\}\s*from\s*(['"])src\/utils\/utils\.service\2;?/;
  const m = content.match(utilsImportRe);
  if (m) {
    if (/\bwithUuidV7\b/.test(m[1])) return content;
    const sep = m[1].includes('\n') ? '\n  withUuidV7,' : ' withUuidV7,';
    const replaced = `import {${sep}${m[1]} } from 'src/utils/utils.service';`;
    return content.replace(utilsImportRe, replaced);
  }
  // No utils.service import yet — add one after the first import line.
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('import '));
  const insertAt = idx === -1 ? 0 : idx + 1;
  lines.splice(
    insertAt,
    0,
    `import { withUuidV7 } from 'src/utils/utils.service';`,
  );
  return lines.join('\n');
}

let totalFiles = 0;
let totalInserts = 0;
const changedFiles = [];

for (const file of walk(ROOT)) {
  if (SKIP_FILES.has(path.basename(file))) continue;
  const original = fs.readFileSync(file, 'utf8');
  let count = 0;

  const transformed = original.replace(
    insertRe,
    (match, recv, table, between, arg, close) => {
      // Skip temp tables referenced by quoted name (## / temp).
      if (/^['"`]/.test(table) && /(temp|##)/i.test(table)) return match;
      // Skip if already wrapped (defensive).
      if (arg === 'withUuidV7') return match;
      count += 1;
      return `${recv}(${table})${between}await withUuidV7(${recv}, ${arg})${close}`;
    },
  );

  if (count > 0) {
    const withImport = addImport(transformed);
    fs.writeFileSync(file, withImport, 'utf8');
    totalFiles += 1;
    totalInserts += count;
    changedFiles.push(`${path.relative(ROOT, file)} (${count})`);
  }
}

console.log(`Changed ${totalFiles} files, ${totalInserts} inserts:`);
for (const f of changedFiles) console.log('  ' + f);
