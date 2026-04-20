/**
 * seed.js — discovers real database IDs at runtime by querying the live API.
 *
 * Tests must NOT hardcode GUIDs (they change between environments).
 * Instead they call getSeed() which searches for a known process and caches
 * the IDs of each action type found in its steps.
 */

const { get, DEF_SERVER, DEF_APP } = require('./api');

let _cache = null;

async function getSeed() {
  if (_cache) return _cache;

  // 1 — search for "Log-on" (process type scope=1) to find a well-known process
  const searchResults = await get('/api/search', {
    process:     'Log-on',
    application: DEF_APP,
    scope:       '1',
  });
  if (!searchResults.length) throw new Error('Seed: no process found for search "Log-on"');

  const proc = searchResults[0];

  // 2 — fetch all steps for that process
  const steps = await get(`/api/process/${proc.id}`, { application: DEF_APP });
  if (!steps.length) throw new Error(`Seed: process "${proc.name}" has no steps`);

  // 3 — pick the first step of each action type we need to test
  const byType = (name) => steps.find(s => s.action_type_name === name);

  const dbStep      = byType('Database');
  const calcStep    = byType('Calculate');
  const compareStep = byType('Compare');
  const dialogStep  = byType('Dialog');
  const listStep    = byType('List');
  const executeStep = byType('Execute');

  // 4 — find a caller process name (for /api/callers and /api/caller-objects)
  //     We look for a step of type Process inside this process's steps.
  const childCallStep = steps.find(s => s.action_type_name === 'Process' && s.action_name);

  _cache = {
    processId:      proc.id,
    processName:    proc.name,
    steps,

    dbActionId:      dbStep?.action_id      ?? null,
    calcActionId:    calcStep?.action_id    ?? null,
    compareActionId: compareStep?.action_id ?? null,
    dialogActionId:  dialogStep?.action_id  ?? null,
    listActionId:    listStep?.action_id    ?? null,
    executeActionId: executeStep?.action_id ?? null,

    // Name of a child process that this process calls — used to test /api/callers
    childProcessName: childCallStep?.action_name ?? null,
  };

  return _cache;
}

/** Clears the cache (useful in tests that modify state). */
function clearSeedCache() { _cache = null; }

module.exports = { getSeed, clearSeedCache };
