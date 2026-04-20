/**
 * Jest globalSetup — runs once before all test suites.
 * Verifies the EAR Explorer server is reachable.
 * Fails fast with a helpful message if not, so tests don't hang.
 */

const BASE_URL = process.env.EAR_URL || 'http://127.0.0.1:9000';

module.exports = async function globalSetup() {
  try {
    const res = await fetch(`${BASE_URL}/api/servers`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const servers = await res.json();
    console.log(`\n✅ EAR Explorer server up at ${BASE_URL} — ${servers.length} server(s) configured\n`);
  } catch (e) {
    throw new Error(
      `\n❌ EAR Explorer server is NOT running at ${BASE_URL}\n` +
      `   Start it first:  cd ear-explorer && node server.js\n` +
      `   Then re-run:     cd tests && npm test\n\n` +
      `   Original error: ${e.message}\n`
    );
  }
};
