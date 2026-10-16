# One-time setup. Run from the aifexis folder:  powershell -ExecutionPolicy Bypass -File scripts\windows\install-bridge-task.ps1
# Asks for the keys with hidden typing, stores them ENCRYPTED for your Windows account only (nobody else, and no other PC, can read them),
# and creates a scheduled job that brings approved awards back into ERPNext as draft Purchase Orders every 5 minutes.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dir = Join-Path $env:LOCALAPPDATA "AifexisBridge"; New-Item -ItemType Directory -Force $dir | Out-Null
$erp = Read-Host "ERPNext address [http://127.0.0.1:18080]"; if (-not $erp) { $erp = "http://127.0.0.1:18080" }
$site = Read-Host "Aifexis address [https://aifexis-sourcing.vercel.app]"; if (-not $site) { $site = "https://aifexis-sourcing.vercel.app" }
$cur = Read-Host "Currency [AED]"; if (-not $cur) { $cur = "AED" }
$k1 = Read-Host "ERPNext API key" -AsSecureString
$k2 = Read-Host "ERPNext API secret" -AsSecureString
$k3 = Read-Host "Aifexis integration key (aifx_...)" -AsSecureString
@{ erp = $erp; site = $site; cur = $cur; k1 = ($k1 | ConvertFrom-SecureString); k2 = ($k2 | ConvertFrom-SecureString); k3 = ($k3 | ConvertFrom-SecureString); repo = $repo } | ConvertTo-Json | Set-Content (Join-Path $dir "config.json") -Encoding UTF8
$run = Join-Path $PSScriptRoot "run-bridge.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$run`""
$t1 = New-ScheduledTaskTrigger -AtLogOn
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName "Aifexis ERPNext bridge" -Action $action -Trigger @($t1, $t2) -Settings $set -Description "Brings approved Aifexis awards into ERPNext as draft Purchase Orders." -Force | Out-Null
Write-Host "Done. The job runs every 5 minutes while you are signed in. Log: $dir\bridge.log"
Write-Host "Test it now:  Start-ScheduledTask 'Aifexis ERPNext bridge'; Start-Sleep 20; Get-Content '$dir\bridge.log' -Tail 20"
