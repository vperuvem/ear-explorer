/**
 * 02-process â€” Process detail, callers, and caller-objects endpoints.
 *
 *   GET /api/process/:id            â€” all steps for a process
 *   GET /api/callers                â€” caller steps for a child process name
 *   GET /api/caller-objects         â€” distinct caller process objects
 */

const { describe, it, before } = require('node:test');
const assert                   = require('node:assert/strict');
const { get }                  = require('../helpers/api');
const { getSeed }              = require('../helpers/seed');

let seed;
before(async () => { seed = await getSeed(); });

describe('Process Detail (/api/process/:id)', () => {
  it('returns an array of steps', async () => {
    const steps = await get(`/api/process/${seed.processId}`);
    assert.ok(Array.isArray(steps));
    assert.ok((steps.length) > 0);
  });

  it('steps have all required fields', async () => {
    const steps = await get(`/api/process/${seed.processId}`);
    const s = steps[0];
    for (const f of ['process_name','sequence','action_type_name','action_type','action_id','process_id','pass_label','fail_label']) {
      assert.ok(f in s, `missing field: ${f}`);
    }
  });

  it('steps are ordered ascending by sequence', async () => {
    const steps = await get(`/api/process/${seed.processId}`);
    for (let i = 1; i < steps.length; i++) {
      assert.ok((steps[i].sequence) >= (steps[i - 1].sequence));
    }
  });

  it('all steps belong to the requested process', async () => {
    const steps = await get(`/api/process/${seed.processId}`);
    for (const s of steps) {
      assert.equal(s.process_id.toUpperCase(), seed.processId.toUpperCase());
    }
  });

  it('unknown GUID returns empty array', async () => {
    const data = await get('/api/process/00000000-0000-0000-0000-000000000000');
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });
});

describe('Callers (/api/callers)', () => {
  it('returns steps when queried by child process name', async () => {
    // Use the seed process name itself â€” it must be called by something or
    // return an empty array; either way it must not crash.
    const data = await get('/api/callers', { childProcess: seed.processName });
    assert.ok(Array.isArray(data));
  });

  it('unknown child process returns empty array', async () => {
    const data = await get('/api/callers', { childProcess: 'ZZZNOMATCH_XYZ123' });
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });

  it('caller steps have required fields when results exist', async () => {
    // Find a child process that actually has callers (search broadly)
    const results = await get('/api/search', { process: 'menu', scope: '1' });
    if (!results.length) return; // skip if no results on this server
    const name = results[0].name;
    const data  = await get('/api/callers', { childProcess: name });
    if (!data.length) return; // no callers â€” still valid
    for (const f of ['process_name','sequence','action_type_name']) {
      assert.ok(f in data[0], `missing field: ${f}`);
    }
  });
});

describe('Caller Objects (/api/caller-objects)', () => {
  it('returns array for a known child process', async () => {
    const data = await get('/api/caller-objects', { childProcess: seed.processName });
    assert.ok(Array.isArray(data));
  });

  it('items have id and name when results exist', async () => {
    const data = await get('/api/caller-objects', { childProcess: seed.processName });
    if (!data.length) return;
    assert.ok('id'   in data[0], 'missing id');
    assert.ok('name' in data[0], 'missing name');
  });

  it('unknown child returns empty array', async () => {
    const data = await get('/api/caller-objects', { childProcess: 'ZZZNOMATCH_XYZ123' });
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });
});
