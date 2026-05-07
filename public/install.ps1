# ClosedMesh installer — Windows x86_64.
#
#   iwr -useb https://closedmesh.com/install.ps1 | iex
#   iwr -useb https://closedmesh.com/install.ps1 | iex; closedmesh-install -Service
#
# Detects whether your GPU prefers the CUDA or Vulkan flavor, downloads the
# matching closedmesh-windows-x86_64-<flavor>.zip, installs closedmesh.exe to
# %LOCALAPPDATA%\closedmesh\bin, and (with -Service) registers a Scheduled
# Task so it auto-starts at login.
#
# Backend override:
#   $env:CLOSEDMESH_BACKEND = 'cuda' | 'vulkan' | 'cpu'
#   iwr -useb https://closedmesh.com/install.ps1 | iex; closedmesh-install
#
# Uninstall:
#   schtasks /Delete /TN ClosedMesh /F
#   Remove-Item -Recurse $env:LOCALAPPDATA\closedmesh

[CmdletBinding()]
param(
    [switch]$Service,
    [switch]$NoStartService,
    [string]$InstallDir,
    [string]$Repo,
    [string]$Backend
)

$ErrorActionPreference = 'Stop'

if (-not $Repo)        { $Repo        = if ($env:CLOSEDMESH_INSTALL_REPO) { $env:CLOSEDMESH_INSTALL_REPO } else { 'closedmesh/closedmesh-llm' } }
if (-not $InstallDir)  { $InstallDir  = if ($env:CLOSEDMESH_INSTALL_DIR)  { $env:CLOSEDMESH_INSTALL_DIR }  else { Join-Path $env:LOCALAPPDATA 'closedmesh\bin' } }
if (-not $Backend)     { $Backend     = $env:CLOSEDMESH_BACKEND }

$TaskName = 'ClosedMesh'
$DataDir  = Join-Path $env:USERPROFILE '.closedmesh'
$LogDir   = Join-Path $env:LOCALAPPDATA 'closedmesh\logs'

function Write-Info  { param($Msg) Write-Host "[closedmesh] $Msg" -ForegroundColor Cyan }
function Write-Ok    { param($Msg) Write-Host "[closedmesh] $Msg" -ForegroundColor Green }
function Write-Warn2 { param($Msg) Write-Host "[closedmesh] $Msg" -ForegroundColor Yellow }
function Write-Err   { param($Msg) Write-Host "[closedmesh] $Msg" -ForegroundColor Red }

function Stop-RunningRuntime {
    # Stop the scheduled task gracefully if it exists. -ErrorAction
    # SilentlyContinue swallows the "task not found" / "task not
    # running" errors which are noise on a fresh install.
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null } catch { }

    # Kill any lingering closedmesh.exe whose path is in our install
    # tree. Match by full path (not just image name) to avoid touching
    # an unrelated `closedmesh` build the user might be running from
    # source elsewhere. Repeat across two short sleeps because the
    # runtime can momentarily fork helper subprocesses (llama.cpp
    # workers) that we want to catch too.
    $targetBin = Join-Path $InstallDir 'closedmesh.exe'
    for ($i = 0; $i -lt 2; $i++) {
        try {
            Get-Process -Name closedmesh -ErrorAction SilentlyContinue |
                Where-Object { $_.Path -and ($_.Path -ieq $targetBin) } |
                Stop-Process -Force -ErrorAction SilentlyContinue
        } catch { }
        Start-Sleep -Milliseconds 250
    }

    # Also kill the wscript.exe launcher (see Write-LaunchVbs) when
    # it's currently shepherding a closedmesh.exe. Without this the
    # scheduled task's wscript host process keeps the .vbs file
    # locked and we can't rewrite it on upgrade.
    $vbsPath = Join-Path $InstallDir 'closedmesh-launch.vbs'
    try {
        Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and ($_.CommandLine -like "*closedmesh-launch.vbs*") } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch { }

    # Give Windows a moment to release file handles before the caller
    # tries to Copy-Item over the binary or rewrite the .vbs.
    Start-Sleep -Milliseconds 400
}

function Write-LaunchVbs {
    # Generates a tiny VBScript next to the runtime binary that
    # CreateProcess()'s closedmesh.exe with no console window, with
    # stdout and stderr redirected to log files, then blocks until
    # it exits.
    #
    # Why all this machinery:
    #
    # 1. closedmesh.exe is a console-subsystem binary. When a
    #    Scheduled Task with LogonType=Interactive runs it directly,
    #    Windows always allocates a console — and on Win11 the user's
    #    default terminal handler (Windows Terminal) opens a visible
    #    tab titled with the binary's path. The runtime also paints a
    #    TUI status board ("Running llama.cpp instances…") in that
    #    tab. Looks exactly like the desktop app spawned a stray dev
    #    terminal on every login.
    #
    # 2. Without redirection, closedmesh.exe's stdout and stderr go
    #    to the void (Scheduled Task allocates a console and never
    #    captures it). The dashboard's Activity page reads these
    #    streams from disk, so on Windows it stayed permanently
    #    empty — a friend who set a startup model and waited for it
    #    to load saw "no activity, no errors" because the runtime
    #    was logging to /dev/null.
    #
    # The fix: wrap the run inside `cmd /S /c "<bin> <args> >>
    # stdout.log 2>> stderr.log"` invoked via wscript.exe.
    # wscript.exe is a Windows-subsystem host so no console pops;
    # `cmd /S /c` strips its outer quote pair and runs the rest as a
    # single command line; the `>>` and `2>>` redirections are
    # interpreted by cmd, not the runtime, so closedmesh's normal
    # writes land on disk. `0` passed to sh.Run is SW_HIDE, `True`
    # makes wscript wait for the child to exit so the Scheduled Task
    # framework treats the task as running while the runtime is
    # alive (and Stop-ScheduledTask actually terminates the tree).
    #
    # Quote handling is done via Chr(34) string concatenation rather
    # than VBS's `""` doubling, because `cmd /S /c "<bin>" args >>
    # "log"` ends up with five distinct quote pairs and the doubling
    # gets unreadable fast. Chr(34)-based assembly produces the
    # exact target string regardless of how many escape layers are
    # nominally in play.
    #
    # The CLOSEDMESH_ARGS comment line at the top is the canonical
    # source of args for the desktop app's idempotency check
    # (current_windows_task_args in desktop/src/mesh.rs reads it).
    # Don't remove it.
    param([string]$Bin, [string]$ArgString)

    $vbsPath = Join-Path $InstallDir 'closedmesh-launch.vbs'

    # CLOSEDMESH_ARGS / CLOSEDMESH_BIN / CLOSEDMESH_LOGDIR are
    # pre-formatted as a single literal in the VBS. The desktop's
    # idempotency check parses these comment lines verbatim, so
    # don't reorder or rename them.
    $logFileStdout = Join-Path $LogDir 'stdout.log'
    $logFileStderr = Join-Path $LogDir 'stderr.log'

    # Pin the HuggingFace Hub cache so this runtime instance and any
    # download / load codepath in any other instance (the desktop app's
    # bundled Node controller, in particular) all agree on where
    # models live. The runtime CLI's own resolver falls back to
    # `$HOME/.cache/huggingface/hub`, but on Windows `HOME` is unset
    # and that fallback collapses to `./.cache/huggingface/hub` —
    # whichever process's CWD launched the runtime. Two CWDs ⇒ two
    # caches ⇒ a model the user "downloaded" via the dashboard is
    # invisible to the startup-loading task ⇒ the runtime silently
    # restarts a multi-GB download on every "make this my startup
    # model" click. Setting the env var here pins it. Mirror in
    # desktop/src/mesh.rs::REGISTER_TASK_PS and main.rs.
    $hfCacheDir = Join-Path $env:LOCALAPPDATA 'huggingface\hub'
    if (-not (Test-Path $hfCacheDir)) { New-Item -ItemType Directory -Force -Path $hfCacheDir | Out-Null }

    $vbs = @"
' Auto-generated by ClosedMesh installer. Do not edit by hand;
' reinstall the runtime to regenerate. See install.ps1::Write-LaunchVbs
' and desktop/src/mesh.rs::REGISTER_TASK_PS for the same wrapper used
' by the desktop app's auto-install path.
'
' CLOSEDMESH_BIN: ${Bin}
' CLOSEDMESH_ARGS: ${ArgString}
' CLOSEDMESH_LOGDIR: ${LogDir}
' CLOSEDMESH_HF_HUB_CACHE: ${hfCacheDir}
Option Explicit
Dim sh, fso, cmd, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FolderExists("${LogDir}") Then fso.CreateFolder("${LogDir}")
If Not fso.FolderExists("${hfCacheDir}") Then fso.CreateFolder("${hfCacheDir}")
' Pin the HuggingFace cache for THIS process; cmd / closedmesh inherit.
sh.Environment("PROCESS")("HF_HUB_CACHE") = "${hfCacheDir}"
q = Chr(34)
cmd = "cmd /S /c " & q & q & "${Bin}" & q & " ${ArgString} >> " & q & "${logFileStdout}" & q & " 2>> " & q & "${logFileStderr}" & q & q
sh.Run cmd, 0, True
Set sh = Nothing
Set fso = Nothing
"@

    Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII
    return $vbsPath
}

function Detect-Backend {
    if ($Backend) { return $Backend.ToLower() }

    # NVIDIA: prefer nvidia-smi if available, else inspect the device list.
    $nvidiaSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($nvidiaSmi) {
        try {
            $null = & nvidia-smi -L 2>$null
            if ($LASTEXITCODE -eq 0) { return 'cuda' }
        } catch { }
    }

    try {
        $videoControllers = Get-CimInstance Win32_VideoController -ErrorAction Stop
    } catch {
        $videoControllers = @()
    }

    foreach ($v in $videoControllers) {
        $name = ($v.Name + ' ' + $v.AdapterCompatibility)
        if ($name -match 'NVIDIA') { return 'cuda' }
    }

    # Anything else with a GPU -> Vulkan. AMD, Intel, and even older NVIDIA cards
    # without a current CUDA driver land here.
    foreach ($v in $videoControllers) {
        if ($v.AdapterRAM -gt 0) { return 'vulkan' }
    }

    Write-Warn2 'No GPU detected — falling back to Vulkan flavor (CPU-only path TBD on Windows).'
    return 'vulkan'
}

function Get-Target {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -ne 'AMD64' -and $arch -ne 'x86_64') {
        Write-Err "ClosedMesh on Windows requires x86_64. Detected: $arch"
        Write-Err "ARM64 Windows is not yet supported. Build from source: https://github.com/$Repo"
        throw 'Unsupported architecture.'
    }

    $flavor = Detect-Backend
    if ($flavor -notin @('cuda', 'vulkan')) {
        Write-Err "Unsupported Windows backend: $flavor"
        Write-Err "Set `$env:CLOSEDMESH_BACKEND = 'cuda' or 'vulkan' to override."
        throw 'Unsupported backend.'
    }
    return "windows-x86_64-$flavor"
}

function Download-Binary {
    param([string]$Target)

    $asset = "closedmesh-$Target.zip"
    $url = "https://github.com/$Repo/releases/latest/download/$asset"
    $tmp = New-Item -ItemType Directory -Path (Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString()))

    try {
        Write-Info "Downloading $asset from $Repo..."
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile (Join-Path $tmp $asset)
        } catch {
            Write-Err "Failed to download $url"
            Write-Err 'If your hardware does not have a release artifact yet, try'
            Write-Err "  `$env:CLOSEDMESH_BACKEND = 'vulkan'; iwr -useb https://closedmesh.com/install.ps1 | iex"
            Write-Err 'or build from source: https://github.com/' + $Repo
            throw
        }

        Write-Info 'Extracting...'
        Expand-Archive -Path (Join-Path $tmp $asset) -DestinationPath $tmp -Force

        $binSrc = Join-Path $tmp 'closedmesh.exe'
        if (-not (Test-Path $binSrc)) {
            throw "Extracted archive did not contain closedmesh.exe at $binSrc"
        }

        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        }

        # Make sure the previous runtime isn't holding the destination
        # binary open. Without this, Copy-Item -Force fails with
        # "The process cannot access the file '...\closedmesh.exe'
        # because it is being used by another process." on every
        # re-install (e.g. user clicks the Setup button while the
        # service is already running).
        Stop-RunningRuntime

        Copy-Item -Force $binSrc (Join-Path $InstallDir 'closedmesh.exe')
        Write-Ok "Installed: $InstallDir\closedmesh.exe"
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

function Add-PathHint {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    if (($userPath -split ';') -contains $InstallDir) { return }

    Write-Info "Adding $InstallDir to your user PATH..."
    $newPath = if ($userPath) { "$userPath;$InstallDir" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Warn2 'PATH updated. New shells will pick it up automatically; existing shells need to reopen.'
}

function Install-ScheduledTaskUnit {
    $bin = Join-Path $InstallDir 'closedmesh.exe'
    if (-not (Test-Path $bin)) {
        Write-Err "Cannot register Scheduled Task: $bin does not exist."
        return
    }

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
    if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Force -Path $DataDir | Out-Null }

    # Re-register: nuke any existing task with the same name to keep the
    # installer idempotent. schtasks writes "ERROR: The system cannot
    # find the file specified." to stderr when the task doesn't exist
    # (the expected case on a fresh install). Under
    # $ErrorActionPreference = 'Stop' that stderr write becomes a
    # terminating NativeCommandError even though `2>$null` should have
    # eaten it — wrap in try/catch so a missing task is silently OK.
    try { schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null } catch { }

    # `serve --auto --publish --mesh-name closedmesh ...` discovers and
    # joins the public ClosedMesh through the canonical entry node at
    # mesh.closedmesh.com, AND advertises this node on Nostr so peers
    # and the public entry can find it. Without --publish closedmesh.com
    # shows "0 models" even when joined.
    #
    # `--join-url` is preferred (the runtime re-fetches the token on
    # every restart so an entry-node key rotation doesn't strand
    # installs), but we only embed it when the installed CLI actually
    # understands the flag — closedmesh-llm < v0.65.0 crashloops with
    # `error: unexpected argument '--join-url'`. For older CLIs we
    # embed a literal `--join <token>` fetched at install-time instead.
    $supportsJoinUrl = $false
    try {
        $help = & $bin serve --help 2>&1 | Out-String
        if ($help -match '--join-url') { $supportsJoinUrl = $true }
        else {
            $help2 = & $bin serve --help-advanced 2>&1 | Out-String
            if ($help2 -match '--join-url') { $supportsJoinUrl = $true }
        }
    } catch {
        $supportsJoinUrl = $false
    }

    $joinSegment = ''
    if ($supportsJoinUrl) {
        $joinSegment = ' --join-url https://mesh.closedmesh.com/api/status'
        Write-Info 'CLI supports --join-url; embedding it in the Scheduled Task.'
    } else {
        $token = $null
        try {
            $resp  = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 -Uri 'https://mesh.closedmesh.com/api/status'
            $json  = $resp.Content | ConvertFrom-Json
            if ($json.token) { $token = [string]$json.token }
        } catch {
            $token = $null
        }
        if ($token) {
            $joinSegment = " --join $token"
            Write-Info 'Older CLI without --join-url; embedded a fresh invite token.'
        } else {
            Write-Warn2 'Could not embed a join arg (older CLI, entry node unreachable).'
            Write-Warn2 'Service will fall back to Nostr auto-discovery.'
        }
    }

    # Override the runtime's default Iroh relay map: closedmesh-llm v0.65.0-rc2
    # ships *.michaelneale.mesh-llm.iroh.link defaults that no longer resolve,
    # so without these the runtime can't tunnel through NAT to the public
    # entry node and closedmesh.com shows "0 models". n0's canary relays
    # are publicly maintained.
    $relayArgs = '--relay https://use1-1.relay.n0.iroh-canary.iroh.link./ --relay https://euw-1.relay.n0.iroh-canary.iroh.link./'
    $argString = "serve --auto --publish --mesh-name closedmesh${joinSegment} ${relayArgs} --headless"

    # Wrap the runtime in a hidden VBS launcher so login doesn't pop a
    # Windows Terminal tab. See Write-LaunchVbs for the rationale.
    # We also Stop-RunningRuntime first so the previous wscript host
    # releases its lock on closedmesh-launch.vbs before we rewrite it.
    Stop-RunningRuntime
    $vbsPath   = Write-LaunchVbs -Bin $bin -ArgString $argString
    $action    = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbsPath`"" -WorkingDirectory $env:USERPROFILE
    $trigger   = New-ScheduledTaskTrigger   -AtLogOn -User $env:USERNAME
    $settings  = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -RestartCount 3 `
        -ExecutionTimeLimit (New-TimeSpan -Days 0)
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description 'ClosedMesh - private LLM mesh node' | Out-Null

    Write-Ok "Registered Scheduled Task: $TaskName"

    if (-not $NoStartService) {
        try {
            Start-ScheduledTask -TaskName $TaskName
            Write-Ok 'Started ClosedMesh service'
        } catch {
            Write-Warn2 "Could not auto-start the service. Try: Start-ScheduledTask -TaskName $TaskName"
        }
    } else {
        Write-Ok "Service installed (not started). Start later: Start-ScheduledTask -TaskName $TaskName"
    }
}

function Invoke-Install {
    Write-Info 'Installing ClosedMesh - private LLM mesh on the compute you already own.'
    Write-Info "Repo:    https://github.com/$Repo"
    Write-Info "Bin dir: $InstallDir"

    $target = Get-Target
    Write-Info "Target:  $target"

    Download-Binary -Target $target

    try {
        $null = & (Join-Path $InstallDir 'closedmesh.exe') --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw "closedmesh --version exited $LASTEXITCODE" }
    } catch {
        Write-Err 'Installed binary did not run cleanly. Aborting.'
        throw
    }

    if ($Service) { Install-ScheduledTaskUnit }

    Add-PathHint

    Write-Host ''
    Write-Host '  ClosedMesh installed.'
    Write-Host ''
    Write-Host '  Try:'
    Write-Host '    closedmesh --version'
    Write-Host '    closedmesh serve --auto              # foreground (joins the public mesh)'
    if ($Service) {
        Write-Host "    Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo  # service status"
        Write-Host "    Stop-ScheduledTask -TaskName $TaskName                          # stop the service"
    }
    Write-Host ''
    Write-Host '  Open the chat at https://closedmesh.com (or http://localhost:3000 if you ran the local app).'
    Write-Host ''
}

# When the script is fetched and piped to iex, the function below is exposed
# so the user can re-invoke with arguments (e.g. -Service). The script also
# runs Invoke-Install once on dot-source unless CLOSEDMESH_INSTALL_NO_AUTO=1.
function closedmesh-install {
    [CmdletBinding()]
    param(
        [switch]$Service,
        [switch]$NoStartService,
        [string]$InstallDir,
        [string]$Repo,
        [string]$Backend
    )
    if ($Service)         { $script:Service        = $true }
    if ($NoStartService)  { $script:NoStartService = $true }
    if ($InstallDir)      { $script:InstallDir     = $InstallDir }
    if ($Repo)            { $script:Repo           = $Repo }
    if ($Backend)         { $script:Backend        = $Backend }
    Invoke-Install
}

if (-not $env:CLOSEDMESH_INSTALL_NO_AUTO) {
    Invoke-Install
}
