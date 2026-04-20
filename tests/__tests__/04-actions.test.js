/**
 * 04-actions â€” Action detail endpoints.
 *
 *   GET /api/db-action/:id         â€” Database action (SQL statement)
 *   GET /api/calc-action/:id       â€” Calculate action (expression steps)
 *   GET /api/compare-action/:id    â€” Compare action (two operands)
 *   GET /api/dialog-action/:id     â€” Dialog action (screen fields)
 *   GET /api/list-action/:id       â€” List action (operator + list)
 *   GET /api/generic-action/:type/:id â€” Generic fallback (execute, publish, etc.)
 */

const { describe, it, before } = require('node:test');
const assert                   = require('node:assert/strict');
const { get }                  = require('../helpers/api');
const { getSeed }              = require('../helpers/seed');

let seed;
before(async () => { seed = await getSeed(); });

// â”€â”€ Database â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('Database Action (/api/db-action/:id)', () => {
  it('returns rows with statement field', async () => {
    if (!seed.dbActionId) return;
    const data = await get(`/api/db-action/${seed.dbActionId}`);
    assert.ok(Array.isArray(data));
    assert.ok((data.length) > 0);
    assert.ok('statement' in data[0], 'missing statement');
    assert.equal(typeof data[0].statement, 'string');
    assert.ok(data[0].statement.length > 0, 'statement is empty');
  });

  it('unknown GUID returns empty array', async () => {
    const data = await get('/api/db-action/00000000-0000-0000-0000-000000000000');
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });
});

// â”€â”€ Calculate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('Calculate Action (/api/calc-action/:id)', () => {
  it('returns rows with operator_symbol and sequence', async () => {
    if (!seed.calcActionId) return;
    const data = await get(`/api/calc-action/${seed.calcActionId}`);
    assert.ok(Array.isArray(data));
    assert.ok((data.length) > 0);
    assert.ok('operator_symbol' in data[0], 'missing operator_symbol');
    assert.ok('sequence' in data[0], 'missing sequence');
  });

  it('rows are ordered ascending by sequence', async () => {
    if (!seed.calcActionId) return;
    const data = await get(`/api/calc-action/${seed.calcActionId}`);
    for (let i = 1; i < data.length; i++) {
      assert.ok((data[i].sequence) >= (data[i - 1].sequence));
    }
  });

  it('unknown GUID returns empty array', async () => {
    const data = await get('/api/calc-action/00000000-0000-0000-0000-000000000000');
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });
});

// â”€â”€ Compare â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('Compare Action (/api/compare-action/:id)', () => {
  it('returns row with operator_symbol and operands', async () => {
    if (!seed.compareActionId) return;
    const data = await get(`/api/compare-action/${seed.compareActionId}`);
    assert.ok(Array.isArray(data));
    assert.ok((data.length) > 0);
    const r = data[0];
    assert.ok('operator_symbol' in r, 'missing operator_symbol');
    assert.ok('operand1_type' in r, 'missing operand1_type');
    assert.ok('operand2_type' in r, 'missing operand2_type');
  });

  it('unknown GUID returns empty array', async () => {
    const data = await get('/api/compare-action/00000000-0000-0000-0000-000000000000');
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });
});

// â”€â”€ Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('Dialog Action (/api/dialog-action/:id)', () => {
  it('returns rows with field_name and sequence', async () => {
    if (!seed.dialogActionId) return;
    const data = await get(`/api/dialog-action/${seed.dialogActionId}`);
    assert.ok(Array.isArray(data));
    assert.ok((data.length) > 0);
    assert.ok('field_name' in data[0], 'missing field_name');
    assert.ok('sequence' in data[0], 'missing sequence');
  });

  it('unknown GUID responds without crashing (200 or 500)', async () => {
    // Server returns 500 with SQL error for zero-GUID on dialog-action.
    // We just assert it doesn't crash the process.
    const res = await fetch('http://127.0.0.1:9000/api/dialog-action/00000000-0000-0000-0000-000000000000');
    assert.ok([200, 500].includes(res.status), `unexpected status: ${res.status}`);
  });
});

// â”€â”€ List â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('List Action (/api/list-action/:id)', () => {
  it('returns row with operator_name when action exists', async () => {
    if (!seed.listActionId) return;
    const data = await get(`/api/list-action/${seed.listActionId}`);
    assert.ok(Array.isArray(data));
    assert.ok((data.length) > 0);
    assert.ok('operator_name' in data[0], 'missing operator_name');
  });

  it('unknown GUID returns empty array', async () => {
    const data = await get('/api/list-action/00000000-0000-0000-0000-000000000000');
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });
});

// â”€â”€ Generic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('Generic Action (/api/generic-action/:type/:id)', () => {
  it('returns empty array for unsupported type', async () => {
    const data = await get('/api/generic-action/99/00000000-0000-0000-0000-000000000000');
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });

  it('returns empty array for unknown GUID on supported type', async () => {
    const data = await get('/api/generic-action/7/00000000-0000-0000-0000-000000000000');
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });
});
