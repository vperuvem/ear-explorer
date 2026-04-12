# =============================================================================
# EAR Explorer - Auto Startup via Windows Task Scheduler
# =============================================================================
#
# HOW TO SET UP AUTO STARTUP (one time only):
#   1. Open PowerShell (no admin required)
#   2. Run:  powershell -ExecutionPolicy Bypass -File register-task.ps1
#   3. Done - EAR Explorer will start automatically every time you log in
#
# HOW TO START MANUALLY:
#   npm start       (from the ear-explorer folder)
#   App runs at:    http://localhost:9000
#
# HOW TO REMOVE AUTO STARTUP:
#   Unregister-ScheduledTask -TaskName 'EAR Explorer' -Confirm:$false
#
# HOW TO CHECK IF TASK IS REGISTERED:
#   schtasks /Query /TN "EAR Explorer" /FO LIST
# =============================================================================

$taskName   = 'EAR Explorer'
$nodeExe    = (Get-Command node -ErrorAction Stop).Source
$workingDir = 'C:\Users\PVenkatesh\Downloads\ear-explorer'
$scriptPath = Join-Path $workingDir 'server.js'

$action  = New-ScheduledTaskAction -Execute $nodeExe -Argument $scriptPath -WorkingDirectory $workingDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit 0 `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName  $taskName `
    -Action    $action `
    -Trigger   $trigger `
    -Settings  $settings `
    -RunLevel  Limited `
    -Force

Write-Host "Task '$taskName' registered. EAR Explorer will start automatically at logon." -ForegroundColor Green
Write-Host "To remove it later run: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor Yellow
