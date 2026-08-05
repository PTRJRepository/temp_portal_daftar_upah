# versions.ps1 - hub versioning
# Dari folder versions/:
#   .\versions.ps1 list
#   .\versions.ps1 start -Version v1.5 [-Build] [-Background]
#   .\versions.ps1 stop  -Version v1.5
#   .\versions.ps1 build -Version v1.5
#   .\versions.ps1 new   -Version v2.0 [-Ref HEAD] [-Port 8006]
#
# Registry versi - tambah baris di bawah (atau pakai `new`).

param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet("list", "start", "stop", "build", "new")]
    [string]$Command,

    [string]$Version,
    [string]$Ref = "HEAD",
    [int]$Port = 0,
    [switch]$Build,
    [switch]$Background
)

$Versions = @{
    "v1.5" = @{ Port = 8005 }
    "v2.1" = @{ Port = 8007 }
}

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $Root   # = portal-daftar-upah-services
$logDir = Join-Path $Root "_logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-IsRunning([string]$port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$c
}

function Resolve-Version {
    if (-not $Version) { Write-Host "ERROR: -Version wajib." -ForegroundColor Red; exit 1 }
    if (-not $Versions.ContainsKey($Version)) {
        Write-Host "ERROR: versi '$Version' tidak ada di registry." -ForegroundColor Red
        Write-Host "Tersedia: $($Versions.Keys -join ', ')"
        exit 1
    }
    if (-not (Test-Path (Join-Path $Root $Version))) {
        Write-Host "ERROR: folder $Version belum dibuat. Pakai: .\versions.ps1 new -Version $Version" -ForegroundColor Red
        exit 1
    }
}

# ---------- LIST ----------
if ($Command -eq "list") {
    Write-Host ""
    Write-Host "Versi terdaftar:" -ForegroundColor Cyan
    foreach ($k in $Versions.Keys) {
        $port = $Versions[$k].Port
        $running = Get-IsRunning $port
        $status = if ($running) { "RUNNING  (port $port)" } else { "stopped  (port $port)" }
        $folder = if (Test-Path (Join-Path $Root $k)) { "" } else { " - FOLDER BELUM ADA" }
        $color = if ($running) { "Green" } else { "DarkGray" }
        Write-Host ("  {0,-8} {1}{2}" -f $k, $status, $folder) -ForegroundColor $color
    }
    exit 0
}

# ---------- NEW ----------
if ($Command -eq "new") {
    if (-not $Version) { Write-Host "ERROR: -Version wajib (misal v2.0)." -ForegroundColor Red; exit 1 }
    $Port = if ($Port -eq 0) { 8005 + $Versions.Count } else { $Port }
    if ($Versions.ContainsKey($Version)) {
        Write-Host "ERROR: versi '$Version' sudah ada di registry." -ForegroundColor Red; exit 1
    }
    $Vdir = Join-Path $Root $Version
    if (Test-Path $Vdir) { Write-Host "ERROR: folder $Vdir sudah ada." -ForegroundColor Red; exit 1 }

    Write-Host "[new] buat $Version dari WORKING TREE, port $Port..." -ForegroundColor Cyan
    if ($Ref -ne "HEAD") {
        Write-Host "  NOTE: -Ref no-op di new (salin working tree). Versi commit lama = checkout branch dulu." -ForegroundColor Yellow
    }

    # salin source bersih dari WORKING TREE (termasuk file untracked seperti ConvertPremiumTypeModal)
    New-Item -ItemType Directory -Force -Path (Join-Path $Vdir "backend") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Vdir "frontend") | Out-Null

    Copy-Item -Recurse -Force (Join-Path $repoRoot "backend\src") (Join-Path $Vdir "backend\src")
    Copy-Item -Recurse -Force (Join-Path $repoRoot "backend\data") (Join-Path $Vdir "backend\data")
    Copy-Item -Force (Join-Path $repoRoot "backend\package.json") (Join-Path $Vdir "backend\")
    Copy-Item -Force (Join-Path $repoRoot "backend\bun.lock") (Join-Path $Vdir "backend\")
    Copy-Item -Force (Join-Path $repoRoot "backend\tsconfig.json") (Join-Path $Vdir "backend\")

    Copy-Item -Recurse -Force (Join-Path $repoRoot "frontend\src") (Join-Path $Vdir "frontend\src")
    Copy-Item -Force (Join-Path $repoRoot "frontend\package.json") (Join-Path $Vdir "frontend\")
    Copy-Item -Force (Join-Path $repoRoot "frontend\vite.config.js") (Join-Path $Vdir "frontend\")
    Copy-Item -Force (Join-Path $repoRoot "frontend\index.html") (Join-Path $Vdir "frontend\")
    foreach ($extra in @("vite.config.test.js", "jsconfig.json")) {
        $p = Join-Path $repoRoot "frontend\$extra"
        if (Test-Path $p) { Copy-Item -Force $p (Join-Path $Vdir "frontend\") }
    }

    # strip test/log/tmp
    Get-ChildItem -Recurse -Force -Path $Vdir |
        Where-Object { -not $_.PSIsContainer -and $_.Name -match '\.(test|spec)\.' } |
        Remove-Item -Force
    Remove-Item -Recurse -Force (Join-Path $Vdir "backend\src\tests") -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force (Join-Path $Vdir "backend\src\logs") -ErrorAction SilentlyContinue
    Get-ChildItem -Recurse -Force -Path $Vdir -Filter "tsconfig.tsbuildinfo" | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Recurse -Force -Path $Vdir -Filter "_tmp*" | Remove-Item -Force -ErrorAction SilentlyContinue

    # .env - copy dari backend utama (identik, koneksi DB sama)
    Copy-Item (Join-Path $repoRoot "backend\.env") (Join-Path $Vdir "backend\.env") -Force

    # junction node_modules (shared - hemat disk)
    New-Item -ItemType Junction -Path (Join-Path $Vdir "backend\node_modules") -Target (Join-Path $repoRoot "backend\node_modules") -Force | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $Vdir "frontend\node_modules") -Target (Join-Path $repoRoot "frontend\node_modules") -Force | Out-Null

    # daftarkan di registry
    $Versions[$Version] = @{ Port = $Port }

    Write-Host ""
    Write-Host "[new] versi $Version dibuat + didaftarkan (port $Port)." -ForegroundColor Green
    Write-Host "Langkah berikut: .\versions.ps1 build -Version $Version  lalu  .\versions.ps1 start -Version $Version" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "CATATAN: registry Versions di versions.ps1 belum otomatis ketulis. Buka file, tambah baris:" -ForegroundColor Yellow
    Write-Host ('    "{0}" = @{{ Port = {1} }}' -f $Version, $Port) -ForegroundColor Yellow
    exit 0
}

# ---------- START / BUILD / STOP ----------
Resolve-Version
$Port = $Versions[$Version].Port
$backend = Join-Path $Root "$Version\backend"
$frontend = Join-Path $Root "$Version\frontend"

if ($Command -eq "build") {
    Write-Host "[$Version] build frontend..." -ForegroundColor Cyan
    Push-Location $frontend
    npm run build
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Write-Host "[$Version] BUILD GAGAL" -ForegroundColor Red; exit 1 }
    Write-Host "[$Version] build selesai." -ForegroundColor Green
    exit 0
}

if ($Command -eq "stop") {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $c) { Write-Host "[$Version] tidak berjalan di port $Port." -ForegroundColor DarkGray; exit 0 }
    Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "[$Version] dihentikan (port $Port)." -ForegroundColor Yellow
    exit 0
}

# start
if (Get-IsRunning $Port) {
    Write-Host "[$Version] sudah berjalan di port $Port. Ganti: .\versions.ps1 stop -Version $Version" -ForegroundColor Yellow
    exit 0
}

# build frontend kalau dist belum ada
$dist = Join-Path $frontend "dist"
if (-not (Test-Path $dist)) {
    Write-Host "[$Version] dist belum ada, build dulu..." -ForegroundColor Cyan
    Push-Location $frontend
    npm run build
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Write-Host "[$Version] BUILD GAGAL" -ForegroundColor Red; exit 1 }
}

Write-Host "[$Version] start backend port $Port..." -ForegroundColor Cyan
$env:PORT = "$Port"

if ($Background) {
    # resolve bun (shim .cmd dari npm global)
    $bunCmd = (Get-Command bun.cmd -ErrorAction SilentlyContinue).Source
    if (-not $bunCmd) { $bunCmd = (Get-Command bun -ErrorAction SilentlyContinue).Source }
    if (-not $bunCmd) { Write-Host "ERROR: bun tidak ditemukan." -ForegroundColor Red; exit 1 }

    $logFile = Join-Path $logDir "$Version.log"
    Write-Host "[$Version] background, log: $logFile" -ForegroundColor DarkGray
    # cmd /c wrapper supaya .cmd shim jalan lewat Start-Process
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$bunCmd`" run start" -WorkingDirectory $backend -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" -NoNewWindow
    Write-Host "[$Version] started (background). Cek: .\versions.ps1 list" -ForegroundColor Green
} else {
    Push-Location $backend
    bun run start
    Pop-Location
}
