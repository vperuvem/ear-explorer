'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const mssql   = require('mssql/msnodesqlv8');

const PORT        = 9000;
const TESTER_PORT = 9001;
const TESTER_DIR  = path.join(__dirname, '..', 'ear-tester');
const pools       = {};

// ── Server configuration ──────────────────────────────────────────────────────
// Each key is the value sent by the UI dropdown.
// sqlServer : SQL Server hostname / instance name
// earDb     : name of the EAR application-rules database on that server
// advDb     : name of the Advantage WMS runtime database on that server
// label     : display name shown in the dropdown
const SERVER_CONFIG = {
  ArcadiaWHJSqlStage: { sqlServer: 'ArcadiaWHJSqlStage', earDb: 'EAR', advDb: 'ADV', label: 'ArcadiaWHJSqlStage' },
  RetailRHJSqlUAT:    { sqlServer: 'RetailRHJSqlUAT',    earDb: 'EAR', advDb: 'ADV', label: 'RetailRHJSqlUAT'    },
};
const ALLOWED_SERVERS = Object.keys(SERVER_CONFIG);

// ── Connection pool per server ────────────────────────────────────────────────
const ODBC_DRIVERS = [
  'ODBC Driver 18 for SQL Server',
  'ODBC Driver 17 for SQL Server',
  'SQL Server Native Client 11.0',
  'SQL Server Native Client 10.0',
  'SQL Server'
];

async function getPool(serverKey) {
  if (pools[serverKey]) return pools[serverKey];
  const cfg = SERVER_CONFIG[serverKey];
  let lastErr;
  for (const drv of ODBC_DRIVERS) {
    try {
      // Use ConnectionPool (not mssql.connect) so each server gets its own
      // independent pool -- mssql.connect() is a global singleton and reuses
      // the first connection for every subsequent call regardless of server.
      const pool = new mssql.ConnectionPool({
        connectionString: `Driver={${drv}};Server=${cfg.sqlServer};Database=${cfg.earDb};Trusted_Connection=yes;`
      });
      await pool.connect();
      pools[serverKey] = pool;
      console.log(`Connected to ${cfg.sqlServer} (earDb=${cfg.earDb}, advDb=${cfg.advDb}) using driver: ${drv}`);
      return pools[serverKey];
    } catch(e) { lastErr = e; delete pools[serverKey]; }
  }
  throw new Error(`Could not connect to ${cfg.sqlServer}. No working ODBC driver. Last error: ${lastErr.message}`);
}

// ── Run a parameterised query, strip control chars from strings ───────────────
// Replaces ADV.dbo. and EAR.dbo. tokens in the SQL with the per-server
// configured database names so queries work across all environments.
async function runQuery(serverKey, sql, params = {}) {
  const cfg = SERVER_CONFIG[serverKey] || SERVER_CONFIG[ALLOWED_SERVERS[0]];
  const resolved = sql
    .replace(/\bADV\.dbo\./gi, `${cfg.advDb}.dbo.`)
    .replace(/\bEAR\.dbo\./gi, `${cfg.earDb}.dbo.`);
  const pool = await getPool(serverKey);
  const req  = pool.request();
  for (const [k, v] of Object.entries(params))
    req.input(k, mssql.NVarChar, v == null ? '' : String(v));
  const { recordset } = await req.query(resolved);
  return recordset.map(row => {
    const obj = {};
    for (const [k, v] of Object.entries(row))
      obj[k] = typeof v === 'string' ? v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') : v;
    return obj;
  });
}

// ── Resolve :#type#GUID#: placeholders in database statement fields ────────────
const TYPE_LABELS = { 17: 'Field', 19: 'Record' };
async function resolveGuids(server, rows) {
  const pat   = /:#(\d+)#([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})#:/g;
  const guids = new Set();
  for (const row of rows)
    if (row.statement) for (const m of row.statement.matchAll(pat)) guids.add(m[2].toUpperCase());
  if (!guids.size) return rows;

  const inList  = [...guids].map(g => `'${g}'`).join(',');
  const nameMap = {};
  const names   = await runQuery(server,
    `SELECT UPPER(id) AS id, name FROM t_app_field  WHERE UPPER(id) IN (${inList})
     UNION ALL
     SELECT UPPER(id) AS id, name FROM t_app_record WHERE UPPER(id) IN (${inList})`);
  for (const r of names) nameMap[r.id] = r.name;

  return rows.map(row => {
    if (!row.statement) return row;
    row.statement = row.statement.replace(pat, (_, type, guid) => {
      const g = guid.toUpperCase();
      const label = TYPE_LABELS[+type] || `Type${type}`;
      return nameMap[g] ? `[${label}: ${nameMap[g]}]` : `:#${type}#${guid}#:`;
    });
    return row;
  });
}

// ── SQL constants ─────────────────────────────────────────────────────────────
const DETAIL_JOINS = `
FROM t_app_process_object m (NOLOCK)
JOIN t_app_process_object_detail d (NOLOCK) ON m.id = d.id AND d.version = m.version
JOIN t_application_development a (NOLOCK)   ON m.application_id = a.application_id
LEFT JOIN t_app_process_object po   (NOLOCK) ON d.action_type =  1 AND d.action_id = po.id
LEFT JOIN t_act_calculate     calc  (NOLOCK) ON d.action_type =  3 AND d.action_id = calc.id
LEFT JOIN t_act_compare       comp  (NOLOCK) ON d.action_type =  4 AND d.action_id = comp.id
LEFT JOIN t_act_database      db    (NOLOCK) ON d.action_type =  5 AND d.action_id = db.id
LEFT JOIN t_act_dialog        dlg   (NOLOCK) ON d.action_type =  6 AND d.action_id = dlg.id
LEFT JOIN t_act_execute       exe   (NOLOCK) ON d.action_type =  7 AND d.action_id = exe.id
LEFT JOIN t_act_list          lst   (NOLOCK) ON d.action_type =  9 AND d.action_id = lst.id
LEFT JOIN t_act_send          snd   (NOLOCK) ON d.action_type = 13 AND d.action_id = snd.id
LEFT JOIN t_act_user          usr   (NOLOCK) ON d.action_type = 14 AND d.action_id = usr.id
LEFT JOIN t_act_receive       rcv   (NOLOCK) ON d.action_type = 11 AND d.action_id = rcv.id
LEFT JOIN t_act_report        rpt   (NOLOCK) ON d.action_type = 12 AND d.action_id = rpt.id
LEFT JOIN t_app_record        rec   (NOLOCK) ON d.action_type = 19 AND d.action_id = rec.id
LEFT JOIN t_act_publish       pub   (NOLOCK) ON d.action_type = 10 AND d.action_id = pub.id
LEFT JOIN t_app_locale        loc   (NOLOCK) ON d.action_type = 16 AND d.action_id = loc.id
LEFT JOIN t_app_field         fld   (NOLOCK) ON d.action_type = 17 AND d.action_id = fld.id
LEFT JOIN t_app_constant      con   (NOLOCK) ON d.action_type = 18 AND d.action_id = con.id`;

const DETAIL_COLS = `
SELECT DISTINCT m.name AS process_name, d.sequence, d.label,
  CASE d.action_type
    WHEN  1 THEN 'Process'   WHEN  3 THEN 'Calculate' WHEN  4 THEN 'Compare'
    WHEN  5 THEN 'Database'  WHEN  6 THEN 'Dialog'    WHEN  7 THEN 'Execute'
    WHEN  9 THEN 'List'      WHEN 11 THEN 'Receive'   WHEN 12 THEN 'Report'
    WHEN 13 THEN 'Send'      WHEN 14 THEN 'User'      WHEN 19 THEN 'Record'
    WHEN  2 THEN 'Folder'    WHEN  8 THEN 'Label'     WHEN 10 THEN 'Publish'
    WHEN 15 THEN 'DB Def'    WHEN 16 THEN 'Locale'    WHEN 17 THEN 'Field'
    WHEN 18 THEN 'Constant'  WHEN -1 THEN 'Comment'
    ELSE 'Unknown(' + CAST(d.action_type AS VARCHAR) + ')'
  END AS action_type_name, d.action_type,
  COALESCE(po.name,calc.name,comp.name,db.name,dlg.name,exe.name,
           lst.name,snd.name,usr.name,rcv.name,rpt.name,rec.name,
           pub.name,loc.name,fld.name,
           COALESCE(con.data_string,CAST(con.data_number AS NVARCHAR(50)),CAST(con.data_datetime AS NVARCHAR(50))),
           d.comments) AS action_name,
  d.pass_label, d.fail_label, d.commented_out,
  CAST(d.action_id AS NVARCHAR(36)) AS action_id,
  CAST(m.id AS NVARCHAR(36)) AS process_id`;

// ── Search SQL builder ────────────────────────────────────────────────────────
function buildSearchSql(types) {
  const S = `SELECT DISTINCT CAST(m.id AS NVARCHAR(36)) AS id, m.name, m.description, m.version`;
  const J = `FROM t_app_process_object m (NOLOCK) JOIN t_application_development a (NOLOCK) ON m.application_id = a.application_id`;
  const W = `WHERE a.name = @app`;
  const parts = [];
  if (types.includes('1'))  parts.push(`${S}, '1' AS match_type, m.name AS action_name ${J} ${W} AND lower(m.name) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('3'))  parts.push(`${S}, '3' AS match_type, c.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=3 AND d.commented_out=0 JOIN t_act_calculate c (NOLOCK) ON c.id=d.action_id ${W} AND (lower(c.name) LIKE '%'+lower(@proc)+'%' OR d.action_id IN (SELECT DISTINCT cd.id FROM t_act_calculate_detail cd (NOLOCK) LEFT JOIN t_app_field f1 (NOLOCK) ON cd.operand1_type=17 AND cd.operand1_id=f1.id LEFT JOIN t_app_field f2 (NOLOCK) ON cd.operand2_type=17 AND cd.operand2_id=f2.id LEFT JOIN t_app_field rf (NOLOCK) ON cd.result_type=17 AND cd.result_id=rf.id LEFT JOIN t_app_constant c1 (NOLOCK) ON cd.operand1_type=18 AND cd.operand1_id=c1.id LEFT JOIN t_app_constant c2 (NOLOCK) ON cd.operand2_type=18 AND cd.operand2_id=c2.id WHERE lower(ISNULL(f1.name,'')) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(f2.name,'')) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(rf.name,'')) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(c1.data_string,'')) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(c2.data_string,'')) LIKE '%'+lower(@proc)+'%'))`);
  if (types.includes('4'))  parts.push(`${S}, '4' AS match_type, c.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=4 AND d.commented_out=0 JOIN t_act_compare c (NOLOCK) ON c.id=d.action_id ${W} AND (lower(c.name) LIKE '%'+lower(@proc)+'%' OR d.action_id IN (SELECT cmp.id FROM t_act_compare cmp (NOLOCK) LEFT JOIN t_app_field f1 (NOLOCK) ON cmp.operand1_type=17 AND cmp.operand1_id=f1.id LEFT JOIN t_app_field f2 (NOLOCK) ON cmp.operand2_type=17 AND cmp.operand2_id=f2.id LEFT JOIN t_app_constant c1 (NOLOCK) ON cmp.operand1_type=18 AND cmp.operand1_id=c1.id LEFT JOIN t_app_constant c2 (NOLOCK) ON cmp.operand2_type=18 AND cmp.operand2_id=c2.id WHERE lower(ISNULL(f1.name,'')) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(f2.name,'')) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(c1.data_string,'')) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(c2.data_string,'')) LIKE '%'+lower(@proc)+'%'))`);
  if (types.includes('5'))  parts.push(`${S}, '5' AS match_type, c.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=5 AND d.commented_out=0 JOIN t_act_database c (NOLOCK) ON c.id=d.action_id ${W} AND (lower(c.name) LIKE '%'+lower(@proc)+'%' OR EXISTS (SELECT 1 FROM t_act_database_detail dd (NOLOCK) WHERE dd.id=d.action_id AND lower(CAST(dd.statement AS NVARCHAR(MAX))) LIKE '%'+lower(@proc)+'%'))`);
  if (types.includes('6'))  parts.push(`${S}, '6' AS match_type, c.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=6 AND d.commented_out=0 JOIN t_act_dialog c (NOLOCK) ON c.id=d.action_id ${W} AND (lower(c.name) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(d.label,'')) LIKE '%'+lower(@proc)+'%')`);
  if (types.includes('7'))  parts.push(`${S}, '7' AS match_type, d.label AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=7 AND d.commented_out=0 ${W} AND lower(ISNULL(d.label,'')) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('9'))  parts.push(`${S}, '9' AS match_type, c.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=9 AND d.commented_out=0 JOIN t_act_list c (NOLOCK) ON c.id=d.action_id ${W} AND (lower(c.name) LIKE '%'+lower(@proc)+'%' OR lower(ISNULL(d.label,'')) LIKE '%'+lower(@proc)+'%')`);
  if (types.includes('10')) parts.push(`${S}, '10' AS match_type, c.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=10 AND d.commented_out=0 JOIN t_act_publish c (NOLOCK) ON c.id=d.action_id ${W} AND lower(c.name) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('11')) parts.push(`${S}, '11' AS match_type, d.label AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=11 AND d.commented_out=0 ${W} AND lower(ISNULL(d.label,'')) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('12')) parts.push(`${S}, '12' AS match_type, c.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=12 AND d.commented_out=0 JOIN t_act_report c (NOLOCK) ON c.id=d.action_id ${W} AND lower(c.name) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('13')) parts.push(`${S}, '13' AS match_type, d.label AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=13 AND d.commented_out=0 ${W} AND lower(ISNULL(d.label,'')) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('14')) parts.push(`${S}, '14' AS match_type, d.label AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=14 AND d.commented_out=0 ${W} AND lower(ISNULL(d.label,'')) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('16')) parts.push(`${S}, '16' AS match_type, c.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=16 AND d.commented_out=0 JOIN t_app_locale c (NOLOCK) ON c.id=d.action_id ${W} AND lower(c.name) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('17')) parts.push(`${S}, '17' AS match_type, f.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=17 AND d.commented_out=0 JOIN t_app_field f (NOLOCK) ON f.id=d.action_id ${W} AND lower(f.name) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('18')) parts.push(`${S}, '18' AS match_type, COALESCE(c.data_string,CAST(c.data_number AS NVARCHAR(50)),CAST(c.data_datetime AS NVARCHAR(50))) AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=18 AND d.commented_out=0 JOIN t_app_constant c (NOLOCK) ON c.id=d.action_id ${W} AND lower(ISNULL(c.data_string,'')) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('19')) parts.push(`${S}, '19' AS match_type, r.name AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.action_type=19 AND d.commented_out=0 JOIN t_app_record r (NOLOCK) ON r.id=d.action_id ${W} AND lower(r.name) LIKE '%'+lower(@proc)+'%'`);
  if (types.includes('-1')) parts.push(`${S}, '-1' AS match_type, d.label AS action_name ${J} JOIN t_app_process_object_detail d (NOLOCK) ON d.id=m.id AND d.commented_out=1 ${W} AND lower(ISNULL(d.label,'')) LIKE '%'+lower(@proc)+'%'`);
  if (!parts.length) parts.push(`${S}, '1' AS match_type, m.name AS action_name ${J} WHERE 1=0`);
  return parts.join(' UNION ') + ' ORDER BY action_name';
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// Root page: port 9000 → EAR Explorer, port 9001 → EAR Tester
app.get('/', (req, res) => {
  const file = req.socket.localPort === TESTER_PORT ? 'tester.html' : 'index.html';
  res.sendFile(path.join(__dirname, 'public', file));
});

app.use(express.static(path.join(__dirname, 'public')));

// Returns the server list from SERVER_CONFIG so the UI dropdown is always in sync.
app.get('/api/servers', (_req, res) => {
  res.json(ALLOWED_SERVERS.map(key => ({ key, label: SERVER_CONFIG[key].label })));
});

function getServer(req) {
  const s = req.query.server || ALLOWED_SERVERS[0];
  return ALLOWED_SERVERS.includes(s) ? s : ALLOWED_SERVERS[0];
}

function send(res, rows) { res.json(rows); }
function sendErr(res, err) { console.error(err); res.status(500).json({ error: err.message }); }

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/devices', async (req, res) => {
  try {
    const rows = await runQuery(getServer(req), `
      SELECT DISTINCT CAST(p.id AS NVARCHAR(36)) AS id, p.name AS process_name, a.name AS app_name, dt.dev_type
      FROM ADV.dbo.t_device (NOLOCK) d
      JOIN ADV.dbo.t_solution (NOLOCK) s ON s.solution_id = d.solution_id
      JOIN EAR.dbo.t_app_process_object (NOLOCK) p ON s.application_id = p.application_id AND p.id = d.process_object_id
      JOIN EAR.dbo.t_application_development (NOLOCK) a ON a.application_id = p.application_id
      JOIN ADV.dbo.t_device_type (NOLOCK) dt ON d.device_type_id = dt.device_type_id
      ORDER BY a.name, p.name`);
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/search', async (req, res) => {
  try {
    const proc  = req.query.process     || '';
    const app   = req.query.application || 'WA';
    const types = (req.query.scope || '1').split(',');
    const rows  = await runQuery(getServer(req), buildSearchSql(types), { proc, app });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/process/:id', async (req, res) => {
  try {
    const rows = await runQuery(getServer(req),
      `${DETAIL_COLS} ${DETAIL_JOINS} WHERE a.name = @app AND m.id = @id ORDER BY d.sequence`,
      { id: req.params.id, app: req.query.application || 'WA' });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/callers', async (req, res) => {
  try {
    const rows = await runQuery(getServer(req), `${DETAIL_COLS} ${DETAIL_JOINS}
      WHERE a.name = @app AND m.id IN (
        SELECT DISTINCT d2.id FROM t_app_process_object_detail d2 (NOLOCK)
        JOIN t_app_process_object ch (NOLOCK) ON d2.action_id = ch.id AND d2.action_type = 1
          AND ch.name COLLATE SQL_Latin1_General_CP1_CS_AS = @child)
      ORDER BY m.name, d.sequence`,
      { child: req.query.childProcess || '', app: req.query.application || 'WA' });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/caller-objects', async (req, res) => {
  try {
    const rows = await runQuery(getServer(req), `
      SELECT DISTINCT CAST(m.id AS NVARCHAR(36)) AS id, m.name, m.description, m.version
      FROM t_app_process_object m (NOLOCK)
      JOIN t_application_development a (NOLOCK) ON m.application_id = a.application_id
      JOIN t_app_process_object_detail d (NOLOCK) ON d.id = m.id AND d.action_type = 1
      JOIN t_app_process_object ch (NOLOCK) ON d.action_id = ch.id
      WHERE a.name = @app AND ch.name COLLATE SQL_Latin1_General_CP1_CS_AS = @child ORDER BY m.name`,
      { child: req.query.childProcess || '', app: req.query.application || 'WA' });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

// ── Explorer: all paths TO a process via reverse BFS on the cached graph ──────
app.get('/api/explorer/all-paths', async (req, res) => {
  try {
    const server = getServer(req);
    const app    = req.query.app || 'WA';
    const procId = (req.query.id || '').toUpperCase();
    if (!procId) return send(res, []);

    const { adjacency, nameOf } = await getGraph(server, app);

    // Build reverse adjacency: child → [parents]
    const reverseAdj = new Map();
    for (const [parent, children] of adjacency) {
      for (const { childId } of children) {
        if (!reverseAdj.has(childId)) reverseAdj.set(childId, []);
        reverseAdj.get(childId).push(parent);
      }
    }

    // BFS backwards from target — each node stores the full path from itself TO target
    const pathToTarget = new Map([[procId, nameOf.get(procId) || procId]]);
    const queue = [procId];
    while (queue.length) {
      const curr     = queue.shift();
      const currPath = pathToTarget.get(curr);
      for (const parent of (reverseAdj.get(curr) || [])) {
        if (!pathToTarget.has(parent)) {
          pathToTarget.set(parent, (nameOf.get(parent) || parent) + ' → ' + currPath);
          queue.push(parent);
        }
      }
    }

    // Return all ancestors sorted by path depth (shallowest first)
    const results = [];
    for (const [nodeId, path] of pathToTarget) {
      if (nodeId === procId) continue;
      results.push({
        id:     nodeId,
        name:   nameOf.get(nodeId) || nodeId,
        path,
        depth:  path.split(' → ').length - 1,
        isRoot: !reverseAdj.has(nodeId) || reverseAdj.get(nodeId).length === 0
      });
    }
    results.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
    send(res, results);
  } catch(e) { sendErr(res, e); }
});

// ── Explorer: all paths TO an action object (any type) via reverse BFS ─────────
// Finds all processes that reference the action, then BFS-ancestors each process.
app.get('/api/action-paths', async (req, res) => {
  try {
    const server     = getServer(req);
    const app        = req.query.app  || 'WA';
    const actionId   = (req.query.id  || '').toUpperCase();
    const actionType = parseInt(req.query.type || '0', 10);
    if (!actionId || !actionType) return send(res, []);

    // Step 1: which processes contain this action?
    const procRows = await runQuery(server, `
      SELECT DISTINCT UPPER(CAST(m.id AS NVARCHAR(36))) AS proc_id, m.name AS proc_name
      FROM t_app_process_object_detail d (NOLOCK)
      JOIN t_app_process_object m (NOLOCK) ON m.id = d.id
      JOIN t_application_development a (NOLOCK) ON m.application_id = a.application_id
      WHERE a.name = @app
        AND UPPER(CAST(d.action_id AS NVARCHAR(36))) = @actionId
        AND d.action_type = CAST(@actionType AS INT)
        AND d.commented_out = 0`,
      { app, actionId, actionType: String(actionType) });

    if (!procRows.length) return send(res, []);

    // Step 2: build reverse adjacency from cached graph
    const { adjacency, nameOf } = await getGraph(server, app);
    const reverseAdj = new Map();
    for (const [parent, children] of adjacency) {
      for (const { childId } of children) {
        if (!reverseAdj.has(childId)) reverseAdj.set(childId, []);
        reverseAdj.get(childId).push(parent);
      }
    }

    // Step 3: reverse BFS from each containing process, collect all ancestor paths
    const seen    = new Set(); // avoid duplicate caller+path combos across processes
    const results = [];
    for (const proc of procRows) {
      const procId   = proc.proc_id;
      const procName = proc.proc_name;
      // pathTo: nodeId → full path string ending at procName
      const pathTo = new Map([[procId, procName]]);
      const queue  = [procId];
      while (queue.length) {
        const curr     = queue.shift();
        const currPath = pathTo.get(curr);
        for (const parent of (reverseAdj.get(curr) || [])) {
          if (!pathTo.has(parent)) {
            pathTo.set(parent, (nameOf.get(parent) || parent) + ' → ' + currPath);
            queue.push(parent);
          }
        }
      }
      for (const [nodeId, path] of pathTo) {
        if (nodeId === procId) continue;
        // Only emit root nodes — nodes with no parents are true entry points.
        // Every intermediate ancestor is already encoded inside the path string
        // of the root that reaches it, so emitting intermediates causes explosion.
        const isRoot = !reverseAdj.has(nodeId) || reverseAdj.get(nodeId).length === 0;
        if (!isRoot) continue;
        const key = path; // path string is already unique per root→proc pair
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          id:          nodeId,
          name:        nameOf.get(nodeId) || nodeId,
          processName: procName,
          path,
          depth:       path.split(' → ').length - 1
        });
      }
    }
    results.sort((a, b) =>
      a.processName.localeCompare(b.processName) || a.depth - b.depth);
    send(res, results);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/compare-action/:id', async (req, res) => {
  try {
    const rows = await runQuery(getServer(req), `
      SELECT c.name, c.description,
        CASE c.operator_id WHEN 0 THEN '=' WHEN 1 THEN '<>' WHEN 2 THEN '>' WHEN 3 THEN '>=' WHEN 4 THEN '<' WHEN 5 THEN '<=' ELSE 'Op('+CAST(c.operator_id AS VARCHAR)+')' END AS operator_symbol,
        c.operand1_type, CASE c.operand1_type WHEN 17 THEN COALESCE(f1.name,c.operand1_id) WHEN 18 THEN COALESCE(c1.data_string,CAST(c1.data_number AS NVARCHAR(50)),CAST(c1.data_datetime AS NVARCHAR(50))) WHEN 19 THEN COALESCE(r1.name,c.operand1_id) WHEN -1 THEN 'Current Row' ELSE NULL END AS operand1_name,
        c.operand2_type, CASE c.operand2_type WHEN 17 THEN COALESCE(f2.name,c.operand2_id) WHEN 18 THEN COALESCE(c2.data_string,CAST(c2.data_number AS NVARCHAR(50)),CAST(c2.data_datetime AS NVARCHAR(50))) WHEN 19 THEN COALESCE(r2.name,c.operand2_id) WHEN -1 THEN 'Current Row' ELSE NULL END AS operand2_name
      FROM t_act_compare c (NOLOCK)
      LEFT JOIN t_app_field f1 (NOLOCK) ON c.operand1_type=17 AND c.operand1_id=f1.id
      LEFT JOIN t_app_record r1 (NOLOCK) ON c.operand1_type=19 AND c.operand1_id=r1.id
      LEFT JOIN t_app_constant c1 (NOLOCK) ON c.operand1_type=18 AND c.operand1_id=c1.id
      LEFT JOIN t_app_field f2 (NOLOCK) ON c.operand2_type=17 AND c.operand2_id=f2.id
      LEFT JOIN t_app_record r2 (NOLOCK) ON c.operand2_type=19 AND c.operand2_id=r2.id
      LEFT JOIN t_app_constant c2 (NOLOCK) ON c.operand2_type=18 AND c.operand2_id=c2.id
      WHERE c.id = @id`, { id: req.params.id });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/calc-action/:id', async (req, res) => {
  try {
    const rows = await runQuery(getServer(req), `
      SELECT c.name, c.description, cd.sequence,
        CASE cd.operator_id WHEN 0 THEN '+' WHEN 1 THEN '-' WHEN 2 THEN '*' WHEN 3 THEN '/' WHEN 4 THEN '%' WHEN 5 THEN '&' WHEN 6 THEN 'Mid' WHEN 7 THEN 'Search' WHEN 8 THEN 'Len' WHEN 9 THEN ':=' WHEN 13 THEN 'Date+' WHEN 19 THEN 'Date-' ELSE 'Op('+CAST(cd.operator_id AS VARCHAR)+')' END AS operator_symbol,
        cd.result_type,   COALESCE(rf.name,rr.name) AS result_name,
        cd.operand1_type, CASE cd.operand1_type WHEN 18 THEN COALESCE(c1.data_string,CAST(c1.data_number AS NVARCHAR(50)),CAST(c1.data_datetime AS NVARCHAR(50))) WHEN -1 THEN 'Current Row' ELSE COALESCE(f1.name,r1.name) END AS operand1_name,
        cd.operand2_type, CASE cd.operand2_type WHEN 18 THEN COALESCE(c2.data_string,CAST(c2.data_number AS NVARCHAR(50)),CAST(c2.data_datetime AS NVARCHAR(50))) WHEN -1 THEN 'Current Row' ELSE COALESCE(f2.name,r2.name) END AS operand2_name,
        cd.operand3_type, CASE cd.operand3_type WHEN 18 THEN COALESCE(c3.data_string,CAST(c3.data_number AS NVARCHAR(50)),CAST(c3.data_datetime AS NVARCHAR(50))) WHEN -1 THEN 'Current Row' ELSE COALESCE(f3.name,r3.name) END AS operand3_name
      FROM t_act_calculate c (NOLOCK)
      JOIN t_act_calculate_detail cd (NOLOCK) ON c.id=cd.id
      LEFT JOIN t_app_field rf (NOLOCK) ON cd.result_type=17 AND cd.result_id=rf.id
      LEFT JOIN t_app_record rr (NOLOCK) ON cd.result_type=19 AND cd.result_id=rr.id
      LEFT JOIN t_app_field f1 (NOLOCK) ON cd.operand1_type=17 AND cd.operand1_id=f1.id
      LEFT JOIN t_app_record r1 (NOLOCK) ON cd.operand1_type=19 AND cd.operand1_id=r1.id
      LEFT JOIN t_app_constant c1 (NOLOCK) ON cd.operand1_type=18 AND cd.operand1_id=c1.id
      LEFT JOIN t_app_field f2 (NOLOCK) ON cd.operand2_type=17 AND cd.operand2_id=f2.id
      LEFT JOIN t_app_record r2 (NOLOCK) ON cd.operand2_type=19 AND cd.operand2_id=r2.id
      LEFT JOIN t_app_constant c2 (NOLOCK) ON cd.operand2_type=18 AND cd.operand2_id=c2.id
      LEFT JOIN t_app_field f3 (NOLOCK) ON cd.operand3_type=17 AND cd.operand3_id=f3.id
      LEFT JOIN t_app_record r3 (NOLOCK) ON cd.operand3_type=19 AND cd.operand3_id=r3.id
      LEFT JOIN t_app_constant c3 (NOLOCK) ON cd.operand3_type=18 AND cd.operand3_id=c3.id
      WHERE c.id = @id ORDER BY cd.sequence`, { id: req.params.id });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/list-action/:id', async (req, res) => {
  try {
    const rows = await runQuery(getServer(req), `
      SELECT l.name, l.description, l.find_exact,
        CASE l.operator_id WHEN 0 THEN 'Get Max' WHEN 1 THEN 'Get Row Number' WHEN 2 THEN 'Add Row' WHEN 3 THEN 'Add Record' WHEN 4 THEN 'Insert Record' WHEN 6 THEN 'Replace Fields' WHEN 8 THEN 'Delete Record' WHEN 9 THEN 'Find' WHEN 11 THEN 'Get First Row' WHEN 12 THEN 'Get Last Row' WHEN 13 THEN 'Get Next Row' WHEN 14 THEN 'Get Previous Row' WHEN 15 THEN 'Get Row' WHEN 16 THEN 'Clear' ELSE 'Unknown('+CAST(l.operator_id AS VARCHAR)+')' END AS operator_name,
        COALESCE(rl.name,l.list_id) AS list_name,
        l.operand1_type, CASE l.operand1_type WHEN 17 THEN COALESCE(f1.name,l.operand1_id) WHEN 19 THEN COALESCE(r1.name,l.operand1_id) WHEN -1 THEN 'Current Row' ELSE NULL END AS operand1_name,
        l.operand2_type, CASE l.operand2_type WHEN 17 THEN COALESCE(f2.name,l.operand2_id) WHEN 19 THEN COALESCE(r2.name,l.operand2_id) WHEN -1 THEN 'Current Row' ELSE NULL END AS operand2_name
      FROM t_act_list l (NOLOCK)
      LEFT JOIN t_app_record rl (NOLOCK) ON l.list_id=rl.id
      LEFT JOIN t_app_field  f1 (NOLOCK) ON l.operand1_type=17 AND l.operand1_id=f1.id
      LEFT JOIN t_app_record r1 (NOLOCK) ON l.operand1_type=19 AND l.operand1_id=r1.id
      LEFT JOIN t_app_field  f2 (NOLOCK) ON l.operand2_type=17 AND l.operand2_id=f2.id
      LEFT JOIN t_app_record r2 (NOLOCK) ON l.operand2_type=19 AND l.operand2_id=r2.id
      WHERE l.id = @id`, { id: req.params.id });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/dialog-action/:id', async (req, res) => {
  try {
    const rows = await runQuery(getServer(req), `
      SELECT d.name, d.description, dd.sequence,
        COALESCE(ff.name,fr.name,dd.field_id) AS field_name,
        CASE dd.field_type WHEN 17 THEN 'Field' WHEN 19 THEN 'Record' ELSE '' END AS field_type_name,
        COALESCE(pf.name,pc.value,pr.name, CASE WHEN dd.prompt_type IN (-1,0) THEN '' ELSE dd.prompt_id END) AS prompt_name,
        CASE dd.prompt_type WHEN 17 THEN 'Field' WHEN 18 THEN 'Const' WHEN 21 THEN 'Resource' ELSE '' END AS prompt_type_name,
        COALESCE(pv.name, CASE WHEN dd.validation_type IN (-1,0) THEN '' ELSE dd.validation_id END) AS validation_name,
        CASE dd.validation_type WHEN 1 THEN 'Process' ELSE '' END AS validation_type_name,
        dd.required, dd.clear_initially
      FROM t_act_dialog d (NOLOCK)
      JOIN t_act_dialog_detail dd (NOLOCK) ON d.id=dd.id
      LEFT JOIN t_app_field    ff (NOLOCK) ON dd.field_type=17 AND dd.field_id=ff.id
      LEFT JOIN t_app_record   fr (NOLOCK) ON dd.field_type=19 AND dd.field_id=fr.id
      LEFT JOIN t_app_field    pf (NOLOCK) ON dd.prompt_type=17 AND dd.prompt_id=pf.id
      LEFT JOIN t_app_constant pc (NOLOCK) ON dd.prompt_type=18 AND dd.prompt_id=pc.id
      LEFT JOIN t_resource     pr (NOLOCK) ON dd.prompt_type=21 AND dd.prompt_id=pr.id
      LEFT JOIN t_app_process_object pv (NOLOCK) ON dd.validation_type=1 AND dd.validation_id=pv.id
      WHERE d.id = @id ORDER BY dd.sequence`, { id: req.params.id });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

app.get('/api/db-action/:id', async (req, res) => {
  try {
    let rows = await runQuery(getServer(req), `
      SELECT dm.name, dm.description, dd.sequence, dd.provider_type,
             CAST(dd.statement AS NVARCHAR(MAX)) AS statement
      FROM t_act_database dm (NOLOCK)
      JOIN t_act_database_detail dd (NOLOCK) ON dd.id=dm.id
      JOIN t_application_development a (NOLOCK) ON dm.application_id=a.application_id
      WHERE dm.id = @id ORDER BY dd.sequence`, { id: req.params.id });
    rows = await resolveGuids(getServer(req), rows);
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

// ── Generic action detail — covers types not yet handled by specific endpoints ─
const ACTION_TYPE_TABLES = {
  7:  { table: 't_act_execute',  cols: `name, description` },
  10: { table: 't_act_publish',  cols: `name, description` },
  11: { table: 't_act_receive',  cols: `name, description` },
  12: { table: 't_act_report',   cols: `name, description` },
  13: { table: 't_act_send',     cols: `name, description` },
  14: { table: 't_act_user',     cols: `name, description` },
  16: { table: 't_app_locale',   cols: `name, description` },
  17: { table: 't_app_field',    cols: `name, description` },
  18: { table: 't_app_constant', cols: `data_string AS name, CAST(data_number AS NVARCHAR(50)) AS data_number, CAST(data_datetime AS NVARCHAR(50)) AS data_datetime, '' AS description` },
  19: { table: 't_app_record',   cols: `name, description` },
};

app.get('/api/generic-action/:type/:id', async (req, res) => {
  const typeNum = parseInt(req.params.type, 10);
  const info    = ACTION_TYPE_TABLES[typeNum];
  if (!info) return send(res, []);
  try {
    const rows = await runQuery(getServer(req),
      `SELECT TOP 1 ${info.cols} FROM ${info.table} (NOLOCK) WHERE id = @id`,
      { id: req.params.id });
    send(res, rows);
  } catch(e) { sendErr(res, e); }
});

// ── EAR Tester API ────────────────────────────────────────────────────────────
let testRunning = false;

app.get('/api/tests/results', (req, res) => {
  const logPath = path.join(TESTER_DIR, '_json_log.txt');
  try {
    if (fs.existsSync(logPath)) res.json(JSON.parse(fs.readFileSync(logPath, 'utf8')));
    else res.json({ runAt: null, results: [] });
  } catch(e) { res.json({ runAt: null, results: [] }); }
});

app.get('/api/tests/status', (req, res) => {
  res.json({ running: testRunning });
});

app.post('/api/tests/run', (req, res) => {
  if (testRunning) return res.json({ status: 'already_running' });
  testRunning = true;
  const { spawn } = require('child_process');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'Run-Tests.ps1'];
  if (req.query.app)   { args.push('-App');        args.push(req.query.app);   }
  if (req.query.proc)  { args.push('-EntryPoint'); args.push(req.query.proc);  }
  if (req.query.entry) { args.push('-DeviceId');   args.push(req.query.entry); }
  const child = spawn('powershell.exe', args, { cwd: TESTER_DIR, shell: false });
  child.on('close', () => { testRunning = false; });
  res.json({ status: 'started' });
});

// ── Graph cache — Q1-Q4 results keyed by server|app, TTL 15 min ───────────────
// Q1-Q4 are independent of the entry-point; only BFS varies per entry.
// Caching means switching entry points costs <5 ms instead of ~2 s.
const graphCache = new Map();
const GRAPH_TTL  = 15 * 60 * 1000; // 15 minutes

async function getGraph(server, app) {
  const key    = `${server}|${app}`;
  const cached = graphCache.get(key);
  if (cached && (Date.now() - cached.ts) < GRAPH_TTL) {
    console.log(`[graph] cache hit  key=${key}`);
    return cached;
  }

  const t0 = Date.now();
  console.log(`[graph] building   key=${key}`);

  // Q1 — subprocess call edges (action_type=1)
  const edges = await runQuery(server, `
    SELECT DISTINCT
      UPPER(CAST(d.id        AS NVARCHAR(36))) AS parent_id,
      UPPER(CAST(d.action_id AS NVARCHAR(36))) AS child_id,
      child.name AS child_name,
      m.name     AS parent_name
    FROM t_app_process_object_detail d (NOLOCK)
    JOIN t_app_process_object m     (NOLOCK) ON m.id = d.id
    JOIN t_app_process_object child (NOLOCK) ON child.id = d.action_id
    JOIN t_application_development  a (NOLOCK) ON m.application_id = a.application_id
    WHERE d.action_type = 1 AND d.commented_out = 0 AND a.name = @app`, { app });
  console.log(`[graph] Q1 edges=${edges.length} ${Date.now()-t0}ms`);

  // Q2 — dialog steps (action_type=6)
  const dlgEdges = await runQuery(server, `
    SELECT DISTINCT
      UPPER(CAST(d.id   AS NVARCHAR(36))) AS proc_id,
      m.name                              AS proc_name,
      dlg.name                            AS dialog_name,
      UPPER(CAST(dlg.id AS NVARCHAR(36))) AS dialog_id
    FROM t_app_process_object_detail d (NOLOCK)
    JOIN t_act_dialog               dlg (NOLOCK) ON dlg.id = d.action_id
    JOIN t_app_process_object       m   (NOLOCK) ON m.id = d.id
    JOIN t_application_development  a   (NOLOCK) ON m.application_id = a.application_id
    WHERE d.action_type = 6 AND d.commented_out = 0 AND a.name = @app`, { app });
  console.log(`[graph] Q2 dlgs=${dlgEdges.length} ${Date.now()-t0}ms`);

  // Build adjacency + nameOf
  const adjacency = new Map();
  const nameOf    = new Map();
  for (const e of edges) {
    nameOf.set(e.parent_id, e.parent_name);
    nameOf.set(e.child_id,  e.child_name);
    if (!adjacency.has(e.parent_id)) adjacency.set(e.parent_id, []);
    adjacency.get(e.parent_id).push({ childId: e.child_id });
  }
  for (const d of dlgEdges) nameOf.set(d.proc_id, d.proc_name);

  // Q3 — menu-invoker processes (DB calls referencing t_menu)
  const menuInvokers = await runQuery(server, `
    SELECT DISTINCT
      UPPER(CAST(m.id AS NVARCHAR(36))) AS proc_id,
      m.name                            AS proc_name,
      CAST(dd.statement AS NVARCHAR(MAX)) AS stmt
    FROM t_app_process_object_detail d (NOLOCK)
    JOIN t_app_process_object      m  (NOLOCK) ON m.id = d.id
    JOIN t_application_development a  (NOLOCK) ON m.application_id = a.application_id
    JOIN t_act_database            db (NOLOCK) ON db.id = d.action_id AND d.action_type = 5
    JOIN t_act_database_detail     dd (NOLOCK) ON dd.id = db.id
    WHERE a.name = @app AND d.commented_out = 0
      AND CAST(dd.statement AS NVARCHAR(MAX)) LIKE '%t_menu%'`, { app });
  console.log(`[graph] Q3 menu_invokers=${menuInvokers.length} ${Date.now()-t0}ms`);

  // Q4 — _-prefixed menu templates with their visible item texts
  const menuTargetRows = menuInvokers.length ? await runQuery(server, `
    SELECT DISTINCT tm.process AS menu_name, tm.text AS item_text
    FROM ADV.dbo.t_menu tm (NOLOCK)
    WHERE tm.process LIKE '[_]%' AND tm.text IS NOT NULL AND LEN(TRIM(tm.text)) > 0
    ORDER BY tm.process, tm.text`, {}) : [];
  console.log(`[graph] Q4 menu_items=${menuTargetRows.length} ${Date.now()-t0}ms`);

  // textsByMenu: menu_name → Set of item texts
  const textsByMenu = new Map();
  for (const r of menuTargetRows) {
    if (!textsByMenu.has(r.menu_name)) textsByMenu.set(r.menu_name, new Set());
    textsByMenu.get(r.menu_name).add(r.item_text);
  }

  // Inject virtual MENU:_Name nodes into adjacency
  if (menuTargetRows.length) {
    for (const inv of menuInvokers) {
      const allMenus   = [...textsByMenu.keys()];
      const specific   = allMenus.filter(mn => inv.stmt && inv.stmt.includes(mn));
      const menusToAdd = specific.length ? specific : allMenus;
      for (const menuName of menusToAdd) {
        const vid = 'MENU:' + menuName;
        nameOf.set(vid, menuName);
        if (!adjacency.has(inv.proc_id)) adjacency.set(inv.proc_id, []);
        if (!adjacency.get(inv.proc_id).some(x => x.childId === vid))
          adjacency.get(inv.proc_id).push({ childId: vid });
        if (!adjacency.has(vid)) adjacency.set(vid, []);
      }
    }
    console.log(`[graph] menu nodes injected=${[...textsByMenu.keys()].length} ${Date.now()-t0}ms`);
  }

  const graph = { adjacency, nameOf, dlgEdges, textsByMenu, ts: Date.now() };
  graphCache.set(key, graph);
  console.log(`[graph] cached key=${key} total=${Date.now()-t0}ms`);
  return graph;
}

// ── Tester: reachable dialogs from an entry-point process ─────────────────────
// Graph (Q1-Q4) is cached per server|app — only BFS re-runs per entry change.
app.get('/api/tester/dialogs', async (req, res) => {
  try {
    const server  = getServer(req);
    const app     = req.query.app || 'WA';
    const entryId = (req.query.entry || '').toUpperCase();
    if (!entryId) return send(res, []);

    const t0 = Date.now();
    console.log(`[dialogs] start entry=${entryId} app=${app}`);

    const { adjacency, nameOf, dlgEdges, textsByMenu } = await getGraph(server, app);

    // BFS from entry point — track one parent per node (shortest path)
    const parentOf = new Map([[entryId, null]]);
    const queue    = [entryId];
    while (queue.length) {
      const procId   = queue.shift();
      for (const { childId } of (adjacency.get(procId) || [])) {
        if (!parentOf.has(childId)) { parentOf.set(childId, procId); queue.push(childId); }
      }
    }

    // Reconstruct path string by walking parent pointers
    function pathTo(id) {
      const parts = [];
      let cur = id;
      while (cur != null) { parts.unshift(nameOf.get(cur) || cur); cur = parentOf.get(cur); }
      return parts.join(' \u2192 ');
    }

    // Regular dialogs reachable from this entry
    const result = dlgEdges
      .filter(r => parentOf.has(r.proc_id))
      .map(r => ({ dialog_name: r.dialog_name, dialog_id: r.dialog_id, call_path: pathTo(r.proc_id), type: 'dialog' }));

    // Dynamic menu rows — path ends with each visible menu-item text
    for (const [menuName, itemTexts] of textsByMenu) {
      const vid = 'MENU:' + menuName;
      if (!parentOf.has(vid)) continue;
      const prefix = pathTo(vid);
      for (const itemText of [...itemTexts].sort())
        result.push({ dialog_name: menuName, dialog_id: null, call_path: prefix + ' \u2192 ' + itemText, type: 'menu' });
    }

    result.sort((a, b) => a.dialog_name.localeCompare(b.dialog_name) || a.call_path.localeCompare(b.call_path));
    const mc = result.filter(r => r.type === 'menu').length;
    console.log(`[dialogs] done reachable=${parentOf.size} dialogs=${result.length - mc} menus=${mc} total=${Date.now()-t0}ms`);
    send(res, result);
  } catch(e) { sendErr(res, e); }
});

// ── Tester: dynamic menu (_-prefixed) calls reachable from an entry-point ─────
// Strategy: query t_menu directly for ALL _-prefixed menus whose target processes
// exist in this app.  BFS is used only to identify which reachable processes could
// be callers — we no longer require the menu to appear as an explicit action_type=1 edge.
app.get('/api/tester/dynamic-menus', async (req, res) => {
  try {
    const server  = getServer(req);
    const appName = req.query.app || 'WA';
    const entryId = (req.query.entry || '').toUpperCase();
    if (!entryId) return send(res, []);

    const t0 = Date.now();
    console.log(`[dynmenus] start entry=${entryId} app=${appName}`);

    // Q1 — all _-prefixed menus from t_menu (no app filter — menus are global in the runtime db)
    const menuRows = await runQuery(server, `
      SELECT DISTINCT
        tm.process   AS dyn_proc,
        tm.area_id,
        tm.menu_level,
        tm.sequence,
        tm.text,
        tm.name      AS target_name
      FROM ADV.dbo.t_menu tm (NOLOCK)
      WHERE tm.process LIKE '[_]%'
      ORDER BY tm.process, tm.area_id, tm.sequence`, {});
    console.log(`[dynmenus] Q1 menus=${menuRows.length} ${Date.now()-t0}ms`);

    if (!menuRows.length) {
      console.log(`[dynmenus] no dynamic menus found for app=${appName} ${Date.now()-t0}ms`);
      return send(res, []);
    }

    // Q2 — all subprocess call edges (action_type=1) for BFS to find reachable callers
    const edges = await runQuery(server, `
      SELECT DISTINCT
        UPPER(CAST(d.id        AS NVARCHAR(36))) AS parent_id,
        UPPER(CAST(d.action_id AS NVARCHAR(36))) AS child_id,
        child.name AS child_name,
        m.name     AS parent_name
      FROM t_app_process_object_detail d (NOLOCK)
      JOIN t_app_process_object m     (NOLOCK) ON m.id = d.id
      JOIN t_app_process_object child (NOLOCK) ON child.id = d.action_id
      JOIN t_application_development  a (NOLOCK) ON m.application_id = a.application_id
      WHERE d.action_type = 1 AND d.commented_out = 0 AND a.name = @app`, { app: appName });
    console.log(`[dynmenus] Q2 edges=${edges.length} ${Date.now()-t0}ms`);

    // BFS from entry point to find reachable process IDs and paths
    const adjacency = new Map();
    const nameOf    = new Map();
    for (const e of edges) {
      nameOf.set(e.parent_id, e.parent_name);
      nameOf.set(e.child_id,  e.child_name);
      if (!adjacency.has(e.parent_id)) adjacency.set(e.parent_id, []);
      adjacency.get(e.parent_id).push(e.child_id);
    }
    const parentOf = new Map([[entryId, null]]);
    const queue    = [entryId];
    while (queue.length) {
      const id = queue.shift();
      for (const cid of (adjacency.get(id) || [])) {
        if (!parentOf.has(cid)) { parentOf.set(cid, id); queue.push(cid); }
      }
    }
    function pathTo(id) {
      const parts = []; let cur = id;
      while (cur != null) { parts.unshift(nameOf.get(cur) || cur); cur = parentOf.get(cur); }
      return parts.join(' \u2192 ');
    }

    // Q3 — all dialog steps in the app so we can map target process → screens
    const dlgEdges = await runQuery(server, `
      SELECT DISTINCT
        UPPER(CAST(d.id   AS NVARCHAR(36))) AS proc_id,
        m.name                              AS proc_name,
        dlg.name                            AS dialog_name
      FROM t_app_process_object_detail d (NOLOCK)
      JOIN t_act_dialog               dlg (NOLOCK) ON dlg.id = d.action_id
      JOIN t_app_process_object       m   (NOLOCK) ON m.id = d.id
      JOIN t_application_development  a   (NOLOCK) ON m.application_id = a.application_id
      WHERE d.action_type = 6 AND d.commented_out = 0 AND a.name = @app`, { app: appName });
    console.log(`[dynmenus] Q3 dlgs=${dlgEdges.length} ${Date.now()-t0}ms`);

    // Build maps: proc_name → proc_id(s), proc_id → dialog_names
    const idsByName  = new Map(); // proc_name → [proc_id, ...]
    const dlgsByProc = new Map(); // proc_id   → Set<dialog_name>
    for (const d of dlgEdges) {
      if (!idsByName.has(d.proc_name)) idsByName.set(d.proc_name, []);
      if (!idsByName.get(d.proc_name).includes(d.proc_id)) idsByName.get(d.proc_name).push(d.proc_id);
      if (!dlgsByProc.has(d.proc_id)) dlgsByProc.set(d.proc_id, new Set());
      dlgsByProc.get(d.proc_id).add(d.dialog_name);
    }

    // Helper — dialogs directly on a named process
    function dialogsFor(procName) {
      const ids = idsByName.get(procName) || [];
      const out = new Set();
      for (const id of ids) for (const d of (dlgsByProc.get(id) || [])) out.add(d);
      return [...out].sort();
    }

    // Helper — BFS path from entry to a named target process (via existing parentOf)
    function pathToName(procName) {
      const ids = idsByName.get(procName) || [];
      // pick the one that is reachable (shortest BFS path)
      let best = null;
      for (const id of ids) {
        if (parentOf.has(id)) { best = id; break; }
      }
      return best ? pathTo(best) : '';
    }

    // Group menu options by dyn_proc — deduplicate by distinct target_name, enrich with path+dialogs
    const menuByProc = {};
    const seenOpt    = new Set();
    for (const r of menuRows) {
      const optKey = `${r.dyn_proc}|${r.target_name}`;
      if (seenOpt.has(optKey)) continue;
      seenOpt.add(optKey);
      if (!menuByProc[r.dyn_proc]) menuByProc[r.dyn_proc] = [];
      menuByProc[r.dyn_proc].push({
        area:    r.area_id,
        level:   r.menu_level,
        seq:     r.sequence,
        text:    r.text,
        target:  r.target_name,
        path:    pathToName(r.target_name),
        dialogs: dialogsFor(r.target_name),
      });
    }

    // For each _-menu, find reachable processes that explicitly call it via action_type=1
    // Deduplicate by distinct parent_id (same process may call the menu in multiple steps)
    const callersOf  = {}; // dyn_proc_name → [{ caller, call_path }]
    const seenCaller = new Set();
    for (const e of edges) {
      if (!e.child_name.startsWith('_')) continue;
      if (!parentOf.has(e.parent_id))   continue;
      const callerKey = `${e.child_name}|${e.parent_id}`;
      if (seenCaller.has(callerKey)) continue;
      seenCaller.add(callerKey);
      if (!callersOf[e.child_name]) callersOf[e.child_name] = [];
      callersOf[e.child_name].push({ caller: e.parent_name, call_path: pathTo(e.parent_id) });
    }

    // Build result — one row per distinct _-menu
    const result = Object.keys(menuByProc).sort().map(proc => ({
      dyn_proc:     proc,
      callers:      callersOf[proc] || [],
      menu_options: menuByProc[proc],
    }));

    console.log(`[dynmenus] done menus=${result.length} ${Date.now()-t0}ms`);
    send(res, result);
  } catch(e) { sendErr(res, e); }
});

// ── VirtTerm device config per app ───────────────────────────────────────────
// Returns Virtual Terminal devices with their connection details (name, IP, port)
// so the test framework can configure VirtTerm's registry before launching it.
app.get('/api/vt-devices', async (req, res) => {
  const app = req.query.app || '';
  try {
    const rows = await runQuery(getServer(req), `
      SELECT
        d.device_name,
        d.ip_address,
        d.port,
        dt.dev_type,
        a.name AS app_name
      FROM ADV.dbo.t_device       (NOLOCK) d
      JOIN ADV.dbo.t_solution     (NOLOCK) sol ON sol.solution_id    = d.solution_id
      JOIN ADV.dbo.t_device_type  (NOLOCK) dt  ON dt.device_type_id  = d.device_type_id
      JOIN EAR.dbo.t_application_development (NOLOCK) a
           ON a.application_id = sol.application_id
      WHERE dt.dev_type LIKE '%Virtual%'
        AND (@app = '' OR a.name = @app)
      ORDER BY a.name, d.device_name`, { app });
    send(res, rows);
  } catch(e) {
    // Column names vary across WMS versions -- fall back to broader exploration
    try {
      const rows = await runQuery(getServer(req), `
        SELECT TOP 20 d.*, dt.dev_type, a.name AS app_name
        FROM ADV.dbo.t_device      (NOLOCK) d
        JOIN ADV.dbo.t_solution    (NOLOCK) sol ON sol.solution_id   = d.solution_id
        JOIN ADV.dbo.t_device_type (NOLOCK) dt  ON dt.device_type_id = d.device_type_id
        JOIN EAR.dbo.t_application_development (NOLOCK) a
             ON a.application_id = sol.application_id
        WHERE dt.dev_type LIKE '%Virtual%'`, {});
      send(res, rows);
    } catch(e2) { sendErr(res, e2); }
  }
});

// ── Launch VirtTerm ───────────────────────────────────────────────────────────
const VIRTTERM_EXE = 'C:\\Users\\PVenkatesh\\Downloads\\VirtualScanner\\x86\\VirtTerm.exe';

app.post('/api/launch-virtterm', (_req, res) => {
  try {
    const proc = spawn(VIRTTERM_EXE, [], { detached: true, stdio: 'ignore' });
    proc.unref();
    console.log(`[virtterm] launched pid=${proc.pid}`);
    send(res, { ok: true, pid: proc.pid });
  } catch (e) {
    console.error('[virtterm] launch failed:', e.message);
    sendErr(res, e);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const { exec, spawn } = require('child_process');
http.createServer(app).listen(PORT, () => {
  console.log(`EAR Explorer running at http://localhost:${PORT}`);
  exec(`start http://localhost:${PORT}`);
});
http.createServer(app).listen(TESTER_PORT, () => {
  console.log(`EAR Tester  running at http://localhost:${TESTER_PORT}`);
  exec(`start http://localhost:${TESTER_PORT}`);
});
