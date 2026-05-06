#Requires -Version 5.1
<#
.SYNOPSIS
  Installs latest livetv + livetv-supervisor from GitHub Releases (Windows x64).
  Set $env:LIVETV_INSTALL_RUN='1' before running to start the app after install.
#>
$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSVersion.Major -lt 6) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

$repo = if ($env:LIVETV_INSTALL_REPO) { $env:LIVETV_INSTALL_REPO } else { "benedyktdryl/live-tv" }
$zipName = "livetv-windows-x64.zip"
$api = "https://api.github.com/repos/$repo/releases/latest"
$headers = @{ "Accept" = "application/vnd.github+json"; "User-Agent" = "livetv-install-ps1" }

$release = Invoke-RestMethod -Uri $api -Headers $headers
$zipAsset = $release.assets | Where-Object { $_.name -eq $zipName }
$sumsAsset = $release.assets | Where-Object { $_.name -eq "SHA256SUMS" }
if (-not $zipAsset -or -not $sumsAsset) {
  Write-Error "Release is missing $zipName or SHA256SUMS. Open https://github.com/$repo/releases"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("livetv-install-" + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $zipPath = Join-Path $tmp $zipName
  $sumsPath = Join-Path $tmp "SHA256SUMS"
  Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $zipPath -Headers $headers -UseBasicParsing
  Invoke-WebRequest -Uri $sumsAsset.browser_download_url -OutFile $sumsPath -Headers $headers -UseBasicParsing

  $expected = $null
  Get-Content $sumsPath | ForEach-Object {
    if ($_ -match "^\s*([A-Fa-f0-9]{64})\s+(.+?)\s*$") {
      $fname = $matches[2].Trim()
      if ($fname -eq $zipName) {
        $expected = $matches[1].ToLowerInvariant()
      }
    }
  }
  if (-not $expected) {
    Write-Error "Could not find SHA256 for $zipName in SHA256SUMS"
  }
  $hash = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash.ToLowerInvariant()
  if ($hash -ne $expected) {
    Write-Error "SHA256 mismatch for $zipName"
  }

  $dest = if ($env:LIVETV_INSTALL_PREFIX) { $env:LIVETV_INSTALL_PREFIX } else { Join-Path $env:LOCALAPPDATA "livetv" }
  $bin = Join-Path $dest "bin"
  if (Test-Path $bin) {
    Remove-Item -Recurse -Force $bin
  }
  New-Item -ItemType Directory -Path $bin | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $bin)

  $sup = Join-Path $bin "livetv-supervisor-windows-x64.exe"
  $cli = Join-Path $bin "livetv-windows-x64.exe"
  if (-not (Test-Path $sup) -or -not (Test-Path $cli)) {
    Write-Error "Zip did not contain expected executables."
  }

  $plainCli = Join-Path $bin "livetv.exe"
  $plainSup = Join-Path $bin "livetv-supervisor.exe"
  try {
    if (Test-Path $plainCli) { Remove-Item -Force $plainCli }
    if (Test-Path $plainSup) { Remove-Item -Force $plainSup }
    New-Item -ItemType HardLink -Path $plainCli -Target $cli | Out-Null
    New-Item -ItemType HardLink -Path $plainSup -Target $sup | Out-Null
  }
  catch {
    # Non-NTFS or policy: supervisor still finds livetv-windows-x64.exe in the same folder.
  }

  $runSup = if (Test-Path $plainSup) { $plainSup } else { $sup }

  Write-Host ""
  Write-Host "Installed to $bin"
  Write-Host "Start the app (after Docker Desktop is running):"
  Write-Host "  & `"$runSup`""
  Write-Host ""

  if ($env:LIVETV_INSTALL_RUN -eq "1") {
    & $runSup
  }
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
