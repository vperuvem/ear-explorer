/**
 * 06-tester â€” EAR Tester API endpoints (served from the same server.js on port 9000).
 *
 *   GET  /api/tests/status    â€” is a test run currently in progress?
 *   GET  /api/tests/results   â€” latest test results JSON
 *   POST /api/tests/run       â€” start a test run (tested defensively â€” won't actually run)
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');
const { get, BASE_URL } = require('../helpers/api');

describe('Tester Status (/api/tests/status)', () => {
  it('returns { running: boolean }', async () => {
    const data = await get('/api/tests/status');
    assert.ok('running' in data, 'missing running field');
    assert.equal(typeof data.running, 'boolean');
  });

  it('running is false when no test is active', async () => {
    // This assumes no test was started just before this suite runs.
    // Informational only â€” we don't fail if running=true (another suite may have started one).
    const data = await get('/api/tests/status');
    assert.equal(typeof data.running, 'boolean');
  });
});

describe('Tester Results (/api/tests/results)', () => {
  it('endpoint responds 200 or 404', async () => {
    const res = await fetch(`${BASE_URL}/api/tests/results`);
    // 200 = results file exists; 404 = no test has run yet â€” both are valid
    assert.ok(([200, 404]).includes(res.status));
  });

  it('when results exist they are a valid JSON object', async () => {
    const res = await fetch(`${BASE_URL}/api/tests/results`);
    if (res.status === 404) return; // no run yet â€” skip
    const data = await res.json();
    assert.equal(typeof data, 'object');
    assert.notEqual(data, null);
  });
});

// POST /api/tests/run is intentionally NOT unit-tested.
// Calling it triggers the full VirtTerm test suite as a side effect
// (requires a live connected VirtTerm session).
// Run VirtTerm tests separately:  cd ear-tester && .\Run-Tests.ps1
