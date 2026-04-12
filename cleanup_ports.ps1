# Run as Administrator — removes stale HTTP.sys urlacl registrations
# and restores all dependent services that HTTP.sys may have affected.

$ports = @(3000, 4747, 5555, 6789, 7777, 8080, 8081, 8082, 9090)
$log   = @()

# Step 1: Delete stale urlacl entries
foreach ($p in $ports) {
    foreach ($prefix in @("http://+:$p/", "http://localhost:$p/", "http://*:$p/")) {
        $result = netsh http delete urlacl url=$prefix 2>&1
        if ($result -match 'successfully') { $log += "REMOVED urlacl: $prefix" }
    }
}

# Step 2: Restart HTTP.sys dependent services
$services = @('IISADMIN', 'W3SVC', 'WAS', 'wuauserv')
foreach ($svc in $services) {
    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($s -and $s.Status -ne 'Running') {
        Start-Service -Name $svc -ErrorAction SilentlyContinue
        $log += "Started service: $svc"
    } elseif ($s) {
        $log += "Already running: $svc"
    }
}

# Step 3: Verify
$remaining = netsh http show urlacl 2>&1
$hits = $remaining | Where-Object { $_ -match '3000|4747|5555|6789|7777|8080|8081|8082|9090' }
if ($hits) { $log += "STILL REGISTERED:"; $log += $hits }
else        { $log += "ALL CLEAR - no remaining urlacl entries for those ports." }

$log | Out-File 'C:\Users\PVenkatesh\Downloads\ear-explorer\port_cleanup_result.txt' -Encoding UTF8 -Force
Write-Host ($log -join "`n") -ForegroundColor Cyan
