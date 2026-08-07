$ErrorActionPreference = 'SilentlyContinue'
Get-NetTCPConnection -LocalPort 8005 | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force; Write-Host "killed $($_.OwningProcess)" } catch {} }
Start-Sleep 2
$env:PORT='8005'
$backend = 'D:/Server/Services/Daftar Upah Portal/portal-daftar-upah-services/backend'
Start-Process -FilePath 'bun' -ArgumentList 'run','start' -WorkingDirectory $backend -WindowStyle Hidden
for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep 5
    try { $r = Invoke-RestMethod http://localhost:8005/health -TimeoutSec 3; Write-Host "health ok $($r.status)"; break } catch { Write-Host "waiting ($i)..." }
}
Get-NetTCPConnection -LocalPort 8005 | Format-Table OwningProcess,State -AutoSize | Out-String | Write-Host
