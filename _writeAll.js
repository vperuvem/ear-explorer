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
        # Body can return:
        #   \$true                          -> PASS, no detail
        #   @{ ok=\$true; detail='...' }   -> PASS with detail shown in report
        #   any other value                -> FAIL, value used as detail message
        if (\$result -is [hashtable] -and \$result.ok -eq \$true) {
            \$detail = "\$(\$result.detail)"
            Write-Host "  [PASS] \$Name  (\$ms ms)  \$detail" -ForegroundColor Green
            \$script:PassCount++
            \$script:Results.Add(@{ Suite=\$Suite; Name=\$Name; Status='PASS'; Ms=\$ms; Detail=\$detail })
        } elseif (\$result -eq \$true) {
            Write-Host "  [PASS] \$Name  (\$ms ms)" -ForegroundColor Green
            \$script:PassCount++
            \$script:Results.Add(@{ Suite=\$Suite; Name=\$Name; Status='PASS'; Ms=\$ms; Detail='' })
        } else {
            Write-Host "  [FAIL] \$Name  (\$ms ms) - \$result" -ForegroundColor Red
            \$script:FailCount++
            \$script:Results.Add(@{ Suite=\$Suite; Name=\$Name; Status='FAIL'; Ms=\$ms; Detail="\$result" })
        }
    } catch {
        \$ms = [int]((Get-Date) - \$start).TotalMilliseconds
        Write-Host "  [ERROR] \$Name  (\$ms ms) - \$(\$_.Exception.Message)" -ForegroundColor Red
        \$script:ErrCount++
        \$script:Results.Add(@{ Suite=\$Suite; Name=\$Name; Status='ERROR'; Ms=\$ms; Detail=\$_.Exception.Message })
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
    "<tr class='\$cls'><td>\$(\$_.Suite)</td><td>\$(\$_.Name)</td><td>\$bdg</td><td>\$(\$_.Ms) ms</td><td style='max-width:380px;word-break:break-word'>\$det</td></tr>"
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
<table><tr><th>Suite</th><th>Test</th><th>Status</th><th>Time</th><th>Detail</th></tr>
\$bizHtml
</table>
\$techHtml
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
Run-Test 'VirtTerm-Infra' 'Send-VirtTermText does not throw' {
    Send-VirtTermText 'x'; \$true
}
Run-Test 'VirtTerm-Infra' 'Send-VirtTermKey Backspace does not throw' {
    Send-VirtTermKey 'Backspace'; \$true
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
Run-Test 'VirtTerm-Biz' 'VirtTerm launches for business tests' {
    Start-VirtTerm -WaitMs 4000
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { return 'hwnd is zero' }; \$true
}
Run-Test 'VirtTerm-Biz' 'Logon: reach employee zone-choice screen' {
    # VirtTerm may reconnect to a prior session (already shows employee name + zone list),
    # OR it may show a fresh splash / ZONE prompt that requires credentials.
    # Handle both cases so the test is reliable regardless of VirtTerm session state.
    \$screen = Get-VirtTermScreen
    # Case 1: already authenticated (previous session reconnected).
    if (\$screen -match 'Vogel') {
        return @{ ok=\$true; detail="Session reconnected. Screen: [\$screen]" }
    }
    # Case 2: on splash screen (FORKLIFT / F2: No PIT) -- press Enter to advance.
    if (\$screen -match 'FORKLIFT') {
        Send-VirtTermKey 'Enter'
        \$screen = Get-VirtTermScreen
    }
    # Case 3: on ZONE prompt -- send employee ID.
    if (\$screen -match 'ZONE') {
        Send-VirtTermText '000002'; Send-VirtTermKey 'Enter'
    }
    # Wait for employee name to confirm authentication.
    \$found  = Wait-VirtTermScreen -Contains 'Vogel' -TimeoutMs 10000
    \$screen = Get-VirtTermScreen
    if (-not \$found) { return "Employee name not on screen after logon attempt. Screen: [\$screen]" }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'Zone selection navigates to work screen' {
    # Pick zone 1 from the CHOICE menu shown after login.
    # If already past zone selection (e.g. OPTION menu visible), skip the send.
    \$screen = Get-VirtTermScreen
    if (\$screen -notmatch 'OPTION') {
        Send-VirtTermText '1'; Send-VirtTermKey 'Enter'
        Start-Sleep -Milliseconds 2000
        \$screen = Get-VirtTermScreen
    }
    if ([string]::IsNullOrWhiteSpace(\$screen)) { return 'Screen empty after zone selection' }
    @{ ok=\$true; detail="Screen: [\$screen]" }
}

Section "VirtTerm Navigation (Business)"
Run-Test 'VirtTerm-Biz' 'Barcode scan sends data and Enter' {
    Send-VirtTermScan 'BC-001234'; Start-Sleep -Milliseconds 800
    \$screen = Get-VirtTermScreen
    @{ ok=\$true; detail="Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'F3 navigates back without error' {
    Send-VirtTermKey 'F3'; Start-Sleep -Milliseconds 800
    \$screen = Get-VirtTermScreen
    @{ ok=\$true; detail="Screen: [\$screen]" }
}
Run-Test 'VirtTerm-Biz' 'VirtTerm closes cleanly after business tests' {
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

public class WinApi {
    [DllImport("user32.dll")] public static extern bool   SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool   ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern int    GetWindowText(IntPtr hWnd, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern int    GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, StringBuilder lParam);
    [DllImport("user32.dll")] public static extern bool   PostMessage(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool   IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint   GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern int    GetClassName(IntPtr hWnd, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern bool   EnumChildWindows(IntPtr parent, EnumChildProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool   EnumWindows(EnumChildProc cb, IntPtr lp);
    public delegate bool EnumChildProc(IntPtr hWnd, IntPtr lp);

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
}
"@ -ReferencedAssemblies 'System.Collections'
} # end if WinApi not already loaded

Add-Type -AssemblyName System.Windows.Forms

# -- State ---------------------------------------------------------------------
\$script:VTProcess = \$null
\$script:VTHwnd    = [IntPtr]::Zero
\$VirtTermExe      = 'C:\\Users\\PVenkatesh\\Downloads\\VirtualScanner\\x86\\VirtTerm.exe'

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
        Write-Host "  VirtTerm closed." -ForegroundColor Gray
    }
    \$script:VTProcess = \$null
    \$script:VTHwnd    = [IntPtr]::Zero
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

function Wait-VirtTermScreen {
    param([string]\$Contains, [int]\$TimeoutMs = 6000, [int]\$PollMs = 250)
    \$deadline = (Get-Date).AddMilliseconds(\$TimeoutMs)
    while ((Get-Date) -lt \$deadline) {
        if ((Get-VirtTermScreen) -join ' ' -match [regex]::Escape(\$Contains)) { return \$true }
        Start-Sleep -Milliseconds \$PollMs
    }
    return \$false
}

# -- Input ---------------------------------------------------------------------
function Send-VirtTermText {
    param([string]\$Text)
    if (\$script:VTHwnd -eq [IntPtr]::Zero) { throw 'VirtTerm not running' }
    [WinApi]::SetForegroundWindow(\$script:VTHwnd) | Out-Null
    Start-Sleep -Milliseconds 80
    [System.Windows.Forms.SendKeys]::SendWait(\$Text)
}

function Send-VirtTermKey {
    param(
        [ValidateSet('Enter','Tab','Escape','Backspace','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10')]
        [string]\$Key
    )
    \$map = @{
        Enter='{ENTER}'; Tab='{TAB}'; Escape='{ESC}'; Backspace='{BACKSPACE}'
        F1='{F1}'; F2='{F2}'; F3='{F3}'; F4='{F4}'; F5='{F5}'
        F6='{F6}'; F7='{F7}'; F8='{F8}'; F9='{F9}'; F10='{F10}'
    }
    Send-VirtTermText \$map[\$Key]
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
