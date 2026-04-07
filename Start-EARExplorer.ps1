# EAR Explorer - PowerShell HTTP Server
$Port      = 3000
$Server    = 'ArcadiaWHJSqlStage'
$Database  = 'EAR'
$IndexHtml = Join-Path $PSScriptRoot 'public\index.html'
$ConnStr   = "Server=$Server;Database=$Database;Integrated Security=True;TrustServerCertificate=True"

# Raw query helper — returns an array of hashtables (no JSON conversion)
function Invoke-SqlRaw($sql, $params = @{}) {
    $conn = New-Object System.Data.SqlClient.SqlConnection $ConnStr
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    foreach ($k in $params.Keys) {
        $cmd.Parameters.Add((New-Object System.Data.SqlClient.SqlParameter($k, $params[$k]))) | Out-Null
    }
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
    $table   = New-Object System.Data.DataTable
    $adapter.Fill($table) | Out-Null
    $conn.Close()
    $rows = foreach ($row in $table.Rows) {
        $obj = @{}
        foreach ($col in $table.Columns) {
            $v = $row[$col.ColumnName]
            $obj[$col.ColumnName] = if ($v -is [DBNull]) { $null } else { $v }
        }
        $obj
    }
    if ($null -eq $rows) { return @() }
    return @($rows)
}

# JSON wrapper — always returns a JSON array string
function Invoke-Sql($sql, $params = @{}) {
    $rows = Invoke-SqlRaw $sql $params
    return ConvertTo-Json -InputObject @($rows) -Depth 3
}

# Replace :#type#GUID#: placeholders in statement fields with names from t_app_field / t_app_record
# Type 17 -> Field, Type 19 -> Record
$TYPE_LABELS = @{ '17' = 'Field'; '19' = 'Record' }

function Resolve-Guids($rows) {
    $pat  = ':#(\d+)#([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})#:'
    $guids = @()
    foreach ($row in $rows) {
        if ($row.statement) {
            [regex]::Matches($row.statement, $pat) | ForEach-Object {
                $guids += $_.Groups[2].Value.ToUpper()
            }
        }
    }
    $guids = $guids | Select-Object -Unique
    if ($guids.Count -eq 0) { return $rows }

    $inClause = ($guids | ForEach-Object { "'$_'" }) -join ','
    $nameSql  = "SELECT UPPER(id) AS id, name FROM t_app_field  WHERE UPPER(id) IN ($inClause)
                 UNION ALL
                 SELECT UPPER(id) AS id, name FROM t_app_record WHERE UPPER(id) IN ($inClause)"
    $nameMap  = @{}
    foreach ($nr in (Invoke-SqlRaw $nameSql @{})) { $nameMap[$nr.id] = $nr.name }

    foreach ($row in $rows) {
        if ($row.statement) {
            $row.statement = [regex]::Replace($row.statement, $pat, {
                param($m)
                $typeNum = $m.Groups[1].Value
                $guid    = $m.Groups[2].Value.ToUpper()
                $label   = if ($TYPE_LABELS.ContainsKey($typeNum)) { $TYPE_LABELS[$typeNum] } else { "Type$typeNum" }
                if ($nameMap.ContainsKey($guid)) { "[$label`: $($nameMap[$guid])]" } else { $m.Value }
            })
        }
    }
    return $rows
}

$DETAIL_JOINS = @"
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
"@

$DETAIL_COLS = @"
SELECT DISTINCT m.name AS process_name, d.sequence, d.label,
    CASE d.action_type
        WHEN  1 THEN 'Process'    WHEN  3 THEN 'Calculate'  WHEN  4 THEN 'Compare'
        WHEN  5 THEN 'Database'   WHEN  6 THEN 'Dialog'     WHEN  7 THEN 'Execute'
        WHEN  9 THEN 'List'       WHEN 11 THEN 'Receive'    WHEN 12 THEN 'Report'
        WHEN 13 THEN 'Send'       WHEN 14 THEN 'User'       WHEN 19 THEN 'Record'
        WHEN -1 THEN 'Comment'
        ELSE 'Unknown (' + CAST(d.action_type AS VARCHAR) + ')'
    END AS action_type_name, d.action_type,
    COALESCE(po.name,calc.name,comp.name,db.name,dlg.name,exe.name,
             lst.name,snd.name,usr.name,rcv.name,rpt.name,rec.name,
             d.comments) AS action_name,
    d.pass_label, d.fail_label, d.commented_out,
    CAST(d.action_id AS NVARCHAR(36)) AS action_id,
    CAST(m.id AS NVARCHAR(36)) AS process_id
"@

function Send-Json($resp, $json) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $resp.ContentType = 'application/json; charset=utf-8'
    $resp.OutputStream.Write($bytes, 0, $bytes.Length)
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "EAR Explorer at http://localhost:$Port" -ForegroundColor Cyan
Start-Process "http://localhost:$Port"

while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $resp = $ctx.Response
    try {
        $path = $req.Url.AbsolutePath
        $qs   = $req.QueryString

        if ($path -eq '/' -or $path -eq '/index.html') {
            $html = [System.IO.File]::ReadAllBytes($IndexHtml)
            $resp.ContentType = 'text/html'
            $resp.OutputStream.Write($html, 0, $html.Length)

        } elseif ($path -eq '/api/search') {
            # Returns list of matching process objects
            $proc = if ($qs['process']) { $qs['process'] } else { '' }
            $app  = if ($qs['application']) { $qs['application'] } else { 'WA' }
            $sql  = "SELECT CAST(m.id AS NVARCHAR(36)) AS id, m.name, m.description, m.version
                     FROM t_app_process_object m (NOLOCK)
                     JOIN t_application_development a (NOLOCK) ON m.application_id = a.application_id
                     WHERE a.name = @app AND lower(m.name) LIKE '%' + lower(@proc) + '%'
                     ORDER BY m.name"
            Send-Json $resp (Invoke-Sql $sql @{ '@proc'=$proc; '@app'=$app })

        } elseif ($path -match '^/api/process/(.+)$') {
            # Returns steps for a specific process by ID
            $id  = [System.Uri]::UnescapeDataString($Matches[1])
            $app = if ($qs['application']) { $qs['application'] } else { 'WA' }
            $sql = "$DETAIL_COLS $DETAIL_JOINS WHERE a.name = @app AND m.id = @id ORDER BY d.sequence"
            Send-Json $resp (Invoke-Sql $sql @{ '@id'=$id; '@app'=$app })

        } elseif ($path -eq '/api/callers') {
            # Returns all processes that call a given child process
            $child = if ($qs['childProcess']) { $qs['childProcess'] } else { '' }
            $app   = if ($qs['application'])  { $qs['application'] }  else { 'WA' }
            $sql   = "$DETAIL_COLS $DETAIL_JOINS
                      WHERE a.name = @app
                      AND m.id IN (
                          SELECT DISTINCT d2.id FROM t_app_process_object_detail d2 (NOLOCK)
                          JOIN t_app_process_object ch (NOLOCK)
                              ON d2.action_id = ch.id AND d2.action_type = 1
                              AND ch.name COLLATE SQL_Latin1_General_CP1_CS_AS = @child)
                      ORDER BY m.name, d.sequence"
            Send-Json $resp (Invoke-Sql $sql @{ '@child'=$child; '@app'=$app })

        } elseif ($path -eq '/api/caller-objects') {
            # Returns unique caller process objects (for list view) — lighter than /api/callers
            $child = if ($qs['childProcess']) { $qs['childProcess'] } else { '' }
            $app   = if ($qs['application'])  { $qs['application'] }  else { 'WA' }
            $sql   = "SELECT DISTINCT
                          CAST(m.id AS NVARCHAR(36)) AS id,
                          m.name, m.description, m.version
                      FROM t_app_process_object m (NOLOCK)
                      JOIN t_application_development a (NOLOCK) ON m.application_id = a.application_id
                      JOIN t_app_process_object_detail d (NOLOCK) ON d.id = m.id AND d.action_type = 1
                      JOIN t_app_process_object ch (NOLOCK) ON d.action_id = ch.id
                      WHERE a.name = @app
                      AND ch.name COLLATE SQL_Latin1_General_CP1_CS_AS = @child
                      ORDER BY m.name"
            Send-Json $resp (Invoke-Sql $sql @{ '@child'=$child; '@app'=$app })

        } elseif ($path -match '^/api/compare-action/(.+)$') {
            # Returns Compare action detail with resolved operand names
            $id  = [System.Uri]::UnescapeDataString($Matches[1])
            $sql = "SELECT
                        c.name, c.description,
                        CASE c.operator_id
                            WHEN 0 THEN '='   WHEN 1 THEN '<>'
                            WHEN 2 THEN '>'   WHEN 3 THEN '>='
                            WHEN 4 THEN '<'   WHEN 5 THEN '<='
                            ELSE 'Op(' + CAST(c.operator_id AS VARCHAR) + ')'
                        END AS operator_symbol,
                        c.operand1_type,
                        CASE c.operand1_type
                            WHEN 17 THEN COALESCE(f1.name, c.operand1_id)
                            WHEN 18 THEN COALESCE(c1.data_string,
                                         CAST(c1.data_number   AS NVARCHAR(50)),
                                         CAST(c1.data_datetime AS NVARCHAR(50)))
                            WHEN 19 THEN COALESCE(r1.name, c.operand1_id)
                            WHEN -1 THEN 'Current Row'
                            ELSE NULL
                        END AS operand1_name,
                        c.operand2_type,
                        CASE c.operand2_type
                            WHEN 17 THEN COALESCE(f2.name, c.operand2_id)
                            WHEN 18 THEN COALESCE(c2.data_string,
                                         CAST(c2.data_number   AS NVARCHAR(50)),
                                         CAST(c2.data_datetime AS NVARCHAR(50)))
                            WHEN 19 THEN COALESCE(r2.name, c.operand2_id)
                            WHEN -1 THEN 'Current Row'
                            ELSE NULL
                        END AS operand2_name
                    FROM t_act_compare c (NOLOCK)
                    LEFT JOIN t_app_field    f1 (NOLOCK) ON c.operand1_type = 17 AND c.operand1_id = f1.id
                    LEFT JOIN t_app_record   r1 (NOLOCK) ON c.operand1_type = 19 AND c.operand1_id = r1.id
                    LEFT JOIN t_app_constant c1 (NOLOCK) ON c.operand1_type = 18 AND c.operand1_id = c1.id
                    LEFT JOIN t_app_field    f2 (NOLOCK) ON c.operand2_type = 17 AND c.operand2_id = f2.id
                    LEFT JOIN t_app_record   r2 (NOLOCK) ON c.operand2_type = 19 AND c.operand2_id = r2.id
                    LEFT JOIN t_app_constant c2 (NOLOCK) ON c.operand2_type = 18 AND c.operand2_id = c2.id
                    WHERE c.id = @id"
            Send-Json $resp (Invoke-Sql $sql @{ '@id'=$id })

        } elseif ($path -match '^/api/calc-action/(.+)$') {
            # Returns Calculate action detail rows with resolved names
            $id  = [System.Uri]::UnescapeDataString($Matches[1])
            $sql = "SELECT
                        c.name, c.description,
                        cd.sequence,
                        CASE cd.operator_id
                            WHEN  0 THEN '+'        WHEN  1 THEN '-'
                            WHEN  2 THEN '*'        WHEN  3 THEN '/'
                            WHEN  4 THEN '%'        WHEN  5 THEN '&'
                            WHEN  6 THEN 'Mid'      WHEN  7 THEN 'Search'
                            WHEN  8 THEN 'Len'      WHEN  9 THEN ':='
                            WHEN 13 THEN 'Date+'    WHEN 19 THEN 'Date-'
                            ELSE 'Op(' + CAST(cd.operator_id AS VARCHAR) + ')'
                        END AS operator_symbol,
                        cd.result_type,
                        COALESCE(rf.name, rr.name) AS result_name,
                        cd.operand1_type,
                        CASE cd.operand1_type
                            WHEN 18 THEN COALESCE(c1.data_string,
                                         CAST(c1.data_number AS NVARCHAR(50)),
                                         CAST(c1.data_datetime AS NVARCHAR(50)))
                            WHEN -1 THEN 'Current Row'
                            ELSE COALESCE(f1.name, r1.name)
                        END AS operand1_name,
                        cd.operand2_type,
                        CASE cd.operand2_type
                            WHEN 18 THEN COALESCE(c2.data_string,
                                         CAST(c2.data_number AS NVARCHAR(50)),
                                         CAST(c2.data_datetime AS NVARCHAR(50)))
                            WHEN -1 THEN 'Current Row'
                            ELSE COALESCE(f2.name, r2.name)
                        END AS operand2_name,
                        cd.operand3_type,
                        CASE cd.operand3_type
                            WHEN 18 THEN COALESCE(c3.data_string,
                                         CAST(c3.data_number AS NVARCHAR(50)),
                                         CAST(c3.data_datetime AS NVARCHAR(50)))
                            WHEN -1 THEN 'Current Row'
                            ELSE COALESCE(f3.name, r3.name)
                        END AS operand3_name
                    FROM t_act_calculate c (NOLOCK)
                    JOIN t_act_calculate_detail cd (NOLOCK) ON c.id = cd.id
                    LEFT JOIN t_app_field    rf (NOLOCK) ON cd.result_type   = 17 AND cd.result_id   = rf.id
                    LEFT JOIN t_app_record   rr (NOLOCK) ON cd.result_type   = 19 AND cd.result_id   = rr.id
                    LEFT JOIN t_app_field    f1 (NOLOCK) ON cd.operand1_type = 17 AND cd.operand1_id = f1.id
                    LEFT JOIN t_app_record   r1 (NOLOCK) ON cd.operand1_type = 19 AND cd.operand1_id = r1.id
                    LEFT JOIN t_app_constant c1 (NOLOCK) ON cd.operand1_type = 18 AND cd.operand1_id = c1.id
                    LEFT JOIN t_app_field    f2 (NOLOCK) ON cd.operand2_type = 17 AND cd.operand2_id = f2.id
                    LEFT JOIN t_app_record   r2 (NOLOCK) ON cd.operand2_type = 19 AND cd.operand2_id = r2.id
                    LEFT JOIN t_app_constant c2 (NOLOCK) ON cd.operand2_type = 18 AND cd.operand2_id = c2.id
                    LEFT JOIN t_app_field    f3 (NOLOCK) ON cd.operand3_type = 17 AND cd.operand3_id = f3.id
                    LEFT JOIN t_app_record   r3 (NOLOCK) ON cd.operand3_type = 19 AND cd.operand3_id = r3.id
                    LEFT JOIN t_app_constant c3 (NOLOCK) ON cd.operand3_type = 18 AND cd.operand3_id = c3.id
                    WHERE c.id = @id
                    ORDER BY cd.sequence"
            Send-Json $resp (Invoke-Sql $sql @{ '@id'=$id })

        } elseif ($path -match '^/api/list-action/(.+)$') {
            # Returns List action detail with resolved names
            $id  = [System.Uri]::UnescapeDataString($Matches[1])
            $sql = "SELECT
                        l.name, l.description, l.find_exact,
                        CASE l.operator_id
                            WHEN  0 THEN 'Get Max'          WHEN  1 THEN 'Get Row Number'
                            WHEN  2 THEN 'Add Row'          WHEN  3 THEN 'Add Record'
                            WHEN  4 THEN 'Insert Record'    WHEN  6 THEN 'Replace Fields'
                            WHEN  8 THEN 'Delete Record'    WHEN  9 THEN 'Find'
                            WHEN 11 THEN 'Get First Row'    WHEN 12 THEN 'Get Last Row'
                            WHEN 13 THEN 'Get Next Row'     WHEN 14 THEN 'Get Previous Row'
                            WHEN 15 THEN 'Get Row'          WHEN 16 THEN 'Clear'
                            ELSE 'Unknown (' + CAST(l.operator_id AS VARCHAR) + ')'
                        END AS operator_name,
                        COALESCE(rl.name, l.list_id)  AS list_name,
                        l.operand1_type,
                        CASE l.operand1_type
                            WHEN  17 THEN COALESCE(f1.name, l.operand1_id)
                            WHEN  19 THEN COALESCE(r1.name, l.operand1_id)
                            WHEN  -1 THEN 'Current Row'
                            ELSE NULL
                        END AS operand1_name,
                        l.operand2_type,
                        CASE l.operand2_type
                            WHEN  17 THEN COALESCE(f2.name, l.operand2_id)
                            WHEN  19 THEN COALESCE(r2.name, l.operand2_id)
                            WHEN  -1 THEN 'Current Row'
                            ELSE NULL
                        END AS operand2_name
                    FROM t_act_list l (NOLOCK)
                    LEFT JOIN t_app_record rl (NOLOCK) ON l.list_id        = rl.id
                    LEFT JOIN t_app_field  f1 (NOLOCK) ON l.operand1_type  = 17 AND l.operand1_id = f1.id
                    LEFT JOIN t_app_record r1 (NOLOCK) ON l.operand1_type  = 19 AND l.operand1_id = r1.id
                    LEFT JOIN t_app_field  f2 (NOLOCK) ON l.operand2_type  = 17 AND l.operand2_id = f2.id
                    LEFT JOIN t_app_record r2 (NOLOCK) ON l.operand2_type  = 19 AND l.operand2_id = r2.id
                    WHERE l.id = @id"
            Send-Json $resp (Invoke-Sql $sql @{ '@id'=$id })

        } elseif ($path -match '^/api/dialog-action/(.+)$') {
            $id  = [System.Uri]::UnescapeDataString($Matches[1])
            $sql = "SELECT
                        d.name, d.description, dd.sequence,
                        COALESCE(ff.name, fr.name, dd.field_id) AS field_name,
                        CASE dd.field_type WHEN 17 THEN 'Field' WHEN 19 THEN 'Record' ELSE '' END AS field_type_name,
                        COALESCE(pf.name, pc.value, pr.name, CASE WHEN dd.prompt_type IN (-1,0) THEN '' ELSE dd.prompt_id END) AS prompt_name,
                        CASE dd.prompt_type WHEN 17 THEN 'Field' WHEN 18 THEN 'Const' WHEN 21 THEN 'Resource' ELSE '' END AS prompt_type_name,
                        COALESCE(pv.name, CASE WHEN dd.validation_type IN (-1,0) THEN '' ELSE dd.validation_id END) AS validation_name,
                        CASE dd.validation_type WHEN 1 THEN 'Process' ELSE '' END AS validation_type_name,
                        dd.required, dd.clear_initially
                    FROM t_act_dialog d (NOLOCK)
                    JOIN t_act_dialog_detail dd (NOLOCK) ON d.id = dd.id
                    LEFT JOIN t_app_field    ff (NOLOCK) ON dd.field_type      = 17 AND dd.field_id      = ff.id
                    LEFT JOIN t_app_record   fr (NOLOCK) ON dd.field_type      = 19 AND dd.field_id      = fr.id
                    LEFT JOIN t_app_field    pf (NOLOCK) ON dd.prompt_type     = 17 AND dd.prompt_id     = pf.id
                    LEFT JOIN t_app_constant pc (NOLOCK) ON dd.prompt_type     = 18 AND dd.prompt_id     = pc.id
                    LEFT JOIN t_resource     pr (NOLOCK) ON dd.prompt_type     = 21 AND dd.prompt_id     = pr.id
                    LEFT JOIN t_app_process_object pv (NOLOCK) ON dd.validation_type = 1 AND dd.validation_id = pv.id
                    WHERE d.id = @id
                    ORDER BY dd.sequence"
            Send-Json $resp (Invoke-Sql $sql @{ '@id'=$id })

        } elseif ($path -match '^/api/db-action/(.+)$') {
            # Returns SQL statements with :#type#GUID#: placeholders resolved to field names
            $id   = [System.Uri]::UnescapeDataString($Matches[1])
            $sql  = "SELECT dm.name, dm.description, dd.sequence, dd.provider_type,
                            CAST(dd.statement AS NVARCHAR(MAX)) AS statement
                     FROM t_act_database dm (NOLOCK)
                     JOIN t_act_database_detail dd (NOLOCK) ON dd.id = dm.id
                     JOIN t_application_development a (NOLOCK) ON dm.application_id = a.application_id
                     WHERE dm.id = @id
                     ORDER BY dd.sequence"
            $rows = Resolve-Guids (Invoke-SqlRaw $sql @{ '@id'=$id })
            Send-Json $resp (ConvertTo-Json -InputObject @($rows) -Depth 3)

        } else {
            $resp.StatusCode = 404
        }
    } catch {
        $msg   = $_.Exception.Message -replace '"','\"'
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$msg`"}")
        $resp.ContentType = 'application/json'
        $resp.StatusCode  = 500
        $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $resp.Close()
}
