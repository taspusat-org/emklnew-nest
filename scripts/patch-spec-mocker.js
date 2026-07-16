/* Adds `.useMocker(autoMocker)` to every *.spec.ts that builds a Nest testing
 * module, so auto-generated specs can resolve their dependencies via mocks.
 * Idempotent: skips specs that already use it. */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, out);
    } else if (e.name.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

const specs = walk(SRC);
let patched = 0;
let skipped = 0;
for (const f of specs) {
  let c = fs.readFileSync(f, 'utf8');
  if (c.includes('.useMocker(') || !c.includes('.createTestingModule(')) {
    skipped++;
    continue;
  }
  if (!c.includes("from 'src/test/automock'")) {
    c = c.replace(
      /(^import .*?;\r?\n)/,
      `$1import { autoMocker } from 'src/test/automock';\n`
    );
  }
  // Insert before the first .compile() (the createTestingModule chain).
  c = c.replace(/\.compile\(\)/, '.useMocker(autoMocker).compile()');
  fs.writeFileSync(f, c, 'utf8');
  patched++;
}
console.log(`patched=${patched} skipped=${skipped} total=${specs.length}`);
