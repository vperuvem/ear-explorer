/**
 * 01-search â€” Full-text process search endpoint.
 *
 * GET /api/search?process=&application=&scope=&server=
 *   scope: comma-separated action type IDs (1=Process, 3=Calc, 4=Compare,
 *          5=Database, 6=Dialog, 7=Execute, 9=List, ...)
 */

const { describe, it }  = require('node:test');
const assert            = require('node:assert/strict');
const { get }           = require('../helpers/api');

describe('Search Endpoint', () => {
  it('returns a non-empty array for a known search term', async () => {
    const data = await get('/api/search', { process: 'Log-on', scope: '1' });
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0, 'expected results for "Log-on"');
  });

  it('results have id, name, match_type fields', async () => {
    const data = await get('/api/search', { process: 'Log-on', scope: '1' });
    for (const r of data) {
      for (const f of ['id', 'name', 'match_type']) assert.ok(f in r, `missing ${f}`);
      assert.equal(typeof r.id, 'string');
    }
  });

  it('unknown search term returns empty array (no crash)', async () => {
    const data = await get('/api/search', { process: 'ZZZNOMATCH_XYZ123', scope: '1' });
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });

  it('scope=5 (Database) returns an array', async () => {
    const data = await get('/api/search', { process: 'log', scope: '5' });
    assert.ok(Array.isArray(data));
  });

  it('scope=6 (Dialog) returns an array', async () => {
    const data = await get('/api/search', { process: 'log', scope: '6' });
    assert.ok(Array.isArray(data));
  });

  it('multi-scope returns at least as many results as single-scope', async () => {
    const single = await get('/api/search', { process: 'log', scope: '1' });
    const multi  = await get('/api/search', { process: 'log', scope: '1,5,6' });
    assert.ok(multi.length >= single.length, `multi(${multi.length}) < single(${single.length})`);
  });

  it('empty process string returns an array', async () => {
    const data = await get('/api/search', { process: '', scope: '1' });
    assert.ok(Array.isArray(data));
  });

  it('application=WA and application=MA both return arrays', async () => {
    const wa = await get('/api/search', { process: 'log', scope: '1', application: 'WA' });
    const ma = await get('/api/search', { process: 'log', scope: '1', application: 'MA' });
    assert.ok(Array.isArray(wa));
    assert.ok(Array.isArray(ma));
  });
});
