/**
 * run-tests.js — Zero-dependency test runner for EAR Explorer.
 *
 * Uses Node 18+ built-in `node:test` and `node:assert`.
 * No npm install needed.
 *
 * Usage:
 *   node run-tests.js
 *   EAR_URL=http://localhost:9000 node run-tests.js
 */

const { run }  = require('node:test');
const path     = require('node:path');
const fs       = require('node:fs');
const { assertServerUp } = require('./helpers/api');

const TESTS_DIR = path.join(__dirname, '__tests__');

async function main() {
  // 1 — fail fast if server is not running
  try {
    await assertServerUp();
    console.log('\n✅ Server is up — starting tests\n');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  // 2 — collect all test files, sorted
  const files = fs.readdirSync(TESTS_DIR)
    .filter(f => f.endsWith('.test.js'))
    .sort()
    .map(f => path.join(TESTS_DIR, f));

  // 3 — run with node:test runner (streams TAP to stdout)
  const stream = run({
    files,
    concurrency: 1,   // run sequentially (DB calls, shared state)
    timeout: 30_000,
  });

  let passed = 0, failed = 0, skipped = 0;

  stream.on('test:pass',  (e) => { passed++;  console.log(`  ✅ ${e.name}`); });
  stream.on('test:fail',  (e) => {
    failed++;
    const err = e.details?.error;
    const msg = err?.message ?? err ?? '(no message)';
    const stack = err?.stack ? '\n     ' + err.stack.split('\n').slice(1,3).join('\n     ') : '';
    console.error(`  ❌ ${e.name}\n     ${msg}${stack}`);
  });
  stream.on('test:skip',  ()  => { skipped++; });

  await new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`${'─'.repeat(50)}\n`);

  if (failed > 0) {
    console.error('❌ Test suite FAILED\n');
    process.exit(1);
  }
  console.log('✅ All tests passed\n');
}

main().catch(e => { console.error(e); process.exit(1); });
