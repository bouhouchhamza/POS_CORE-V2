param(
  [string]$PublicKeyPath = "",
  [string]$LicenseServerUrl = "https://pos.workflowtools.space"
)

$ErrorActionPreference = "Stop"
if ($LicenseServerUrl.TrimEnd('/') -ne 'https://pos.workflowtools.space') { throw 'Production installer must target https://pos.workflowtools.space.' }
$desktopDir = Split-Path -Parent $PSScriptRoot
$repo = (Resolve-Path (Join-Path $desktopDir "..\..")).Path
if (-not $PublicKeyPath) {
  $PublicKeyPath = Join-Path $desktopDir "src-tauri\resources\license-signing-public.pem"
}

if (-not (Test-Path -LiteralPath $PublicKeyPath -PathType Leaf)) {
  throw @"
Production public verification key was not found:
$PublicKeyPath

Copy the CURRENT public key from production first (the private key must NEVER leave the server):
scp root@195.35.0.63:/opt/core-pos-v2-prod/license-signing-public.pem `"$PublicKeyPath`"
"@
}

$pem = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $PublicKeyPath))
if ($pem -match "PRIVATE KEY") { throw "Refusing to build: a PRIVATE key was supplied." }
if ($pem -notmatch "-----BEGIN PUBLIC KEY-----" -or $pem -notmatch "-----END PUBLIC KEY-----") {
  throw "The supplied file is not a PUBLIC KEY PEM."
}

$nodeCheck = @'
const fs=require('fs');
const crypto=require('crypto');
const pem=fs.readFileSync(process.argv[1],'utf8');
if (/PRIVATE KEY/.test(pem)) throw new Error('PRIVATE KEY REFUSED');
const key=crypto.createPublicKey(pem);
if(key.asymmetricKeyType!=='ed25519') throw new Error('An Ed25519 verification key is required');
const der=key.export({type:'spki',format:'der'});
console.log('PUBLIC_KEY_PARSE=PASS');
console.log('PUBLIC_KEY_SPKI_SHA256='+crypto.createHash('sha256').update(der).digest('hex'));
'@
node -e $nodeCheck $PublicKeyPath
if ($LASTEXITCODE -ne 0) { throw "Public key validation failed." }

$oldKey = [Environment]::GetEnvironmentVariable("LICENSE_SIGNING_PUBLIC_KEY", "Process")
$oldUrl = [Environment]::GetEnvironmentVariable("LICENSE_SERVER_URL", "Process")
try {
  $env:LICENSE_SIGNING_PUBLIC_KEY = $pem
  $env:LICENSE_SERVER_URL = $LicenseServerUrl.TrimEnd('/')

  Set-Location $repo
  Write-Host "BUILDING_PRODUCTION_INSTALLER=YES" -ForegroundColor Cyan
  Write-Host "LICENSE_SERVER_URL=$env:LICENSE_SERVER_URL"
  npm run build -w @corepos/desktop
  if ($LASTEXITCODE -ne 0) { throw "Desktop production build failed." }

  $nsis = Get-ChildItem "apps\desktop\src-tauri\target\release\bundle\nsis" -Filter *.exe |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $nsis) { throw "NSIS installer not found after build." }

  npm run verify:installer-data-safety -w @corepos/desktop
  if ($LASTEXITCODE -ne 0) { throw "Installer data-safety verification failed." }

  Write-Host "PRODUCTION_INSTALLER_READY=YES" -ForegroundColor Green
  $nsis | Format-List FullName,Length,LastWriteTime
  Get-FileHash $nsis.FullName -Algorithm SHA256 | Format-List Algorithm,Hash,Path
}
finally {
  if ($null -eq $oldKey) { Remove-Item Env:LICENSE_SIGNING_PUBLIC_KEY -ErrorAction SilentlyContinue } else { $env:LICENSE_SIGNING_PUBLIC_KEY = $oldKey }
  if ($null -eq $oldUrl) { Remove-Item Env:LICENSE_SERVER_URL -ErrorAction SilentlyContinue } else { $env:LICENSE_SERVER_URL = $oldUrl }
}
