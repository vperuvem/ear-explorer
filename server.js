const express = require('express');
const sql = require('mssql/msnodesqlv8');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const config = {
  connectionString:
    'Driver={SQL Server Native Client 11.0};Server=ArcadiaWHJSqlStage;Database=EAR;Trusted_Connection=yes;'
};


// Search: returns matching process objects (list view)
app.get('/api/search', async (req, res) => {
  const process     = req.query.process     || '';
  const application = req.query.application || 'WA';
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('process',     sql.NVarChar, process)
      .input('application', sql.NVarChar, application)
      .query(`
        SELECT m.id, m.name, m.description, m.version, m.comments
        FROM t_app_process_object m (NOLOCK)
        JOIN t_application_development a (NOLOCK) ON m.application_id = a.application_id
        WHERE a.name = @application
        AND lower(m.name) LIKE '%' + lower(@process) + '%'
        ORDER BY lower(m.name)
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Detail: returns all steps for a specific process by ID
const DETAIL_QUERY = `
SELECT
    m.name AS process_name, d.sequence, d.label,
    CASE d.action_type
        WHEN  1 THEN 'Process'    WHEN  3 THEN 'Calculate'
        WHEN  4 THEN 'Compare'    WHEN  5 THEN 'Database'
        WHEN  6 THEN 'Dialog'     WHEN  7 THEN 'Execute'
        WHEN  9 THEN 'List'       WHEN 11 THEN 'Receive'
        WHEN 12 THEN 'Report'     WHEN 13 THEN 'Send'
        WHEN 14 THEN 'User'       WHEN -1 THEN 'Comment'
        ELSE 'Unknown (' + CAST(d.action_type AS VARCHAR) + ')'
    END AS action_type_name,
    d.action_type,
    COALESCE(po.name, calc.name, comp.name, db.name, dlg.name,
             exe.name, lst.name, snd.name, usr.name, rcv.name, rpt.name,
             '---- COMMENT ---- ' + m.comments) AS action_name,
    d.pass_label, d.fail_label, d.commented_out,
    CAST(d.action_id AS NVARCHAR(36)) AS action_id,
    CAST(m.id AS NVARCHAR(36)) AS process_id
FROM t_app_process_object m (NOLOCK)
JOIN t_app_process_object_detail d (NOLOCK) ON m.id = d.id
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
WHERE a.name = @application AND m.id = @id
ORDER BY d.sequence
`;

app.get('/api/process/:id', async (req, res) => {
  const id          = req.params.id;
  const application = req.query.application || 'WA';
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('id',          sql.NVarChar, id)
      .input('application', sql.NVarChar, application)
      .query(DETAIL_QUERY);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Callers: all parent processes that call a given child process by name
const CALLERS_QUERY = `
SELECT
    m.name          AS process_name,
    d.sequence,
    d.label,
    CASE d.action_type
        WHEN  1 THEN 'Process'    WHEN  3 THEN 'Calculate'
        WHEN  4 THEN 'Compare'    WHEN  5 THEN 'Database'
        WHEN  6 THEN 'Dialog'     WHEN  7 THEN 'Execute'
        WHEN  9 THEN 'List'       WHEN 11 THEN 'Receive'
        WHEN 12 THEN 'Report'     WHEN 13 THEN 'Send'
        WHEN 14 THEN 'User'       WHEN -1 THEN 'Comment'
        ELSE 'Unknown (' + CAST(d.action_type AS VARCHAR) + ')'
    END AS action_type_name,
    d.action_type,
    COALESCE(po.name, calc.name, comp.name, db.name, dlg.name,
             exe.name, lst.name, snd.name, usr.name, rcv.name, rpt.name,
             '---- COMMENT ---- ' + m.comments) AS action_name,
    d.pass_label,
    d.fail_label,
    d.commented_out,
    d.action_id,
    m.id AS process_id
FROM t_app_process_object m (NOLOCK)
JOIN t_app_process_object_detail d (NOLOCK) ON m.id = d.id
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
WHERE a.name = @application
AND m.id IN (
    SELECT DISTINCT d2.id
    FROM t_app_process_object_detail d2 (NOLOCK)
    JOIN t_app_process_object child (NOLOCK)
        ON d2.action_id = child.id
        AND d2.action_type = 1
        AND child.name COLLATE SQL_Latin1_General_CP1_CS_AS = @childProcess
)
ORDER BY lower(m.name), d.sequence
`;

app.get('/api/callers', async (req, res) => {
  const childProcess = req.query.childProcess || '';
  const application  = req.query.application  || 'WA';
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('childProcess', sql.NVarChar, childProcess)
      .input('application',  sql.NVarChar, application)
      .query(CALLERS_QUERY);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Database action detail: fetch SQL statements from t_act_database_detail
app.get('/api/db-action/:actionId', async (req, res) => {
  const actionId = req.params.actionId;
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('actionId', sql.NVarChar, actionId)
      .query(`
        SELECT
            db.name,
            db.description,
            dd.sequence,
            dd.provider_type,
            dd.statement
        FROM t_act_database db (NOLOCK)
        JOIN t_act_database_detail dd (NOLOCK) ON db.id = dd.id
        WHERE db.id = @actionId
        ORDER BY dd.sequence
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`EAR Explorer running at http://localhost:${PORT}`));
