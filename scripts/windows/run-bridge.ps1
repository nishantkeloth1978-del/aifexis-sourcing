# Run by the scheduled job. Decrypts the keys (only possible for the same Windows account that saved them) and runs one pull.
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "AifexisBridge"; $log = Join-Path $dir "bridge.log"
if ((Test-Path $log) -and (Get-Item $log).Length -gt 500KB) { Move-Item $log "$log.old" -Force }
try {
  $c = Get-Content (Join-Path $dir "config.json") -Raw | ConvertFrom-Json
  $plain = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR(($s | ConvertTo-SecureString))) }
  $env:ERP_URL = $c.erp; $env:AIFEXIS_URL = $c.site; $env:CURRENCY = $c.cur
  $env:ERP_KEY = & $plain $c.k1; $env:ERP_SECRET = & $plain $c.k2; $env:AIFEXIS_KEY = & $plain $c.k3
  Set-Location $c.repo
  "[$(Get-Date -Format s)]" | Add-Content $log
  & npx.cmd tsx scripts/erpnext-bridge.ts pull 2>&1 | Add-Content $log
} catch { "[$(Get-Date -Format s)] stopped: $($_.Exception.Message)" | Add-Content $log }
finally { Remove-Item Env:ERP_KEY, Env:ERP_SECRET, Env:AIFEXIS_KEY -ErrorAction SilentlyContinue }
