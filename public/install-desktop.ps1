# Senda Desktop installer - Windows x86_64.
#
#   iwr -useb https://senda.network/install-desktop.ps1 | iex
#
# What it does:
#   1. Resolves the latest v* GitHub Release (legacy desktop-v* tags
#      are still accepted so older pinned versions keep resolving).
#   2. Downloads Senda_<version>_x64-setup.exe (NSIS installer).
#   3. Runs it silently and waits for it to finish.
#   4. Optionally launches Senda once installation completes.
#
# This is a *companion* to the runtime installer (install.ps1). The
# desktop app is a UI shell; it does not host inference. Install the
# runtime separately:
#
#     iwr -useb https://senda.network/install.ps1 | iex
#
# Override points (rarely needed):
#   $env:SENDA_DESKTOP_REPO = 'senda-network/senda'
#   $env:SENDA_DESKTOP_VERSION = 'v0.1.93'  # pin a release

[CmdletBinding()]
param(
    [string]$Repo,
    [string]$Version,
    [switch]$NoLaunch,
    [switch]$Msi
)

$ErrorActionPreference = 'Stop'

if (-not $Repo) {
    $Repo = if ($env:SENDA_DESKTOP_REPO) { $env:SENDA_DESKTOP_REPO } else { 'senda-network/senda' }
}
if (-not $Version) {
    $Version = if ($env:SENDA_DESKTOP_VERSION) { $env:SENDA_DESKTOP_VERSION } else { '' }
}

# Desktop releases use plain `vX.Y.Z` tags (per release policy). Legacy
# `desktop-v*` tags are still accepted so existing pinned URLs work.
$tagPrefix = 'v'
$legacyTagPrefix = 'desktop-v'

function Test-DesktopTag([string]$name) {
    if (-not $name) { return $false }
    # Accept `vX...` (with a digit right after the v so we don't pick
    # up unrelated tags like `vendor-foo`) or the legacy `desktop-v...`.
    return ($name -match '^v\d') -or ($name.StartsWith($legacyTagPrefix))
}

function Remove-TagPrefix([string]$name) {
    if ($name.StartsWith($legacyTagPrefix)) {
        return $name.Substring($legacyTagPrefix.Length)
    }
    if ($name.StartsWith($tagPrefix)) {
        return $name.Substring($tagPrefix.Length)
    }
    return $name
}

function Info($msg)  { Write-Host "[senda-desktop] $msg" -ForegroundColor Cyan }
function Warn($msg)  { Write-Host "[senda-desktop] $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "[senda-desktop] $msg" -ForegroundColor Red; exit 1 }

# TLS 1.2 is required to talk to api.github.com on PS5 hosts (Windows 10
# without recent updates still defaults to 1.0/1.1).
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-GitHub($path) {
    $headers = @{
        'Accept'               = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
        'User-Agent'           = 'senda-desktop-installer'
    }
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
    return Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repo$path"
}

# --------------------------------------------------------------------------
# Resolve release.
# --------------------------------------------------------------------------
if ($Version) {
    Info "Pinned to $Version"
    $release = Invoke-GitHub "/releases/tags/$Version"
}
else {
    Info "Resolving latest release of $Repo..."
    try {
        $candidate = Invoke-GitHub '/releases/latest'
        if (Test-DesktopTag $candidate.tag_name) {
            $release = $candidate
        }
    }
    catch {
        # /releases/latest 404s on a repo without any published releases;
        # fall through to the list lookup below.
    }
    if (-not $release) {
        Info "Falling back to release list..."
        $list = Invoke-GitHub '/releases?per_page=20'
        $release = $list | Where-Object { (-not $_.draft) -and (-not $_.prerelease) -and (Test-DesktopTag $_.tag_name) } | Select-Object -First 1
    }
}

if (-not $release) {
    Fail "couldn't find a published v* release. Try the GitHub releases page directly: https://github.com/$Repo/releases"
}

$tagName = $release.tag_name
$versionNumber = Remove-TagPrefix $tagName

# --------------------------------------------------------------------------
# Pick the right asset.
#
# Default: the NSIS .exe installer (`*_x64-setup.exe`) - much smaller and
# friendlier for non-technical users than the .msi. Pass -Msi to force
# the MSI variant for IT-managed deployments.
# --------------------------------------------------------------------------
if ($Msi) {
    $asset = $release.assets | Where-Object { $_.name -like '*_x64*.msi' } | Select-Object -First 1
    $assetKind = 'MSI'
}
else {
    $asset = $release.assets | Where-Object { $_.name -like '*_x64-setup.exe' } | Select-Object -First 1
    $assetKind = 'NSIS installer'
    if (-not $asset) {
        Warn "No NSIS installer in this release - falling back to MSI."
        $asset = $release.assets | Where-Object { $_.name -like '*_x64*.msi' } | Select-Object -First 1
        $assetKind = 'MSI'
    }
}

if (-not $asset) {
    Fail "no Windows asset in release $tagName. See https://github.com/$Repo/releases/tag/$tagName"
}

# --------------------------------------------------------------------------
# Download.
# --------------------------------------------------------------------------
$tempDir = Join-Path $env:TEMP "senda-desktop-install"
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
New-Item -ItemType Directory -Path $tempDir | Out-Null

$installerPath = Join-Path $tempDir $asset.name
Info "Downloading $($asset.name) (v$versionNumber)..."
# `Invoke-WebRequest` with -OutFile already shows a progress bar; we
# silence the non-progress output by suppressing the return value.
$null = Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerPath -UseBasicParsing

# --------------------------------------------------------------------------
# Run installer.
# --------------------------------------------------------------------------
Info "Running $assetKind silently..."
if ($Msi) {
    # /qn = no UI, /norestart = don't reboot. Logging into the temp dir so
    # failures leave a breadcrumb instead of a silent error.
    $logPath = Join-Path $tempDir 'msi-install.log'
    $proc = Start-Process -FilePath 'msiexec.exe' `
        -ArgumentList @('/i', "`"$installerPath`"", '/qn', '/norestart', '/log', "`"$logPath`"") `
        -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        Fail "msiexec exited with code $($proc.ExitCode). See $logPath"
    }
}
else {
    # NSIS installers built by Tauri honour the standard /S silent flag.
    $proc = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        Fail "installer exited with code $($proc.ExitCode)"
    }
}

# --------------------------------------------------------------------------
# Find the freshly-installed app and launch it (unless suppressed).
# --------------------------------------------------------------------------
$candidates = @(
    "$env:LOCALAPPDATA\Programs\Senda\senda.exe",
    "$env:LOCALAPPDATA\Senda\senda.exe",
    "$env:ProgramFiles\Senda\senda.exe",
    "${env:ProgramFiles(x86)}\Senda\senda.exe"
)
$installedExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($installedExe) {
    Info "Installed: $installedExe"
    if (-not $NoLaunch) {
        Info "Launching Senda..."
        Start-Process -FilePath $installedExe
    }
}
else {
    Warn "Installer succeeded but I couldn't locate senda.exe in the usual places. Check your Start menu under 'Senda'."
}

Write-Host ""
Write-Host "[senda-desktop] Done. v$versionNumber installed." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. If you haven't already, install the runtime on at least one machine:"
Write-Host "       iwr -useb https://senda.network/install.ps1 | iex"
Write-Host "  2. Open Senda - the system-tray pill should show 'Mesh online'."
Write-Host "  3. Generate an invite for a teammate from the tray menu, or via:"
Write-Host "       senda invite create"
