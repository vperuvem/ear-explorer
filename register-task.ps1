# =============================================================================
# EAR Explorer - Auto Startup via Windows Task Scheduler
# =============================================================================
#
# HOW TO SET UP AUTO STARTUP (one time only):
#   1. Open PowerShell (no admin required)
#   2. Run:  powershell -ExecutionPolicy Bypass -File register-task.ps1
#   3. Done - server starts at logon and restarts automatically if it ever stops
#
# HOW TO START MANUALLY:
#   node server.js     (from the ear-explorer folder)
#   App runs at:       http://localhost:9000  and  http://localhost:9001
#
# HOW TO REMOVE AUTO STARTUP:
#   Unregister-ScheduledTask -TaskName 'EAR Explorer' -Confirm:$false
#
# HOW TO CHECK TASK STATUS:
#   schtasks /Query /TN "EAR Explorer" /FO LIST
#
# HOW TO VIEW LOG:
#   Get-Content C:\Users\PVenkatesh\Downloads\ear-explorer\startup.log -Tail 40
# =============================================================================

$taskName   = 'EAR Explorer'
$nodeExe    = (Get-Command node -ErrorAction Stop).Source
$workingDir = 'C:\Users\PVenkatesh\Downloads\ear-explorer'
$scriptPath = Join-Path $workingDir 'server.js'
$logFile    = Join-Path $workingDir 'startup.log'

# The task runs an infinite restart loop inside PowerShell.
# If node exits for any reason (crash, OOM, etc.) it waits 5 seconds then relaunches.
# Each restart is timestamped in startup.log so you can see crash history.
$loopScript = @"
Set-Location '$workingDir'
while (`$true) {
    `$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content '$logFile' "`n[`$ts] Starting EAR Explorer (node server.js)..."
    # Start node as a child process so we can track its PID separately.
    # This means killing node.exe directly (e.g. to pick up a code change) does NOT
    # kill this wrapper loop -- the loop will restart node automatically within 5 seconds.
    `$proc = Start-Process -FilePath '$nodeExe' -ArgumentList '$scriptPath' ``
                -WorkingDirectory '$workingDir' -NoNewWindow -PassThru ``
                -RedirectStandardOutput '$logFile' -RedirectStandardError '$logFile'
    `$proc.WaitForExit()
    `$ts2 = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content '$logFile' "[`$ts2] node exited (code `$(`$proc.ExitCode)) -- restarting in 5 seconds..."
    Start-Sleep -Seconds 5
}
"@

$encodedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($loopScript))

$action = New-ScheduledTaskAction `
    -Execute  'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedScript" `
    -WorkingDirectory $workingDir

$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit 0 `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

# Remove existing task if present, then re-register
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName    $taskName `
    -Action      $action `
    -Trigger     $trigger `
    -Settings    $settings `
    -RunLevel    Limited `
    -Description 'Starts EAR Explorer Node.js server at logon; restarts automatically on crash' `
    -Force

Write-Host ""
Write-Host "Task '$taskName' registered." -ForegroundColor Green
Write-Host "  - Starts automatically at logon" -ForegroundColor Cyan
Write-Host "  - Restarts within 5 seconds if node crashes (infinite loop)" -ForegroundColor Cyan
Write-Host "  - Log file: $logFile" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting the server now..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $taskName
Write-Host "Done. Server running at http://localhost:9000" -ForegroundColor Green
Write-Host ""
Write-Host "To stop:   Stop-ScheduledTask -TaskName '$taskName'" -ForegroundColor DarkGray
Write-Host "To remove: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor DarkGray
