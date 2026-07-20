# Senda emergency recovery for Windows Gemma split (MSI / LYU).
# KEEP ASCII-ONLY (same rule as install.ps1).
#
#   iwr -useb https://senda.network/recover-windows-gemma.ps1 | iex
#
# Or save and run in PowerShell as your normal user (not SYSTEM).

$ErrorActionPreference = 'Continue'

Write-Host '=== Senda Windows Gemma recovery ==='

# 1) Kill every senda-related process
foreach ($img in @(
    'senda.exe', 'wscript.exe',
    'llama-server.exe', 'llama-server-cuda.exe',
    'rpc-server.exe', 'rpc-server-cuda.exe'
)) {
    taskkill /F /T /IM $img 2>$null | Out-Null
}
Start-Sleep -Seconds 2

# 2) Wipe the broken Qwen3-Coder cache that hijacked LYU
$coderCaches = @(
    (Join-Path $env:LOCALAPPDATA 'huggingface\hub\models--Qwen--Qwen3-Coder-Next-GGUF'),
    (Join-Path $env:USERPROFILE '.cache\huggingface\hub\models--Qwen--Qwen3-Coder-Next-GGUF')
)
foreach ($p in $coderCaches) {
    if (Test-Path $p) {
        Write-Host "Removing $p"
        Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
    }
}

# 3) Truncate stale runtime logs (old Coder session poisoned diagnostics)
$logDir = Join-Path $env:LOCALAPPDATA 'senda\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
foreach ($f in @('stderr.log', 'stdout.log')) {
    $path = Join-Path $logDir $f
    Set-Content -Path $path -Value '' -Encoding ASCII
    Write-Host "Cleared $path"
}

# 4) Force Gemma as the only startup model in config.toml
$configDir = Join-Path $env:USERPROFILE '.senda'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$configPath = Join-Path $configDir 'config.toml'
@"
[[models]]
model = "Gemma-3-27B-it-Q4_K_M"
"@ | Set-Content -Path $configPath -Encoding UTF8
Write-Host "Wrote $configPath"

# 5) Show what the Scheduled Task will run
$vbs = Join-Path $env:LOCALAPPDATA 'senda\bin\senda-launch.vbs'
if (Test-Path $vbs) {
    Write-Host '--- current SENDA_ARGS (must include --model after desktop reopens) ---'
    Select-String -Path $vbs -Pattern 'SENDA_ARGS|SENDA_CONFIG|SENDA_BIN' | ForEach-Object { $_.Line }
} else {
    Write-Host "WARN: no $vbs yet - open the Senda desktop app once"
}

$bin = Join-Path $env:LOCALAPPDATA 'senda\bin\senda.exe'
if (Test-Path $bin) {
    Write-Host '--- runtime version ---'
    & $bin --version
} else {
    Write-Host "WARN: missing $bin"
}

# 6) Bounce the task
try { schtasks.exe /End /TN Senda 2>$null | Out-Null } catch { }
Start-Sleep -Seconds 2
try {
    schtasks.exe /Run /TN Senda 2>$null | Out-Null
    Write-Host 'Started Scheduled Task Senda'
} catch {
    Write-Host 'Could not schtasks /Run - open the Senda desktop app to start the runtime'
}

Write-Host ''
Write-Host 'NEXT: Fully quit Senda desktop (tray), reopen it (rewrites VBS with --model + HOME),'
Write-Host '      confirm runtime 0.66.94+, startup Gemma, wait until both MSI and LYU show online.'
Write-Host '      Then send a new diagnostic report from each machine.'
