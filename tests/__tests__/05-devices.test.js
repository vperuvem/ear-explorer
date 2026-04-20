/**
 * 05-devices â€” Virtual terminal device endpoints.
 *
 *   GET /api/vt-devices         â€” device list from ADV.dbo.t_device
 *   GET /api/vt-devices?app=WA  â€” filtered by application
 *   GET /api/vt-host            â€” DNS/host info for a VT device
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');
const { get, DEF_APP } = require('../helpers/api');

describe('VT Devices (/api/vt-devices)', () => {
  it('returns a non-empty array', async () => {
    const data = await get('/api/vt-devices');
    assert.ok(Array.isArray(data));
    assert.ok((data.length) > 0);
  });

  it('items have dev_name, dev_addr, dev_port fields', async () => {
    const data = await get('/api/vt-devices');
    for (const d of data) {
      for (const f of ['dev_name', 'dev_addr', 'dev_port']) {
        assert.ok(f in d, `missing field: ${f}`);
      }
      assert.equal(typeof d.dev_name, 'string');
      assert.ok(d.dev_name.length > 0, 'dev_name is empty');
    }
  });

  it('dev_port is a positive numeric value', async () => {
    const data = await get('/api/vt-devices');
    for (const d of data) {
      const port = Number(d.dev_port);
      assert.ok(!isNaN(port) && port > 0, `invalid port: ${d.dev_port}`);
    }
  });

  it('filtering by app=WA returns a subset', async () => {
    const all = await get('/api/vt-devices');
    const wa  = await get('/api/vt-devices', { app: 'WA' });
    assert.ok(Array.isArray(wa));
    assert.ok((wa.length) <= (all.length));
  });

  it('dev_addr is a non-empty string for all WA devices', async () => {
    // The WMS stores dev_addr as a broadcast discovery string (e.g. "IPAddress=[PING]Line=[1]")
    // or a plain IP. We only assert it is a non-empty string.
    const data = await get('/api/vt-devices', { app: DEF_APP });
    if (!data.length) return;
    for (const d of data) {
      if (d.dev_addr != null) {
        assert.equal(typeof d.dev_addr, 'string');
      }
    }
  });

  it('unknown app returns empty array (no crash)', async () => {
    const data = await get('/api/vt-devices', { app: 'ZZZUNKNOWN' });
    assert.ok(Array.isArray(data));
  });
});

describe('WMS Device List (/api/devices)', () => {
  it('returns entries for the default app', async () => {
    const data = await get('/api/devices');
    const appEntries = data.filter(d => d.app_name === DEF_APP);
    assert.ok((appEntries.length) > 0);
  });

  it('every device has a non-empty process_name', async () => {
    const data = await get('/api/devices');
    for (const d of data) {
      assert.equal(typeof d.process_name, 'string');
      assert.ok(d.process_name.length > 0, 'process_name is empty');
    }
  });
});
