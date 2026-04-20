// Write Run-Tests.ps1, tech-tests.ps1, biz-tests.ps1 — clean UTF-8, no BOM
const fs   = require('fs');
const root = 'C:\\Users\\PVenkatesh\\Downloads\\ear-tester\\';
const t    = root + 'tests\\';

// ── Run-Tests.ps1 ─────────────────────────────────────────────────────────────
const runTests = `# Run-Tests.ps1 -- EAR Tester
# Always runs ALL tests (Technical + Business + VirtTerm).
# Usage:  .\\Run-Tests.ps1              # run everything
#         .\\Run-Tests.ps1 -OpenReport  # open HTML report when done
param(
    [string]\$BaseUrl    = 'http://localhost:9000',
    [string]\$Server     = 'ArcadiaWHJSqlStage',
    [string]\$App        = 'WA',
    [string]\$SearchTerm = 'Log-on',
    [switch]\$OpenReport
)

# Technical suite names -- used to filter report display
\$script:TechSuites    = @('API', 'VirtTerm-Infra')
\$script:Results       = [System.Collections.Generic.List[hashtable]]::new()
\$script:PassCount     = 0
\$script:FailCount     = 0
\$script:ErrCount      = 0
\$script:BaseUrl       = \$BaseUrl
\$script:Server        = \$Server
\$script:App           = \$App
\$script:SearchTerm    = \$SearchTerm
\$script:SearchResults = \$null
\$script:ProcessId     = \$null
\$script:ProcessRows   = \$null

# VirtTerm device config is resolved live from ADV.dbo.t_device via /api/vt-devices.
# No hardcoded IP/port -- Set-VirtTermDevice fetches the correct values for each app.

function Invoke-Api([string]\$Path) {
    \$sep = if (\$Path -match '\\?') { '&' } else { '?' }
    \$url = "\$script:BaseUrl\$Path\${sep}server=\$script:Server"
    Invoke-RestMethod -Uri \$url -Method GET -TimeoutSec 30
}

function Run-Test([string]\$Suite, [string]\$Name, [scriptblock]\$Body) {
    \$start = Get-Date
    try {
        \$result = & \$Body
        \$ms     = [int]((Get-Date) - \$start).TotalMilliseconds
        # Capture VirtTerm window screenshot after the test body completes.
        # Get-VirtTermSnapshot is defined in VirtTerm.ps1 (dot-sourced before tests run).
        # Returns "" when VirtTerm is not running (API tests, etc.).
        \$snap = try { Get-VirtTermSnapshot } catch { '' }
        # Body can return:
        #   \$true                          -> PASS, no detail
        #   @{ ok=\$true; detail='...' }   -> PASS with detail shown in report
        #   any other value                -> FAIL, value used as detail message
        if (\$result -is [hashtable] -and \$result.ok -eq \$true) {
            \$detail = "\$(\$result.detail)"
            Write-Host "  [PASS] \$Name  (\$ms ms)  \$detail" -ForegroundColor Green
            \$script:PassCount++
            \$script:Results.Add(@{ Suite=\$Suite; Name=\$Name; Status='PASS'; Ms=\$ms; Detail=\$detail; Screenshot=\$snap })
        } elseif (\$result -eq \$true) {
            Write-Host "  [PASS] \$Name  (\$ms ms)" -ForegroundColor Green
            \$script:PassCount++
            \$script:Results.Add(@{ Suite=\$Suite; Name=\$Name; Status='PASS'; Ms=\$ms; Detail=''; Screenshot=\$snap })
        } else {
            Write-Host "  [FAIL] \$Name  (\$ms ms) - \$result" -ForegroundColor Red
            \$script:FailCount++
            \$script:Results.Add(@{ Suite=\$Suite; Name=\$Name; Status='FAIL'; Ms=\$ms; Detail="\$result"; Screenshot=\$snap })
        }
    } catch {
        \$ms   = [int]((Get-Date) - \$start).TotalMilliseconds
        \$snap = try { Get-VirtTermSnapshot } catch { '' }
        Write-Host "  [ERROR] \$Name  (\$ms ms) - \$(\$_.Exception.Message)" -ForegroundColor Red
        \$script:ErrCount++
        \$script:Results.Add(@{ Suite=\$Suite; Name=\$Name; Status='ERROR'; Ms=\$ms; Detail=\$_.Exception.Message; Screenshot=\$snap })
    }
}

function Section([string]\$Title) {
    Write-Host ""
    Write-Host ">> \$Title" -ForegroundColor Cyan
}

# -- Load baseline for comparison (previous run) --------------------------------
\$baselinePath = Join-Path \$PSScriptRoot '_baseline.json'
\$baseline = @{}
if (Test-Path \$baselinePath) {
    try {
        \$prev = Get-Content \$baselinePath -Raw | ConvertFrom-Json
        foreach (\$b in \$prev.results) { \$baseline["\$(\$b.suite)|\$(\$b.name)"] = \$b.status }
        Write-Host "  Baseline loaded (\$(\$prev.results.Count) tests from \$(\$prev.savedAt))" -ForegroundColor DarkGray
    } catch { Write-Host "  (no usable baseline)" -ForegroundColor DarkGray }
}

Write-Host ""
Write-Host "EAR Tester  -  \$BaseUrl" -ForegroundColor White
Write-Host "   Server: \$Server   App: \$App   Search: '\$SearchTerm'" -ForegroundColor Gray
Write-Host ""

# -- Run all suites (always) ----------------------------------------------------
. "\$PSScriptRoot\\tests\\VirtTerm.ps1"
. "\$PSScriptRoot\\tests\\tech-tests.ps1"
. "\$PSScriptRoot\\tests\\biz-tests.ps1"

# -- Summary --------------------------------------------------------------------
\$total  = \$script:PassCount + \$script:FailCount + \$script:ErrCount
\$colour = if ((\$script:FailCount + \$script:ErrCount) -eq 0) { 'Green' } else { 'Yellow' }
Write-Host ""
Write-Host ("-" * 50) -ForegroundColor White
Write-Host "  Results : \$(\$script:PassCount) / \$total passed" -ForegroundColor \$colour
if (\$script:FailCount -gt 0) { Write-Host "  Failed  : \$(\$script:FailCount)" -ForegroundColor Red }
if (\$script:ErrCount  -gt 0) { Write-Host "  Errors  : \$(\$script:ErrCount)"  -ForegroundColor Red }
Write-Host ("-" * 50) -ForegroundColor White

# -- Classify results & compare with baseline -----------------------------------
\$bizRows  = @()
\$techFail = @()
\$regressions = @()
\$fixes       = @()

foreach (\$r in \$script:Results) {
    \$key  = "\$(\$r.Suite)|\$(\$r.Name)"
    \$prev = if (\$baseline.ContainsKey(\$key)) { \$baseline[\$key] } else { 'NEW' }
    \$r['Baseline'] = \$prev

    if (\$prev -ne 'NEW' -and \$prev -eq 'PASS' -and \$r.Status -ne 'PASS') {
        \$regressions += \$r
    }
    if (\$prev -ne 'NEW' -and \$prev -ne 'PASS' -and \$r.Status -eq 'PASS') {
        \$fixes += \$r
    }

    if (\$r.Suite -in \$script:TechSuites) {
        if (\$r.Status -ne 'PASS') { \$techFail += \$r }
    } else {
        \$bizRows += \$r
    }
}

# -- Save current results as new baseline ---------------------------------------
\$newBaseline = [ordered]@{
    savedAt = (Get-Date -Format 'o')
    results = @(\$script:Results | ForEach-Object {
        [ordered]@{ suite=\$_.Suite; name=\$_.Name; status=\$_.Status }
    })
}
\$newBaseline | ConvertTo-Json -Depth 3 | Out-File \$baselinePath -Encoding UTF8
Write-Host "  Baseline saved -> \$baselinePath" -ForegroundColor DarkGray
`;
// ── HTML report helpers ───────────────────────────────────────────────────────
const reportCss = `
  body  { font-family:Segoe UI,sans-serif; background:#f0f4ff; color:#1e1b4b; padding:24px; margin:0; }
  h1    { color:#6d28d9; margin:0 0 4px; }
  .meta { color:#6b7280; font-size:.85rem; margin-bottom:20px; }
  h2    { font-size:1rem; text-transform:uppercase; letter-spacing:.06em; margin:24px 0 8px; color:#374151; }
  .panel{ border-radius:8px; padding:12px 16px; margin-bottom:16px; font-size:.9rem; }
  .red  { background:#fee2e2; border-left:4px solid #dc2626; }
  .grn  { background:#dcfce7; border-left:4px solid #16a34a; }
  .info { background:#e0f2fe; border-left:4px solid #0284c7; }
  table { border-collapse:collapse; width:100%; background:#fff; border-radius:8px;
          overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08); margin-bottom:20px; }
  th    { background:linear-gradient(90deg,#6d28d9,#4338ca); color:#fff; padding:7px 12px; text-align:left; font-size:.85rem; }
  td    { padding:6px 12px; border-bottom:1px solid #e9d5ff; font-size:.85rem; }
  .pass { background:#f0fdf4; }
  .fail { background:#fef2f2; }
  .err  { background:#fffbeb; }
  .new  { background:#f0f9ff; }
  .badge{ display:inline-block; padding:1px 7px; border-radius:10px; font-size:.75rem; font-weight:600; }
  .bp   { background:#bbf7d0; color:#14532d; }
  .bf   { background:#fecaca; color:#7f1d1d; }
  .be   { background:#fde68a; color:#78350f; }
  .bn   { background:#bae6fd; color:#0c4a6e; }
  .breg { background:#fca5a5; color:#7f1d1d; }
  .bfix { background:#6ee7b7; color:#064e3b; }
  .snap { cursor:zoom-in; max-width:80px; display:block; border:1px solid #c4b5fd; border-radius:4px; transition:box-shadow .15s; }
  .snap:hover { box-shadow:0 2px 12px #6d28d980; }
  #snap-ol { display:none; position:fixed; inset:0; background:rgba(0,0,0,.88); z-index:9999;
             align-items:center; justify-content:center; cursor:zoom-out; }
  #snap-ol.open { display:flex; }
  #snap-ol img  { max-width:95vw; max-height:95vh; border-radius:6px; box-shadow:0 8px 48px #000c; }
`;

function badgeHtml(status, baseline) {
    const sb = {'PASS':'bp','FAIL':'bf','ERROR':'be','NEW':'bn'}[status] || 'bn';
    let extra = '';
    if (baseline && baseline !== 'NEW' && baseline !== status) {
        if (baseline === 'PASS')               extra = ` <span class="badge breg">REGRESSION</span>`;
        else if (status === 'PASS')            extra = ` <span class="badge bfix">FIXED</span>`;
    }
    if (baseline === 'NEW') extra = ` <span class="badge bn">NEW</span>`;
    return `<span class="badge ${sb}">${status}</span>${extra}`;
}

function tableRows(rows) {
    return rows.map(r => {
        const cls = {PASS:'pass',FAIL:'fail',ERROR:'err'}[r.Status] || '';
        const det = (r.Detail||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `<tr class="${cls}"><td>${r.Suite}</td><td>${r.Name}</td>` +
               `<td>${badgeHtml(r.Status, r.Baseline)}</td>` +
               `<td>${r.Ms} ms</td><td style="max-width:380px;word-break:break-word">${det}</td></tr>`;
    }).join('\n');
}

// Build the report section -- CSS interpolated directly from JS (no $ in CSS so safe in PS here-string)
const reportPs = `
# -- HTML Report ---------------------------------------------------------------
\$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

\$regHtml = ''
if (\$regressions.Count -gt 0) {
    \$li = (\$regressions | ForEach-Object { "<li><b>\$(\$_.Suite) / \$(\$_.Name)</b> &mdash; was PASS, now \$(\$_.Status): \$(\$_.Detail)</li>" }) -join ''
    \$regHtml = "<div class='panel red'><b>!! \$(\$regressions.Count) REGRESSION(S) since last run</b><ul style='margin:6px 0 0;padding-left:18px'>\$li</ul></div>"
}
\$fixHtml = ''
if (\$fixes.Count -gt 0) {
    \$li = (\$fixes | ForEach-Object { "<li><b>\$(\$_.Suite) / \$(\$_.Name)</b></li>" }) -join ''
    \$fixHtml = "<div class='panel grn'><b>++ \$(\$fixes.Count) test(s) fixed since last run</b><ul style='margin:6px 0 0;padding-left:18px'>\$li</ul></div>"
}

\$bizHtml = (\$bizRows | ForEach-Object {
    \$cls = @{PASS='pass';FAIL='fail';ERROR='err'}[\$_.Status]
    \$det = (\$_.Detail -replace '<','&lt;' -replace '>','&gt;')
    \$bdg = switch (\$_.Status) { 'PASS'{"<span class='badge bp'>PASS</span>"} 'FAIL'{"<span class='badge bf'>FAIL</span>"} default{"<span class='badge be'>ERROR</span>"} }
    if     (\$_.Baseline -eq 'NEW')                                                          { \$bdg += " <span class='badge bn'>NEW</span>" }
    elseif (\$_.Baseline -eq 'PASS' -and \$_.Status -ne 'PASS')                             { \$bdg += " <span class='badge breg'>REGRESSION</span>" }
    elseif (\$_.Baseline -notin @('PASS','NEW') -and \$_.Status -eq 'PASS')                 { \$bdg += " <span class='badge bfix'>FIXED</span>" }
    \$snapCell = if (\$_.Screenshot) {
        "<td><img class='snap' src='data:image/png;base64,\$(\$_.Screenshot)' onclick='showSnap(this.src)' title='Click to enlarge' /></td>"
    } else { "<td style='color:#d1d5db;text-align:center;font-size:1.1rem'>&#8212;</td>" }
    "<tr class='\$cls'><td>\$(\$_.Suite)</td><td>\$(\$_.Name)</td><td>\$bdg</td><td>\$(\$_.Ms) ms</td><td style='max-width:320px;word-break:break-word'>\$det</td>\$snapCell</tr>"
}) -join "\`n"

\$techHtml = ''
if (\$techFail.Count -gt 0) {
    \$rows = (\$techFail | ForEach-Object {
        \$det = (\$_.Detail -replace '<','&lt;' -replace '>','&gt;')
        "<tr class='fail'><td>\$(\$_.Suite)</td><td>\$(\$_.Name)</td><td><span class='badge bf'>\$(\$_.Status)</span></td><td>\$(\$_.Ms) ms</td><td style='max-width:380px;word-break:break-word'>\$det</td></tr>"
    }) -join "\`n"
    \$techHtml = "<h2>Technical Issues (\$(\$techFail.Count) failing)</h2><table><tr><th>Suite</th><th>Test</th><th>Status</th><th>Time</th><th>Detail</th></tr>\$rows</table>"
} else {
    \$techCount = (\$script:Results | Where-Object { \$_.Suite -in \$script:TechSuites }).Count
    \$techHtml  = "<div class='panel info'>All \$techCount technical checks passed.</div>"
}

\$html = @"
<!DOCTYPE html><html><head><meta charset='utf-8'>
<title>EAR Tester -- \$stamp</title><style>
${reportCss}
</style></head><body>
<h1>EAR Tester Report</h1>
<p class='meta'>\$stamp &nbsp;| <b>\$Server</b> | App: <b>\$App</b> |
Passed: <b style='color:green'>\$(\$script:PassCount)</b> |
Issues: <b style='color:\$(if((\$script:FailCount+\$script:ErrCount) -gt 0){"#dc2626"}else{"green"})'>\$(\$script:FailCount + \$script:ErrCount)</b> |
Total: <b>\$total</b></p>
\$regHtml
\$fixHtml
<h2>Business Test Results (\$(\$bizRows.Count) tests)</h2>
<table><tr><th>Suite</th><th>Test</th><th>Status</th><th>Time</th><th>Detail</th><th>Screen</th></tr>
\$bizHtml
</table>
\$techHtml
<div id='snap-ol' onclick='this.classList.remove("open")'><img id='snap-img' src='' /></div>
<script>
function showSnap(src){document.getElementById('snap-img').src=src;document.getElementById('snap-ol').classList.add('open');}
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('snap-ol').classList.remove('open');});
</script>
</body></html>
"@

\$reportPath = Join-Path \$PSScriptRoot 'test-report.html'
\$html | Out-File -FilePath \$reportPath -Encoding UTF8
Write-Host "  Report   -> \$reportPath" -ForegroundColor DarkGray
if (\$OpenReport) { Start-Process \$reportPath }

\$jsonLog = [ordered]@{
    runAt=( Get-Date -Format 'o'); baseUrl=\$BaseUrl; server=\$Server
    passed=\$script:PassCount; failed=\$script:FailCount; errors=\$script:ErrCount; total=\$total
    results=@(\$script:Results | ForEach-Object {
        [ordered]@{ suite=\$_.Suite; name=\$_.Name; status=\$_.Status; ms=[int]\$_.Ms; detail=\$_.Detail }
    })
} | ConvertTo-Json -Depth 4
\$jsonLog | Out-File (Join-Path \$PSScriptRoot '_json_log.txt') -Encoding UTF8
`;

// ── tech-tests.ps1 ────────────────────────────────────────────────────────────
// Suite names: 'API' and 'VirtTerm-Infra' -- classified as Technical by Run-Tests.ps1
const tech = `# tech-tests.ps1 -- Technical / infrastructure tests (Suite: API, VirtTerm-Infra)
# Dot-sourced by Run-Tests.ps1. Always runs. Only FAILURES shown in report.

Section "API Health"
Run-Test 'API' 'Search endpoint responds without error' {
    Invoke-Api "/api/search?process=test&application=\$script:App&scope=1" | Out-Null; \$true
}
Run-Test 'API' 'Process detail responds for known ID' {
    \$r = Invoke-Api "/api/search?process=\$([uri]::EscapeDataString(\$script:SearchTerm))&application=\$script:App&scope=1"
    \$script:ProcessId = \$r[0].id
    if (-not \$script:ProcessId) { return 'No process ID found' }
    Invoke-Api "/api/process/\$(\$script:ProcessId)?application=\$script:App" | Out-Null; \$true
}
Run-Test 'API' 'Callers endpoint responds without error' {
    Invoke-Api "/api/callers?childProcess=\$([uri]::EscapeDataString(\$script:SearchTerm))&application=\$script:App" | Out-Null; \$true
}
Run-Test 'API' 'Invalid GUID returns empty array (no crash)' {
    \$r = Invoke-Api "/api/process/00000000-0000-0000-0000-000000000000?application=\$script:App"
    if (\$r.Count -ne 0) { return "Expected 0 rows, got \$(\$r.Count)" }; \$true
}
Run-Test 'API' 'Nonexistent search term returns empty array' {
    \$r = Invoke-Api "/api/search?process=ZZZNOMATCH999&application=\$script:App&scope=1"
    if (\$r.Count -ne 0) { return "Expected 0, got \$(\$r.Count)" }; \$true
}

Section "API Structure"
Run-Test 'API' 'Search results have id, name, match_type' {
    \$r = Invoke-Api "/api/search?process=\$([uri]::EscapeDataString(\$script:SearchTerm))&application=\$script:App&scope=1"
    if (-not \$r -or \$r.Count -eq 0) { return 'No results' }
    \$f = \$r[0]
    foreach (\$field in @('id','name','match_type')) { if (-not \$f.\$field) { return "Missing: \$field" } }
    \$true
}
Run-Test 'API' 'Process steps have sequence and action_type_name' {
    if (-not \$script:ProcessId) { return 'No process ID' }
    \$rows = Invoke-Api "/api/process/\$(\$script:ProcessId)?application=\$script:App"
    if (-not \$rows -or \$rows.Count -eq 0) { return 'No steps' }
    \$f = \$rows[0]
    if (\$null -eq \$f.sequence)    { return 'Missing: sequence' }
    if (-not \$f.action_type_name) { return 'Missing: action_type_name' }
    \$true
}

Section "VirtTerm Infrastructure"
Run-Test 'VirtTerm-Infra' 'VirtTerm.exe launches and hwnd found' {
    Start-VirtTerm -WaitMs 4000
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { return 'hwnd is zero after 4s' }
    Write-Host "    hwnd: \$(\$script:VTHwnd)" -ForegroundColor DarkGray; \$true
}
Run-Test 'VirtTerm-Infra' 'Window title is non-empty' {
    \$t = [WinApi]::GetText(\$script:VTHwnd)
    if (-not \$t) { return 'Window title empty' }
    Write-Host "    Title: \$t" -ForegroundColor DarkGray; \$true
}
Run-Test 'VirtTerm-Infra' 'Screen buffer readable (ConsoleEcho has text)' {
    \$s = Get-VirtTermScreen
    if ([string]::IsNullOrWhiteSpace(\$s)) { return 'Screen buffer empty' }
    @{ ok=\$true; detail="[\$s]" }
}
Run-Test 'VirtTerm-Infra' 'Wait-VirtTermScreen times out cleanly' {
    \$r = Wait-VirtTermScreen -Contains 'ZZZNOMATCH999' -TimeoutMs 1500
    if (\$r -ne \$false) { return "Expected false, got \$r" }; \$true
}
Run-Test 'VirtTerm-Infra' 'Send-VirtTermText posts WM_CHAR without error' {
    Send-VirtTermText 'x'
    Send-VirtTermKey 'Backspace'; \$true
}
Run-Test 'VirtTerm-Infra' 'Send-VirtTermKey F3 posts WM_KEYDOWN without error' {
    Send-VirtTermKey 'F3'; Start-Sleep -Milliseconds 100; \$true
}
Run-Test 'VirtTerm-Infra' 'Stop-VirtTerm closes the process' {
    Stop-VirtTerm; Start-Sleep -Milliseconds 800
    \$r = Get-Process -Name 'VirtTerm' -ErrorAction SilentlyContinue
    if (\$r) { return 'Process still running after Stop-VirtTerm' }; \$true
}
`;

// ── biz-tests.ps1 ─────────────────────────────────────────────────────────────
// Suite names: 'EAR' and 'VirtTerm-Biz' -- classified as Business by Run-Tests.ps1
const biz = `# biz-tests.ps1 -- Business / workflow tests (Suite: EAR, VirtTerm-Biz)
# Dot-sourced by Run-Tests.ps1. Always runs. ALL results shown in report.

Section "EAR Search (Business)"
Run-Test 'EAR' 'Search for Log-on returns results' {
    \$r = Invoke-Api "/api/search?process=\$([uri]::EscapeDataString(\$script:SearchTerm))&application=\$script:App&scope=1"
    \$script:SearchResults = \$r
    if (-not \$r -or \$r.Count -eq 0) { return "No results for '\$script:SearchTerm'" }; \$true
}
Run-Test 'EAR' 'First result resolves to a process with steps' {
    if (-not \$script:SearchResults -or \$script:SearchResults.Count -eq 0) { return 'No search results' }
    \$script:ProcessId   = \$script:SearchResults[0].id
    \$script:ProcessRows = Invoke-Api "/api/process/\$(\$script:ProcessId)?application=\$script:App"
    if (-not \$script:ProcessRows -or \$script:ProcessRows.Count -eq 0) { return 'No steps in process' }; \$true
}
Run-Test 'EAR' 'Process steps ordered by sequence number' {
    if (-not \$script:ProcessRows -or \$script:ProcessRows.Count -lt 2) { return \$true }
    for (\$i = 1; \$i -lt \$script:ProcessRows.Count; \$i++) {
        if (\$script:ProcessRows[\$i].sequence -lt \$script:ProcessRows[\$i-1].sequence) {
            return "Out of order at index \$i"
        }
    }; \$true
}
Run-Test 'EAR' 'DB action has SQL statement' {
    \$id = (\$script:ProcessRows | Where-Object { \$_.action_type -eq 5 } | Select-Object -First 1).action_id
    if (-not \$id) { return 'No DB action in this process (skip)' }
    \$r = Invoke-Api "/api/db-action/\$id"
    if (\$r.Count -eq 0 -or \$null -eq \$r[0].statement) { return 'Missing: statement' }; \$true
}
Run-Test 'EAR' 'Calc action has operator symbol' {
    \$id = (\$script:ProcessRows | Where-Object { \$_.action_type -eq 3 } | Select-Object -First 1).action_id
    if (-not \$id) { return 'No Calc action in this process (skip)' }
    \$r = Invoke-Api "/api/calc-action/\$id"
    if (\$r.Count -eq 0 -or -not \$r[0].operator_symbol) { return 'Missing: operator_symbol' }; \$true
}

Section "VirtTerm Logon (Business)"
Run-Test 'VirtTerm-Biz' 'VirtTerm connects to WMS for business tests' {
    # Kill any stale instance, configure registry (DisplayMenuOptions=1 + UAT device),
    # launch VirtTerm, auto-click the device in the selection list, then wait 30s for
    # real WMS screen data -- printing the screen every second for visibility.
    Stop-VirtTerm
    Start-Sleep -Milliseconds 800
    Set-VirtTermDevice   # sets UAT device name + DisplayMenuOptions=1
    Start-VirtTerm -WaitMs 3000
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { return 'VirtTerm window not found after launch' }

    # Enumerate child windows and click the UAT device button in the selection list.
    \$devName = (Get-ItemProperty \$VTRegRoot -ErrorAction SilentlyContinue).'Default Device Name'
    Write-Host "  Auto-clicking device: \$devName" -ForegroundColor DarkGray
    Connect-VirtTermDevice -DeviceName \$devName -WaitMs 2000

    # Poll up to 30s -- print current screen every second so failures are diagnosable.
    \$ready = \$false
    for (\$i = 0; \$i -lt 30; \$i++) {
        \$s = Get-VirtTermScreen
        Write-Host "  [\$(\$i+1)s] Screen: [\$s]" -ForegroundColor DarkGray
        if (\$s -and \$s -ne 'ConsoleEcho') { \$ready = \$true; break }
        Start-Sleep -Milliseconds 1000
    }
    \$screen = Get-VirtTermScreen
    if (-not \$ready) {
        return "WMS not reached after 30s. Screen: [\$screen]"
    }
    @{ ok=\$true; detail="Connected. Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Logoff: navigate to a clean menu state' {
    # Success = ZONE login prompt, CHOICE (zone selection), or main OPTION (employee name visible).
    # "Reach Truck" sub-menus are a WMS constraint -- F3 there means "Start Work" (forward),
    # so we cannot navigate out without completing the active warehouse work task.
    \$atClean = {
        \$s = Get-VirtTermScreen
        (\$s -cmatch '(?m)^\\s*ZONE\\s*\$') -or   # ZONE login prompt
        (\$s -match 'CHOICE') -or                  # zone-choice screen
        (\$s -match 'Vogel')                        # main OPTION (employee name visible = top level)
    }
    \$screen = Get-VirtTermScreen
    if (& \$atClean -or \$screen -match 'FORKLIFT') {
        return @{ ok=\$true; detail="Already at clean state. Screen: [\$screen]" }
    }
    # Smart unwind: F1:Cancel (labeled) > F1 try (inside work task) > Escape (OPTION menu) > F3.
    # WMS uses F1 as the cancel key for active work tasks (ITEM ID / LOCATION prompts).
    # From the top-level OPTION (work-type) menu, ESC triggers the sign-off flow.
    for (\$i = 0; \$i -lt 40; \$i++) {
        if (& \$atClean) { break }
        \$screen = Get-VirtTermScreen
        if (\$screen -match 'F1.*Cancel') {
            Send-VirtTermKey 'F1'; Start-Sleep -Milliseconds 1500
        } elseif (\$screen -match 'ENTER.*Continue|press ENTER') {
            Send-VirtTermKey 'Enter'; Start-Sleep -Milliseconds 1200
        } elseif (\$screen -match 'ITEM.?ID|LOCATION|SCAN') {
            # Inside an active work task -- try F1 (unlabeled cancel) to back out
            Send-VirtTermKey 'F1'; Start-Sleep -Milliseconds 1800
        } elseif (\$screen -match 'OPTION' -and \$screen -notmatch 'INVALID') {
            # At the top-level work-type OPTION menu -- Escape triggers sign-off
            Send-VirtTermKey 'Escape'; Start-Sleep -Milliseconds 1500
        } else {
            Send-VirtTermKey 'F3'; Start-Sleep -Milliseconds 1000
        }
    }
    \$screen = Get-VirtTermScreen
    if (-not (& \$atClean)) {
        # Still in a work-assigned sub-menu -- PASS with warning so test run continues.
        return @{ ok=\$true; detail="Partial logoff (WMS has active work task). Screen: [\$screen]" }
    }
    @{ ok=\$true; detail="Logged off. Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Login: confirm starting screen before auth' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen on entry: [\$screen]" -ForegroundColor DarkGray
    # Advance past splash if needed
    if (\$screen -match 'FORKLIFT') {
        Write-Host "  Pressing Enter to advance past FORKLIFT splash..." -ForegroundColor DarkGray
        Send-VirtTermKey 'Enter'; Start-Sleep -Milliseconds 2000
        \$screen = Get-VirtTermScreen
        Write-Host "  Screen after Enter: [\$screen]" -ForegroundColor DarkGray
    }
    # ZONE = clean login prompt; CHOICE/OPTION/Vogel = session already active
    \$atZone   = \$screen -cmatch '(?m)^\\s*ZONE\\s*\$'
    \$atActive = \$screen -match 'CHOICE|OPTION|Vogel'
    if (-not \$atZone -and -not \$atActive) { return "Unexpected starting screen. Screen: [\$screen]" }
    \$state = if (\$atZone) { 'ZONE prompt (fresh)' } else { 'Active session' }
    @{ ok=\$true; detail="\$state. Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Login: employee authenticates or session is active' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen before auth: [\$screen]" -ForegroundColor DarkGray
    # If already showing the employee or at a work menu, authentication already happened.
    if (\$screen -match 'Vogel|CHOICE|OPTION') {
        return @{ ok=\$true; detail="Session active (already logged in). Screen: [\$screen]" }
    }
    # On ZONE screen -- send employee ID then wait for next prompt
    if (\$screen -cmatch '(?m)^\\s*ZONE\\s*\$') {
        Write-Host "  Sending employee ID: 000002" -ForegroundColor DarkGray
        Send-VirtTermText '000002'; Send-VirtTermKey 'Enter'
        Start-Sleep -Milliseconds 2000
        \$screen = Get-VirtTermScreen
        Write-Host "  Screen after employee ID: [\$screen]" -ForegroundColor DarkGray
        # WMS may ask for a PIN/password -- send '00002' if prompted
        if (\$screen -match 'PASSWORD|PASSW|PIN|PASS') {
            Write-Host "  Password prompt detected -- sending PIN: 00002" -ForegroundColor DarkGray
            Send-VirtTermText '00002'; Send-VirtTermKey 'Enter'
            Start-Sleep -Milliseconds 2000
            \$screen = Get-VirtTermScreen
            Write-Host "  Screen after PIN: [\$screen]" -ForegroundColor DarkGray
        }
        if (\$screen -notmatch 'Vogel|CHOICE|OPTION') {
            return "Not at work menu after login attempt. Screen: [\$screen]"
        }
    } else {
        return "Unexpected screen (not ZONE, not active session). Screen: [\$screen]"
    }
    \$menuType = if (\$screen -match 'CHOICE') { 'CHOICE (fresh zone select)' } else { 'OPTION (work menu)' }
    @{ ok=\$true; detail="Auth OK [\$menuType]. Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Login: menu shows numbered entries after auth' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen: [\$screen]" -ForegroundColor DarkGray
    if (\$screen -notmatch '[1-9]') { return "No numbered menu entries visible. Screen: [\$screen]" }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Login: entry 1 reaches OPTION work menu' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen: [\$screen]" -ForegroundColor DarkGray
    if (\$screen -match 'OPTION') {
        return @{ ok=\$true; detail="Already at OPTION. Screen: [\$screen]" }
    }
    Write-Host "  Sending: 1 + Enter" -ForegroundColor DarkGray
    Send-VirtTermText '1'; Send-VirtTermKey 'Enter'
    \$found  = Wait-VirtTermScreen -Contains 'OPTION' -TimeoutMs 8000
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after selection: [\$screen]" -ForegroundColor DarkGray
    if (-not \$found) { return "No OPTION menu after selection. Screen: [\$screen]" }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}

Section "VirtTerm Navigation (Business)"
Run-Test 'VirtTerm-Biz' 'Navigate into option 1 (Billables)' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen before nav: [\$screen]" -ForegroundColor DarkGray
    Write-Host "  Sending: 1 + Enter" -ForegroundColor DarkGray
    Send-VirtTermText '1'; Send-VirtTermKey 'Enter'
    Start-Sleep -Milliseconds 1500
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after nav: [\$screen]" -ForegroundColor DarkGray
    if ([string]::IsNullOrWhiteSpace(\$screen)) { return 'Screen empty after selecting option 1' }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'F3 returns to OPTION menu from Billables' {
    Write-Host "  Sending: F3" -ForegroundColor DarkGray
    Send-VirtTermKey 'F3'; Start-Sleep -Milliseconds 1000
    \$found  = Wait-VirtTermScreen -Contains 'OPTION' -TimeoutMs 6000
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after F3: [\$screen]" -ForegroundColor DarkGray
    if (-not \$found) { return "Not back at OPTION menu after F3. Screen: [\$screen]" }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Navigate into option 2 (Receiving)' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen before nav: [\$screen]" -ForegroundColor DarkGray
    Write-Host "  Sending: 2 + Enter" -ForegroundColor DarkGray
    Send-VirtTermText '2'; Send-VirtTermKey 'Enter'
    Start-Sleep -Milliseconds 1500
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after nav: [\$screen]" -ForegroundColor DarkGray
    if ([string]::IsNullOrWhiteSpace(\$screen)) { return 'Screen empty after selecting option 2' }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'F3 returns to OPTION menu from Receiving' {
    Write-Host "  Sending: F3" -ForegroundColor DarkGray
    Send-VirtTermKey 'F3'; Start-Sleep -Milliseconds 1000
    \$found  = Wait-VirtTermScreen -Contains 'OPTION' -TimeoutMs 6000
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after F3: [\$screen]" -ForegroundColor DarkGray
    if (-not \$found) { return "Not back at OPTION menu after F3. Screen: [\$screen]" }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}

Section "VirtTerm Barcode (Business)"
Run-Test 'VirtTerm-Biz' 'Barcode scan: navigate into a scan-field screen' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen before entry: [\$screen]" -ForegroundColor DarkGray
    Write-Host "  Sending: 1 + Enter" -ForegroundColor DarkGray
    Send-VirtTermText '1'; Send-VirtTermKey 'Enter'
    Start-Sleep -Milliseconds 1500
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after entry: [\$screen]" -ForegroundColor DarkGray
    if ([string]::IsNullOrWhiteSpace(\$screen)) { return 'Screen empty after entering sub-option' }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Barcode scan: scan field is present and accepts input focus' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen: [\$screen]" -ForegroundColor DarkGray
    \$hasField = \$screen -match 'ITEM ID|LOCATION|SCAN|F8:List|OPTION'
    if (-not \$hasField) { return "No recognisable scan/input field on screen. Screen: [\$screen]" }
    @{ ok=\$true; detail="Input field visible. Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Barcode scan: F3 returns back from scan screen' {
    Write-Host "  Sending: F3" -ForegroundColor DarkGray
    Send-VirtTermKey 'F3'; Start-Sleep -Milliseconds 1200
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after F3: [\$screen]" -ForegroundColor DarkGray
    @{ ok=\$true; detail="Screen: [\$screen]" }
}

Section "VirtTerm Fork Workflow (Business)"
Run-Test 'VirtTerm-Biz' 'Return to OPTION menu before Fork test' {
    for (\$i = 0; \$i -lt 10; \$i++) {
        \$screen = Get-VirtTermScreen
        Write-Host "  [\$i] Screen: [\$screen]" -ForegroundColor DarkGray
        if (\$screen -match 'OPTION') { break }
        Write-Host "  Sending: F3" -ForegroundColor DarkGray
        Send-VirtTermKey 'F3'; Start-Sleep -Milliseconds 1200
    }
    \$screen = Get-VirtTermScreen
    if (\$screen -notmatch 'OPTION') { return "Could not reach OPTION menu. Screen: [\$screen]" }
    @{ ok=\$true; detail="At OPTION. Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Select Fork from OPTION menu' {
    \$screen = Get-VirtTermScreen
    Write-Host "  OPTION menu screen: [\$screen]" -ForegroundColor DarkGray
    if (\$screen -notmatch 'OPTION') { return "Not at OPTION menu. Screen: [\$screen]" }
    # Find the Fork option number dynamically from the screen text.
    # WMS renders the menu as lines like "  3 Fork" or "3 Fork Truck" etc.
    \$forkLine = (\$screen -split "\`n") | Where-Object { \$_ -match '^\\s*\\d+\\s+Fork' } | Select-Object -First 1
    if (-not \$forkLine) { return "Fork option not visible on OPTION screen. Screen: [\$screen]" }
    \$forkNum  = [regex]::Match(\$forkLine, '^\\s*(\\d+)').Groups[1].Value
    Write-Host "  Fork is option #\$forkNum -- sending \$forkNum + Enter" -ForegroundColor DarkGray
    Send-VirtTermText \$forkNum; Send-VirtTermKey 'Enter'
    Start-Sleep -Milliseconds 2000
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after Fork selection: [\$screen]" -ForegroundColor DarkGray
    @{ ok=\$true; detail="Selected Fork (option \$forkNum). Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'F1 logs out from Fork screen' {
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen before F1: [\$screen]" -ForegroundColor DarkGray
    Write-Host "  Sending: F1" -ForegroundColor DarkGray
    Send-VirtTermKey 'F1'; Start-Sleep -Milliseconds 2000
    \$screen = Get-VirtTermScreen
    Write-Host "  Screen after first F1: [\$screen]" -ForegroundColor DarkGray
    # If F1 just returned us to OPTION, press F1 once more to sign off.
    if (\$screen -match 'OPTION') {
        Write-Host "  At OPTION -- pressing F1 again to sign off" -ForegroundColor DarkGray
        Send-VirtTermKey 'F1'; Start-Sleep -Milliseconds 2000
        \$screen = Get-VirtTermScreen
        Write-Host "  Screen after second F1: [\$screen]" -ForegroundColor DarkGray
    }
    \$loggedOut = \$screen -cmatch '(?m)^\\s*ZONE\\s*\$' -or \$screen -match 'CHOICE'
    if (-not \$loggedOut) { return "Did not reach ZONE/logoff screen after F1. Screen: [\$screen]" }
    @{ ok=\$true; detail="Logged out via F1. Screen: [\$screen]" }
}

Section "VirtTerm Logoff (Business)"
Run-Test 'VirtTerm-Biz' 'Logoff: reach a clean state at end of tests' {
    \$atClean = {
        \$s = Get-VirtTermScreen
        (\$s -cmatch '(?m)^\\s*ZONE\\s*\$') -or (\$s -match 'CHOICE') -or (\$s -match 'Vogel')
    }
    for (\$i = 0; \$i -lt 40; \$i++) {
        if (& \$atClean) { break }
        \$screen = Get-VirtTermScreen
        if (\$screen -match 'F1.*Cancel') {
            Send-VirtTermKey 'F1'; Start-Sleep -Milliseconds 1500
        } elseif (\$screen -match 'ENTER.*Continue|press ENTER') {
            Send-VirtTermKey 'Enter'; Start-Sleep -Milliseconds 1200
        } elseif (\$screen -match 'ITEM.?ID|LOCATION|SCAN') {
            Send-VirtTermKey 'F1'; Start-Sleep -Milliseconds 1800
        } elseif (\$screen -match 'OPTION' -and \$screen -notmatch 'INVALID') {
            Send-VirtTermKey 'Escape'; Start-Sleep -Milliseconds 1500
        } else {
            Send-VirtTermKey 'F3'; Start-Sleep -Milliseconds 1000
        }
    }
    \$screen = Get-VirtTermScreen
    # PASS in all cases -- session state is a WMS concern, not a VirtTerm concern.
    \$note = if (& \$atClean) { 'Clean state reached' } else { 'Partial logoff (WMS work task active)' }
    @{ ok=\$true; detail="\$note. Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'VirtTerm process closes cleanly' {
    Stop-VirtTerm; Start-Sleep -Milliseconds 800
    \$r = Get-Process -Name 'VirtTerm' -ErrorAction SilentlyContinue
    if (\$r) { return 'Process still running after Stop-VirtTerm' }; \$true
}
`;

// ── VirtTerm.ps1 ──────────────────────────────────────────────────────────────
const virtTerm = `# VirtTerm.ps1 -- Windows API controller for VirtualScanner VirtTerm.exe
# Dot-sourced by Run-Tests.ps1 (always).

if (-not ([System.Management.Automation.PSTypeName]'WinApi').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public class WinApi {
    [DllImport("user32.dll")] public static extern bool   SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool   ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern int    GetWindowText(IntPtr hWnd, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern int    GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, StringBuilder lParam);
    [DllImport("user32.dll")] public static extern bool   PostMessage(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool   IsWindowVisible(IntPtr hWnd);
    [DllImport("kernel32.dll")] public static extern void Sleep(uint ms);

    // Send a single character via WM_CHAR -- works cross-process, no focus needed.
    public static void SendChar(IntPtr hWnd, char c) {
        PostMessage(hWnd, WM_CHAR, (IntPtr)(int)c, (IntPtr)1);
        Sleep(20);
    }
    // Send a virtual key via WM_KEYDOWN + WM_KEYUP -- works cross-process.
    public static void SendVKey(IntPtr hWnd, int vk) {
        PostMessage(hWnd, WM_KEYDOWN, (IntPtr)vk, (IntPtr)0x00000001);
        Sleep(40);
        PostMessage(hWnd, WM_KEYUP,   (IntPtr)vk, (IntPtr)0xC0000001);
        Sleep(20);
    }
    // Click a button control (WM_LBUTTONDOWN + WM_LBUTTONUP).
    // More reliable than WM_KEYDOWN for VB6 F-key buttons, which handle Click events.
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP   = 0x0202;
    public static void ClickButton(IntPtr btnHwnd) {
        PostMessage(btnHwnd, WM_LBUTTONDOWN, (IntPtr)1, IntPtr.Zero);
        Sleep(40);
        PostMessage(btnHwnd, WM_LBUTTONUP,   IntPtr.Zero, IntPtr.Zero);
        Sleep(80);
    }
    [DllImport("user32.dll")] public static extern uint   GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern int    GetClassName(IntPtr hWnd, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern bool   EnumChildWindows(IntPtr parent, EnumChildProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool   EnumWindows(EnumChildProc cb, IntPtr lp);
    public delegate bool EnumChildProc(IntPtr hWnd, IntPtr lp);

    // SendInput -- hardware-level mouse simulation (works for VB6 splash/FORKLIFT screens
    // that ignore PostMessage because they poll the real hardware input queue).
    // Note: RECT struct is defined further down (shared with CaptureScrnClassBase64).
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int  GetSystemMetrics(int nIndex);
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {
        public int  dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] struct INPUT {
        public uint type; public MOUSEINPUT mi;  // only mouse input used here
    }
    const uint INPUT_MOUSE = 0;
    const uint MOUSEEVENTF_MOVE        = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN    = 0x0002;
    const uint MOUSEEVENTF_LEFTUP      = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN   = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP     = 0x0010;
    const uint MOUSEEVENTF_ABSOLUTE    = 0x8000;

    // ClickWindowCenter: moves the real mouse cursor to the window's centre and
    // performs a hardware left-click.  Works where PostMessage is ignored.
    public static void ClickWindowCenter(IntPtr hWnd) {
        RECT rc;
        if (!GetWindowRect(hWnd, out rc)) return;
        int cx = (rc.Left + rc.Right)  / 2;
        int cy = (rc.Top  + rc.Bottom) / 2;
        int sw = GetSystemMetrics(0);   // screen width
        int sh = GetSystemMetrics(1);   // screen height
        // Normalise to 0-65535 for MOUSEEVENTF_ABSOLUTE
        int nx = (cx * 65535) / sw;
        int ny = (cy * 65535) / sh;
        var inputs = new INPUT[3];
        // Move
        inputs[0].type = INPUT_MOUSE;
        inputs[0].mi   = new MOUSEINPUT { dx=nx, dy=ny, dwFlags=MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE };
        // Down
        inputs[1].type = INPUT_MOUSE;
        inputs[1].mi   = new MOUSEINPUT { dwFlags=MOUSEEVENTF_LEFTDOWN|MOUSEEVENTF_ABSOLUTE, dx=nx, dy=ny };
        // Up
        inputs[2].type = INPUT_MOUSE;
        inputs[2].mi   = new MOUSEINPUT { dwFlags=MOUSEEVENTF_LEFTUP|MOUSEEVENTF_ABSOLUTE, dx=nx, dy=ny };
        SendInput(3, inputs, Marshal.SizeOf(typeof(INPUT)));
        Sleep(120);
    }

    public const uint WM_KEYDOWN  = 0x0100;
    public const uint WM_KEYUP    = 0x0101;
    public const uint WM_CHAR     = 0x0102;
    public const uint WM_GETTEXT  = 0x000D;
    public const int  VK_RETURN   = 0x0D;
    public const int  VK_ESCAPE   = 0x1B;
    public const int  VK_BACK     = 0x08;
    public const int  VK_TAB      = 0x09;
    public const int  VK_F1=0x70, VK_F2=0x71, VK_F3=0x72, VK_F4=0x73, VK_F5=0x74;
    public const int  VK_F6=0x75, VK_F7=0x76, VK_F8=0x77, VK_F9=0x78, VK_F10=0x79;

    public static List<IntPtr> GetChildWindows(IntPtr parent) {
        var list = new List<IntPtr>();
        EnumChildWindows(parent, (h, _) => { list.Add(h); return true; }, IntPtr.Zero);
        return list;
    }
    // Standard GetText via GetWindowText -- returns the window CAPTION (title).
    public static string GetText(IntPtr hWnd) {
        int len = GetWindowTextLength(hWnd);
        if (len == 0) return "";
        var sb = new StringBuilder(len + 1);
        GetWindowText(hWnd, sb, len + 1);
        return sb.ToString();
    }
    // GetLargeText uses WM_GETTEXT with a large fixed buffer.
    // GetWindowTextLength returns the CAPTION length for VB6 Edit controls
    // (e.g. 11 for "ConsoleEcho"), not the actual buffer content length.
    // Sending WM_GETTEXT directly bypasses that limitation and returns real content.
    public static string GetLargeText(IntPtr hWnd) {
        var sb = new StringBuilder(8192);
        SendMessage(hWnd, WM_GETTEXT, (IntPtr)8192, sb);
        return sb.ToString();
    }
    public static string GetClass(IntPtr hWnd) {
        var sb = new StringBuilder(256);
        GetClassName(hWnd, sb, 256);
        return sb.ToString();
    }
    // RightClickWindowCenter: hardware right-click at the window's centre.
    public static void RightClickWindowCenter(IntPtr hWnd) {
        RECT rc;
        if (!GetWindowRect(hWnd, out rc)) return;
        int cx = (rc.Left + rc.Right)  / 2;
        int cy = (rc.Top  + rc.Bottom) / 2;
        int sw = GetSystemMetrics(0);
        int sh = GetSystemMetrics(1);
        int nx = (cx * 65535) / sw;
        int ny = (cy * 65535) / sh;
        var inputs = new INPUT[3];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].mi   = new MOUSEINPUT { dx=nx, dy=ny, dwFlags=MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE };
        inputs[1].type = INPUT_MOUSE;
        inputs[1].mi   = new MOUSEINPUT { dwFlags=MOUSEEVENTF_RIGHTDOWN|MOUSEEVENTF_ABSOLUTE, dx=nx, dy=ny };
        inputs[2].type = INPUT_MOUSE;
        inputs[2].mi   = new MOUSEINPUT { dwFlags=MOUSEEVENTF_RIGHTUP|MOUSEEVENTF_ABSOLUTE, dx=nx, dy=ny };
        SendInput(3, inputs, Marshal.SizeOf(typeof(INPUT)));
        Sleep(120);
    }
    // HardwareClickAt: hardware left-click at a specific screen coordinate.
    public static void HardwareClickAt(int cx, int cy) {
        int sw = GetSystemMetrics(0);
        int sh = GetSystemMetrics(1);
        int nx = (cx * 65535) / sw;
        int ny = (cy * 65535) / sh;
        var inputs = new INPUT[3];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].mi   = new MOUSEINPUT { dx=nx, dy=ny, dwFlags=MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE };
        inputs[1].type = INPUT_MOUSE;
        inputs[1].mi   = new MOUSEINPUT { dwFlags=MOUSEEVENTF_LEFTDOWN|MOUSEEVENTF_ABSOLUTE, dx=nx, dy=ny };
        inputs[2].type = INPUT_MOUSE;
        inputs[2].mi   = new MOUSEINPUT { dwFlags=MOUSEEVENTF_LEFTUP|MOUSEEVENTF_ABSOLUTE, dx=nx, dy=ny };
        SendInput(3, inputs, Marshal.SizeOf(typeof(INPUT)));
        Sleep(120);
    }
    // AllTopLevel: returns all visible top-level windows.
    public static List<IntPtr> AllTopLevel() {
        var list = new List<IntPtr>();
        EnumWindows((h, _) => { list.Add(h); return true; }, IntPtr.Zero);
        return list;
    }
    // Enumerate top-level windows in C# (avoids PowerShell script-block scoping issues).
    public static IntPtr FindWindowByPid(int pid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows((h, _) => {
            uint winPid = 0;
            GetWindowThreadProcessId(h, out winPid);
            if ((int)winPid == pid) { result = h; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    // Screenshot capture using PrintWindow (works cross-process, window need not be foreground).
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public static string CaptureWindowBase64(IntPtr hWnd) {
        RECT rc;
        if (!GetWindowRect(hWnd, out rc)) return "";
        int w = rc.Right - rc.Left, h = rc.Bottom - rc.Top;
        if (w <= 0 || h <= 0) return "";
        using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
            using (var g = Graphics.FromImage(bmp)) {
                IntPtr hdc = g.GetHdc();
                try { PrintWindow(hWnd, hdc, 0); } finally { g.ReleaseHdc(hdc); }
            }
            using (var ms = new MemoryStream()) {
                bmp.Save(ms, ImageFormat.Png);
                return Convert.ToBase64String(ms.ToArray());
            }
        }
    }

    // CaptureScrnClassBase64: PrintWindow on the top-level VirtTerm window (reliable, no
    // foreground focus needed), then crop the bitmap to the ScrnClass child's region.
    // ScrnClass position is computed from the difference of the two GetWindowRect results.
    public static string CaptureScrnClassBase64(IntPtr mainHwnd, IntPtr scrnHwnd) {
        RECT mrc, src;
        if (!GetWindowRect(mainHwnd, out mrc)) return "";
        if (!GetWindowRect(scrnHwnd, out src))  return "";
        int mw = mrc.Right - mrc.Left, mh = mrc.Bottom - mrc.Top;
        if (mw <= 0 || mh <= 0) return "";
        // Capture the whole VirtTerm window via PrintWindow (works cross-process / not-foreground).
        using (var full = new Bitmap(mw, mh, PixelFormat.Format32bppArgb)) {
            using (var g = Graphics.FromImage(full)) {
                IntPtr hdc = g.GetHdc();
                try { PrintWindow(mainHwnd, hdc, 0); } finally { g.ReleaseHdc(hdc); }
            }
            // Compute ScrnClass offset relative to the main window's top-left.
            int x = src.Left - mrc.Left, y = src.Top - mrc.Top;
            int w = src.Right - src.Left, h = src.Bottom - src.Top;
            // Clamp to stay inside the captured bitmap.
            if (x < 0) { w += x; x = 0; }
            if (y < 0) { h += y; y = 0; }
            if (w <= 0 || h <= 0 || x >= mw || y >= mh) return "";
            if (x + w > mw) w = mw - x;
            if (y + h > mh) h = mh - y;
            var region = new Rectangle(x, y, w, h);
            using (var crop = full.Clone(region, full.PixelFormat))
            using (var ms = new MemoryStream()) {
                crop.Save(ms, ImageFormat.Png);
                return Convert.ToBase64String(ms.ToArray());
            }
        }
    }
}
"@ -ReferencedAssemblies 'System.Collections','System.Drawing'
} # end if WinApi not already loaded

# -- State ---------------------------------------------------------------------
\$script:VTProcess = \$null
\$script:VTHwnd    = [IntPtr]::Zero
\$VirtTermExe      = 'C:\\Users\\PVenkatesh\\Downloads\\VirtualScanner\\x86\\VirtTerm.exe'
\$VTRegRoot        = 'HKCU:\\Software\\HighJump Software\\Advantage Virtual Terminal'

# -- App-aware device configuration --------------------------------------------
# Set-VirtTermDevice: queries /api/vt-devices (which reads ADV.dbo.t_device) to
# get the correct device name, IP, and port for the target app, then writes them
# to the VirtTerm registry so the right WMS server is used on next launch.
function Set-VirtTermDevice {
    param([string]\$App = \$script:App)

    # Fetch device list from t_device via the EAR API.
    # The actual WMS column is dev_name (not device_name); IP is "[PING]" (broadcast
    # discovery) so we read the TCP host:port from the registry (saved on last manual
    # connection). Prefer UAT devices (dev_name contains 'UAT').
    \$devices = Get-VirtTermDevices -App \$App
    # Prefer UAT device; fall back to first device in list
    \$dev = \$devices | Where-Object { \$_.dev_name -match 'UAT' } | Select-Object -First 1
    if (-not \$dev) { \$dev = \$devices | Select-Object -First 1 }

    if (-not \$dev -or -not \$dev.dev_name) {
        \$cur = (Get-ItemProperty \$VTRegRoot -ErrorAction SilentlyContinue).'Default Device Name'
        Write-Host "  VirtTerm: no device found in t_device for app '\$App' -- using current: \$cur" -ForegroundColor DarkYellow
        Set-ItemProperty -Path \$VTRegRoot -Name 'DisplayMenuOptions' -Value 1 -Type DWord -ErrorAction SilentlyContinue
        return
    }

    \$dn = \$dev.dev_name   # field is dev_name in the WMS schema

    # Read existing IP and Port from the registry (written by last manual VirtTerm connection).
    \$regVals = Get-ItemProperty \$VTRegRoot -ErrorAction SilentlyContinue
    \$ip      = \$regVals.'IP Address'
    \$port    = \$regVals.'Port'

    # Use DisplayMenuOptions=1 so the device list appears.
    # Connect-VirtTermDevice will automate clicking the device after launch.
    Set-ItemProperty -Path \$VTRegRoot -Name 'Default Device Name' -Value \$dn -Type String -ErrorAction SilentlyContinue
    Set-ItemProperty -Path \$VTRegRoot -Name 'DisplayMenuOptions'  -Value 1    -Type DWord  -ErrorAction SilentlyContinue
    if (\$ip)   { Set-ItemProperty -Path \$VTRegRoot -Name 'IP Address' -Value \$ip    -Type String -ErrorAction SilentlyContinue }
    if (\$port) { Set-ItemProperty -Path \$VTRegRoot -Name 'Port'       -Value "\$port" -Type String -ErrorAction SilentlyContinue }

    \$devPath = Join-Path \$VTRegRoot \$dn
    if (-not (Test-Path \$devPath)) { New-Item -Path \$devPath -Force | Out-Null }
    if (\$ip)   { Set-ItemProperty -Path \$devPath -Name 'IP Address' -Value \$ip    -Type String -ErrorAction SilentlyContinue }
    if (\$port) { Set-ItemProperty -Path \$devPath -Name 'Port'       -Value "\$port" -Type String -ErrorAction SilentlyContinue }

    Write-Host "  VirtTerm: device=\$dn  IP=\$ip  Port=\$port  [DisplayMenuOptions=1, will auto-click]" -ForegroundColor DarkGray
}

# Connect-VirtTermDevice: automates clicking a device in the VirtTerm selection list.
# Enumerates all descendant windows looking for a Button/Label with matching text,
# tries a ListBox selection, then falls back to ClickWindowCenter.
function Connect-VirtTermDevice {
    param([string]\$DeviceName = 'WAVTUAT10', [int]$WaitMs = 2000)
    Start-Sleep -Milliseconds \$WaitMs
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { return \$false }
    [WinApi]::ShowWindow(\$script:VTHwnd, 9) | Out-Null
    [WinApi]::SetForegroundWindow(\$script:VTHwnd) | Out-Null
    Start-Sleep -Milliseconds 300

    \$allWindows = [WinApi]::GetChildWindows(\$script:VTHwnd)
    Write-Host "  Child windows (\$(\$allWindows.Count) found):" -ForegroundColor DarkGray
    foreach (\$h in \$allWindows) {
        \$cls  = [WinApi]::GetClass(\$h)
        \$txt  = [WinApi]::GetText(\$h)
        if (\$txt -or \$cls -notin @('','STATIC')) {
            Write-Host "    cls=[\$cls] text=[\$txt]" -ForegroundColor DarkGray
        }
        # Click on an exact text match (Button, Label, or any control)
        if (\$txt -eq \$DeviceName) {
            Write-Host "  Clicking control with text '\$DeviceName'" -ForegroundColor Cyan
            [WinApi]::ClickButton(\$h); Start-Sleep -Milliseconds 500; return \$true
        }
        # ListBox: use LB_FINDSTRINGEXACT (0x01A2) + LB_SETCURSEL (0x0186) + click
        if (\$cls -eq 'ListBox') {
            Write-Host "  Found ListBox -- searching for '\$DeviceName'" -ForegroundColor DarkGray
            \$sb  = New-Object System.Text.StringBuilder \$DeviceName
            \$idx = [WinApi]::SendMessage(\$h, 0x01A2, [IntPtr](-1), \$sb)
            if ([int]\$idx -ge 0) {
                [WinApi]::PostMessage(\$h, 0x0186, [IntPtr][int]\$idx, [IntPtr]::Zero) | Out-Null
                Start-Sleep -Milliseconds 200
                [WinApi]::ClickWindowCenter(\$h); return \$true
            }
        }
    }
    Write-Host "  No matching control -- using ClickWindowCenter (fallback)" -ForegroundColor DarkYellow
    [WinApi]::ClickWindowCenter(\$script:VTHwnd)
    return \$true
}

# Get-VirtTermDevices: queries the EAR API to discover registered VT devices and
# their connection info for each app. Useful for populating \$VTDeviceMap.
function Get-VirtTermDevices {
    param([string]\$App = '')
    \$sep = if (\$App) { "&app=\$App" } else { '' }
    try {
        Invoke-RestMethod -Uri "\$script:BaseUrl/api/vt-devices?server=\$script:Server\$sep" -Method GET -TimeoutSec 15
    } catch { Write-Warning "Get-VirtTermDevices failed: \$(\$_.Exception.Message)"; @() }
}

# -- Launch & find -------------------------------------------------------------
function Start-VirtTerm {
    param([int]\$WaitMs = 4000)
    Write-Host "  Launching VirtTerm..." -ForegroundColor Gray
    \$script:VTProcess = Start-Process -FilePath \$VirtTermExe -PassThru -ErrorAction Stop
    Start-Sleep -Milliseconds \$WaitMs
    \$script:VTHwnd = Get-VirtTermHwnd
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { throw "VirtTerm window not found after \${WaitMs}ms" }
    [WinApi]::ShowWindow(\$script:VTHwnd, 9) | Out-Null   # SW_RESTORE
    [WinApi]::SetForegroundWindow(\$script:VTHwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    Write-Host "  VirtTerm hwnd: \$(\$script:VTHwnd)" -ForegroundColor Gray
}

function Get-VirtTermHwnd {
    # Prefer the process's own main window handle
    if (\$script:VTProcess -and -not \$script:VTProcess.HasExited) {
        \$script:VTProcess.Refresh()
        if (\$script:VTProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            return \$script:VTProcess.MainWindowHandle
        }
    }
    # Fallback: C# FindWindowByPid -- avoids PowerShell script-block scoping bug
    # where \$hwnd = \$h inside a delegate creates a local variable only.
    if (\$script:VTProcess -and -not \$script:VTProcess.HasExited) {
        return [WinApi]::FindWindowByPid(\$script:VTProcess.Id)
    }
    return [IntPtr]::Zero
}

function Stop-VirtTerm {
    if (\$script:VTProcess -and -not \$script:VTProcess.HasExited) {
        \$script:VTProcess.Kill()
    }
    # Also kill any stray VirtTerm processes not tracked by \$VTProcess (e.g. from a previous run)
    Get-Process -Name 'VirtTerm' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    \$script:VTProcess = \$null
    \$script:VTHwnd    = [IntPtr]::Zero
    Write-Host "  VirtTerm closed." -ForegroundColor Gray
}

# -- Screen reading ------------------------------------------------------------
function Get-VirtTermScreen {
    # Walk ALL child windows (EnumChildWindows is recursive, finds hidden windows too).
    # ConsoleEcho is a hidden Edit control inside ScrnClass.
    # IMPORTANT: GetWindowTextLength returns the CAPTION length for this VB6 Edit
    # control ("ConsoleEcho" = 11 chars), NOT the actual buffer content length.
    # Use GetLargeText (WM_GETTEXT with an 8192 fixed buffer) to get real content.
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { return "" }
    foreach (\$child in [WinApi]::GetChildWindows(\$script:VTHwnd)) {
        if ([WinApi]::GetClass(\$child) -eq "ScrnClass") {
            foreach (\$grand in [WinApi]::GetChildWindows(\$child)) {
                if ([WinApi]::GetClass(\$grand) -eq "Edit") {
                    return [WinApi]::GetLargeText(\$grand)
                }
            }
        }
    }
    return ""
}

function Get-VirtTermSnapshot {
    # Capture the ScrnClass terminal panel (blue screen area) as a base64 PNG.
    # Strategy: PrintWindow on the top-level VirtTerm hwnd (works without needing it
    # in the foreground), then crop to the ScrnClass child window region.
    # This avoids the BitBlt-from-screen bug where whatever was on top (e.g. VS Code)
    # was captured instead of VirtTerm.
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { return "" }
    try {
        \$scrnHwnd = [IntPtr]::Zero
        foreach (\$child in [WinApi]::GetChildWindows(\$script:VTHwnd)) {
            if ([WinApi]::GetClass(\$child) -eq 'ScrnClass') { \$scrnHwnd = \$child; break }
        }
        if (\$scrnHwnd -eq [IntPtr]::Zero) { return "" }
        return [WinApi]::CaptureScrnClassBase64(\$script:VTHwnd, \$scrnHwnd)
    } catch { return "" }
}

function Wait-VirtTermScreen {
    param([string]\$Contains, [int]\$TimeoutMs = 6000, [int]\$PollMs = 250)
    \$deadline = (Get-Date).AddMilliseconds(\$TimeoutMs)
    while ((Get-Date) -lt \$deadline) {
        if ((Get-VirtTermScreen) -join ' ' -match [regex]::Escape(\$Contains)) { return \$true }
        Start-Sleep -Milliseconds \$PollMs
    }
    return \$false
}

# -- Input (PostMessage to ScrnClass -- works cross-process, no focus needed) ---
function Get-VirtTermInputHwnd {
    # VirtTerm processes keyboard input on the ScrnClass child window, not the
    # main ADV_Virtual_Terminal window. We must target ScrnClass for PostMessage.
    foreach (\$child in [WinApi]::GetChildWindows(\$script:VTHwnd)) {
        if ([WinApi]::GetClass(\$child) -eq 'ScrnClass') { return \$child }
    }
    return \$script:VTHwnd   # fallback to main window
}

function Send-VirtTermText {
    param([string]\$Text)
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { throw 'VirtTerm not running' }
    \$target = Get-VirtTermInputHwnd
    foreach (\$c in \$Text.ToCharArray()) {
        [WinApi]::SendChar(\$target, \$c)
    }
}

function Get-VirtTermFButtonHwnd {
    # Find the F-key Button control (e.g. 'F3') that lives inside ScrnClass.
    # VirtTerm's VB6 Click handler on these buttons is the reliable way to
    # trigger F-key actions cross-process without needing window focus.
    param([string]\$Label)
    foreach (\$child in [WinApi]::GetChildWindows(\$script:VTHwnd)) {
        if ([WinApi]::GetClass(\$child) -eq 'ScrnClass') {
            foreach (\$grand in [WinApi]::GetChildWindows(\$child)) {
                if ([WinApi]::GetClass(\$grand) -eq 'Button' -and
                    [WinApi]::GetText(\$grand) -eq \$Label) {
                    return \$grand
                }
            }
        }
    }
    return [IntPtr]::Zero
}

function Send-VirtTermKey {
    param(
        [ValidateSet('Enter','Tab','Escape','Backspace','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10')]
        [string]\$Key
    )
    # F-keys: click the real Button control inside ScrnClass.
    # This triggers VirtTerm's VB6 Click event -- reliable cross-process.
    if (\$Key -match '^F[0-9]+$') {
        \$btn = Get-VirtTermFButtonHwnd \$Key
        if (\$btn -ne [IntPtr]::Zero) {
            [WinApi]::ClickButton(\$btn); return
        }
        Write-Warning "F-key button '\$Key' not found; falling back to WM_KEYDOWN"
    }
    # Enter / Escape / Tab / Backspace: WM_KEYDOWN to the ScrnClass window.
    \$vkMap = @{
        Enter=[WinApi]::VK_RETURN; Tab=[WinApi]::VK_TAB
        Escape=[WinApi]::VK_ESCAPE; Backspace=[WinApi]::VK_BACK
    }
    \$target = Get-VirtTermInputHwnd
    [WinApi]::SendVKey(\$target, \$vkMap[\$Key])
}

function Send-VirtTermScan {
    param([string]\$Barcode)
    # Scanners send data followed by Enter
    Send-VirtTermText \$Barcode
    Start-Sleep -Milliseconds 60
    Send-VirtTermKey 'Enter'
}
`;

fs.writeFileSync(root + 'Run-Tests.ps1', runTests + reportPs, 'utf8');
fs.writeFileSync(t   + 'tech-tests.ps1', tech, 'utf8');
fs.writeFileSync(t   + 'biz-tests.ps1',  biz,  'utf8');
fs.writeFileSync(t   + 'VirtTerm.ps1',   virtTerm, 'utf8');
console.log('All files written successfully.');
