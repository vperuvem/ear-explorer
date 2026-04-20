/**
 * 00-health â€” Server availability and static metadata endpoints.
 *
 * These tests must pass before any other suite runs. They cover:
 *   GET /api/servers      â€” configured SQL Server list
 *   GET /api/devices      â€” WMS device / entry-point list
 *   GET /api/tests/status â€” tester status (always responds)
 */

const { describe, it }  = require('node:test');
const assert            = require('node:assert/strict');
const { get, DEF_SERVER } = require('../helpers/api');

describe('API Health', () => {
  it('GET /api/servers responds with a non-empty array', async () => {
    const data = await get('/api/servers');
    assert.ok(Array.isArray(data), 'expected array');
    assert.ok(data.length > 0, 'expected at least one server');
  });

  it('/api/servers items have key and label fields', async () => {
    const data = await get('/api/servers');
    for (const s of data) {
      assert.ok('key'   in s, 'missing key');
      assert.ok('label' in s, 'missing label');
      assert.equal(typeof s.key,   'string');
      assert.equal(typeof s.label, 'string');
    }
  });

  it('/api/servers includes the default server', async () => {
    const data = await get('/api/servers');
    const keys = data.map(s => s.key);
    assert.ok(keys.includes(DEF_SERVER), `default server "${DEF_SERVER}" not in list: ${keys.join(', ')}`);
  });

  it('GET /api/devices responds with a non-empty array', async () => {
    const data = await get('/api/devices');
    assert.ok(Array.isArray(data), 'expected array');
    assert.ok(data.length > 0, 'expected at least one device');
  });

  it('/api/devices items have id, process_name, app_name, dev_type', async () => {
    const data = await get('/api/devices');
    const d = data[0];
    for (const field of ['id', 'process_name', 'app_name', 'dev_type']) {
      assert.ok(field in d, `missing field: ${field}`);
    }
  });

  it('GET /api/tests/status responds with { running: boolean }', async () => {
    const data = await get('/api/tests/status');
    assert.ok('running' in data, 'missing running field');
    assert.equal(typeof data.running, 'boolean');
  });
});
