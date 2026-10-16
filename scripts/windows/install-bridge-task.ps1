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
# schtasks needs no administrator rights (Register-ScheduledTask with a logon trigger does). Runs every 5 minutes while you are signed in.
schtasks /Create /SC MINUTE /MO 5 /TN "Aifexis ERPNext bridge" /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `\"$run`\"" /F
Write-Host "Done. The job runs every 5 minutes while you are signed in. Log: $dir\bridge.log"
Write-Host "Test it now:  schtasks /Run /TN 'Aifexis ERPNext bridge'; Start-Sleep 20; Get-Content '$dir\bridge.log' -Tail 20"
