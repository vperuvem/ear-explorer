$used = @(netstat -ano | Select-String ':\d+' | ForEach-Object {
    if ($_ -match ':(\d+)\s') { [int]$Matches[1] }
}) | Sort-Object -Unique

foreach ($p in 9100,9200,9300,9400,9500,9600,9700,9800,9900,9999) {
    if ($p -notin $used) { Write-Host "FREE: $p"; break }
}
