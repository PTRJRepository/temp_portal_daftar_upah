$ErrorActionPreference = 'SilentlyContinue'
Get-NetTCPConnection -LocalPort 8005 | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force; Write-Host "killed $($_.OwningProcess)" } catch {} }
Start-Sleep 2
Set-Location 'D:/Gawean Rebinmas/PORTAL_ESTATE/V 2 (begin versioning)/backend'
$env:PORT='8005'
Start-Process -FilePath 'bun' -ArgumentList 'run','start' -WindowStyle Hidden
Start-Sleep 8
try { $r = Invoke-RestMethod http://localhost:8005/health -TimeoutSec 5; Write-Host "health ok $($r.status)" } catch { Write-Host "health fail $($_.Exception.Message)" }
Get-NetTCPConnection -LocalPort 8005 | Format-Table OwningProcess,State -AutoSize | Out-String | Write-Host
