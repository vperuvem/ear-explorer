/**
 * Lightweight HTTP helper for EAR Explorer integration tests.
 * Uses Node 18+ built-in fetch (no extra dependencies).
 */

// Use 127.0.0.1 (not 'localhost') to avoid IPv6 resolution issues on Windows.
const BASE_URL    = process.env.EAR_URL      || 'http://127.0.0.1:9000';
const DEF_SERVER  = process.env.EAR_SERVER   || 'ArcadiaWHJSqlStage';
const DEF_APP     = process.env.EAR_APP      || 'WA';

/**
 * GET /api/<path> with optional query params.
 * Throws if the HTTP status is not 2xx.
 */
async function get(apiPath, params = {}) {
  const url = new URL(BASE_URL + apiPath);
  // Always inject server + application defaults unless caller overrides them
  const merged = { server: DEF_SERVER, application: DEF_APP, ...params };
  Object.entries(merged).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — GET ${apiPath}\n${body}`);
  }
  return res.json();
}

/**
 * POST /api/<path> with optional JSON body.
 */
async function post(apiPath, body = {}) {
  const url = new URL(BASE_URL + apiPath);
  const res = await fetch(url.toString(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — POST ${apiPath}\n${txt}`);
  }
  return res.json();
}

/**
 * Checks that the server is reachable. Returns true or throws.
 */
async function assertServerUp() {
  try {
    await get('/api/servers');
    return true;
  } catch (e) {
    throw new Error(
      `EAR Explorer server is not running at ${BASE_URL}.\n` +
      `Start it with:  node server.js   (in ear-explorer/)\n` +
      `Original error: ${e.message}`
    );
  }
}

module.exports = { BASE_URL, DEF_SERVER, DEF_APP, get, post, assertServerUp };
