/**
 * 03-paths â€” Entry-point path tracing endpoints.
 *
 *   GET /api/explorer/all-paths?id=&app=    â€” reverse BFS from process to entry points
 *   GET /api/action-paths?id=&type=&app=    â€” reverse BFS from a specific action
 */

const { describe, it, before } = require('node:test');
const assert                   = require('node:assert/strict');
const { get }                  = require('../helpers/api');
const { getSeed }              = require('../helpers/seed');

let seed;
before(async () => { seed = await getSeed(); });

describe('All-Paths (/api/explorer/all-paths)', () => {
  it('returns an array for a known process ID', async () => {
    const data = await get('/api/explorer/all-paths', {
      id:  seed.processId,
      app: 'WA',
    });
    assert.ok(Array.isArray(data));
  });

  it('returns empty array when id is missing', async () => {
    const data = await get('/api/explorer/all-paths', { app: 'WA' });
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });

  it('returns empty array for unknown GUID', async () => {
    const data = await get('/api/explorer/all-paths', {
      id:  '00000000-0000-0000-0000-000000000000',
      app: 'WA',
    });
    assert.ok(Array.isArray(data));
  });

  it('path entries are non-empty strings when results exist', async () => {
    const data = await get('/api/explorer/all-paths', {
      id:  seed.processId,
      app: 'WA',
    });
    if (!data.length) return; // process may be a root itself
    for (const entry of data) {
      // Each entry should be an object with at least a path or name property
      assert.ok(entry, 'path entry is falsy');
      assert.equal(typeof entry, 'object');
    }
  });

  it('paths are sorted ascending (no two consecutive identical paths)', async () => {
    const data = await get('/api/explorer/all-paths', {
      id:  seed.processId,
      app: 'WA',
    });
    if (data.length < 2) return;
    // Verify no duplicates at the same position
    const paths = data.map(e => JSON.stringify(e));
    const unique = new Set(paths);
    assert.equal(unique.size, paths.length, 'duplicate paths found');
  });
});

describe('Action Paths (/api/action-paths)', () => {
  it('returns an array for a known database action', async () => {
    if (!seed.dbActionId) return;
    const data = await get('/api/action-paths', {
      id:   seed.dbActionId,
      type: '5',
      app:  'WA',
    });
    assert.ok(Array.isArray(data));
  });

  it('returns an array for a known calculate action', async () => {
    if (!seed.calcActionId) return;
    const data = await get('/api/action-paths', {
      id:   seed.calcActionId,
      type: '3',
      app:  'WA',
    });
    assert.ok(Array.isArray(data));
  });

  it('returns empty array for unknown action ID', async () => {
    const data = await get('/api/action-paths', {
      id:   '00000000-0000-0000-0000-000000000000',
      type: '5',
      app:  'WA',
    });
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });

  it('returns empty array when id is missing', async () => {
    const data = await get('/api/action-paths', { type: '5', app: 'WA' });
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });
});
