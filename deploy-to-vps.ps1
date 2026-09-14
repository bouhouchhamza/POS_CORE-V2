<#
.SYNOPSIS
    Deploys local CorePOS-SaaS code (Frontend, API, Packages, Deploy configs) to production VPS.

.DESCRIPTION
    Creates a clean deployment zip bundle excluding node_modules, build artifacts,
    executables, and local environment secrets, transfers it via SCP, and executes
    unzip and Docker Compose build/restart via SSH on the remote host.

.PARAMETER VpsHost
    SSH connection string for the VPS (e.g. root@195.35.0.63). Default: root@195.35.0.63

.PARAMETER RemoteDir
    Remote destination directory on the VPS. Default: /opt/core-pos-v2-prod

.PARAMETER ComposeFile
    Relative path to docker-compose file. Default: deploy/docker-compose.prod.yml

.EXAMPLE
    .\deploy-to-vps.ps1
    .\deploy-to-vps.ps1 -VpsHost "root@195.35.0.63" -RemoteDir "/opt/core-pos-v2-prod"
#>

[CmdletBinding()]
param(
    [string]$VpsHost = "root@195.35.0.63",
    [string]$RemoteDir = "/opt/core-pos-v2-prod",
    [string]$ComposeFile = "deploy/docker-compose.prod.yml"
)

$ErrorActionPreference = "Stop"
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$rootDir = $PSScriptRoot
$zipFileName = "deploy-bundle-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
$localZipPath = Join-Path $rootDir $zipFileName
$remoteZipPath = "$RemoteDir/$zipFileName"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  COREPOS-SAAS PRODUCTION DEPLOYMENT SCRIPT" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Target VPS       : $VpsHost"
Write-Host "Remote Path      : $RemoteDir"
Write-Host "Local Workspace  : $rootDir"
Write-Host ""

try {
    # ---------------------------------------------------------
    # 1. Gather files with strict exclusion rules
    # ---------------------------------------------------------
    Write-Host "[1/4] Scanning files and creating deployment archive..." -ForegroundColor Yellow

    # Directories and files required for production builds
    $includePaths = @("apps", "packages", "deploy", "package.json", "package-lock.json", "tsconfig.json")
    
    # Exclude regex patterns (directories and file patterns)
    $excludeRegex = [regex]'([\\/](node_modules|dist|target|\.git|\.hotfix-backup[^\\]*|binaries)[\\/])|(\.(exe|pem|sqlite|sqlite-wal|sqlite-shm|log|bak|patch)$)|(^deploy-bundle-.*\.zip$)|([\\/]\.env(\..+)?$)'

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zipStream = [System.IO.File]::Create($localZipPath)
    $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

    # Windows PowerShell 5.1 compatible relative path calculation
    $rootPrefix = $rootDir.TrimEnd('\', '/') + '\'
    $rootPrefixLen = $rootPrefix.Length

    $fileCount = 0
    foreach ($item in $includePaths) {
        $fullPath = Join-Path $rootDir $item
        if (-not (Test-Path -LiteralPath $fullPath)) {
            continue
        }

        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            $file = Get-Item -LiteralPath $fullPath
            $fullName = $file.FullName
            $relPath = if ($fullName.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $fullName.Substring($rootPrefixLen)
            } else {
                $file.Name
            }

            if ($relPath -notmatch $excludeRegex) {
                $entryName = $relPath.Replace('\', '/')
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $archive,
                    $file.FullName,
                    $entryName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
                $fileCount++
            }
        } else {
            $files = Get-ChildItem -LiteralPath $fullPath -Recurse -File -Force
            foreach ($file in $files) {
                $fullName = $file.FullName
                $relPath = if ($fullName.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $fullName.Substring($rootPrefixLen)
                } else {
                    $file.Name
                }

                if ($relPath -notmatch $excludeRegex) {
                    $entryName = $relPath.Replace('\', '/')
                    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                        $archive,
                        $file.FullName,
                        $entryName,
                        [System.IO.Compression.CompressionLevel]::Optimal
                    ) | Out-Null
                    $fileCount++
                }
            }
        }
    }

    $archive.Dispose()
    $zipStream.Dispose()

    $zipSizeMb = [math]::Round(((Get-Item $localZipPath).Length / 1MB), 2)
    Write-Host "Archive created: $zipFileName ($zipSizeMb MB, $fileCount files included)" -ForegroundColor Green

    # ---------------------------------------------------------
    # 2. Transfer archive via SCP
    # ---------------------------------------------------------
    Write-Host "`n[2/4] Transferring $zipFileName to ${VpsHost}:${RemoteDir} ..." -ForegroundColor Yellow
    scp $localZipPath "${VpsHost}:${remoteZipPath}"
    if ($LASTEXITCODE -ne 0) {
        throw "SCP transfer failed with exit code $LASTEXITCODE"
    }
    Write-Host "Transfer complete." -ForegroundColor Green

    # ---------------------------------------------------------
    # 3. Extract and Deploy on VPS via SSH
    # ---------------------------------------------------------
    Write-Host "`n[3/4] Extracting files and rebuilding Docker containers on VPS..." -ForegroundColor Yellow

    # Remote command script executed over SSH:
    # 1. Unzip using unzip or python3 fallback
    # 2. Clean up remote zip file
    # 3. Run docker compose up -d --build
    $remoteScript = @"
set -e
cd '$RemoteDir'

echo '==> Extracting archive...'
if command -v unzip >/dev/null 2>&1; then
    unzip -oq '$zipFileName'
elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import zipfile; zipfile.ZipFile('$zipFileName').extractall('.')"
else
    echo 'ERROR: Neither unzip nor python3 found on VPS.' >&2
    exit 1
fi

rm -f '$zipFileName'

echo '==> Ensuring shared external web-network exists...'
docker network inspect web-network >/dev/null 2>&1 || docker network create web-network
docker network connect web-network deploy-caddy-1 2>/dev/null || true

echo '==> Rebuilding and starting Docker services...'
if docker compose version >/dev/null 2>&1; then
    docker compose -f '$ComposeFile' up -d --build
elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f '$ComposeFile' up -d --build
else
    echo 'ERROR: docker compose is not installed or not in PATH.' >&2
    exit 1
fi

echo '==> Container status:'
docker compose -f '$ComposeFile' ps
"@

    # Execute remote commands reliably via stdin
    $remoteScript | ssh -o StrictHostKeyChecking=accept-new $VpsHost "sh"
    if ($LASTEXITCODE -ne 0) {
        throw "Remote deployment failed with exit code $LASTEXITCODE"
    }

    # ---------------------------------------------------------
    # 4. Success summary
    # ---------------------------------------------------------
    $sw.Stop()
    $elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    Write-Host "`n==========================================================" -ForegroundColor Green
    Write-Host "  DEPLOYMENT SUCCEEDED in $elapsed seconds!" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
}
finally {
    # Clean up local temporary zip
    if (Test-Path -LiteralPath $localZipPath) {
        Remove-Item -LiteralPath $localZipPath -Force -ErrorAction SilentlyContinue
        Write-Host "Cleaned up local temporary bundle: $zipFileName" -ForegroundColor DarkGray
    }
}
