# Senda installer - Windows x86_64.
#
# KEEP THIS FILE ASCII-ONLY. Windows PowerShell 5.1 reads .ps1 files
# with no BOM using the system ANSI codepage (Windows-1252 on en-US
# systems). UTF-8 sequences for non-ASCII chars get re-decoded byte by
# byte; in particular an em-dash (U+2014, UTF-8 bytes 0xE2 0x80 0x94)
# ends on byte 0x94, which CP1252 maps to U+201D - a smart double-
# quote, which PowerShell then normalizes to a regular ASCII double
# quote for string parsing. If that synthetic close-quote lands inside
# a "..."-quoted string, the parser terminates the string mid-line and
# brace tracking unravels from there; users running this script via
# the desktop app's Setup button (which spawns `powershell.exe -File
# install.ps1`) saw a cascade of "Missing closing }" errors at every
# open brace below the offending line. The `iwr | iex` path doesn't
# hit this because HTTP decoding hands iex a proper UTF-8 string.
#
#   iwr -useb https://senda.network/install.ps1 | iex
#   iwr -useb https://senda.network/install.ps1 | iex; senda-install -Service
#
# Detects whether your GPU prefers the CUDA or Vulkan flavor, downloads the
# matching senda-windows-x86_64-<flavor>.zip, installs senda.exe to
# %LOCALAPPDATA%\senda\bin, then pulls the matching llama.cpp Windows
# helpers (rpc-server.exe / llama-server.exe + DLLs) from ggml-org/llama.cpp's
# official release so the runtime can actually load models. With -Service it
# also registers a Scheduled Task so it auto-starts at login.
#
# Backend override:
#   $env:SENDA_BACKEND = 'cuda' | 'vulkan' | 'cpu'
#   iwr -useb https://senda.network/install.ps1 | iex; senda-install
#
# Uninstall:
#   schtasks /Delete /TN Senda /F
#   Remove-Item -Recurse $env:LOCALAPPDATA\senda

[CmdletBinding()]
param(
    [switch]$Service,
    [switch]$NoStartService,
    [string]$InstallDir,
    [string]$Repo,
    [string]$Backend
)

$ErrorActionPreference = 'Stop'

if (-not $Repo)        { $Repo        = if ($env:SENDA_INSTALL_REPO) { $env:SENDA_INSTALL_REPO } else { 'senda-network/senda-llm' } }
if (-not $InstallDir)  { $InstallDir  = if ($env:SENDA_INSTALL_DIR)  { $env:SENDA_INSTALL_DIR }  else { Join-Path $env:LOCALAPPDATA 'senda\bin' } }
if (-not $Backend)     { $Backend     = $env:SENDA_BACKEND }

$TaskName = 'Senda'
$DataDir  = Join-Path $env:USERPROFILE '.senda'
$LogDir   = Join-Path $env:LOCALAPPDATA 'senda\logs'

function Write-Info  { param($Msg) Write-Host "[senda] $Msg" -ForegroundColor Cyan }
function Write-Ok    { param($Msg) Write-Host "[senda] $Msg" -ForegroundColor Green }
function Write-Warn2 { param($Msg) Write-Host "[senda] $Msg" -ForegroundColor Yellow }
function Write-Err   { param($Msg) Write-Host "[senda] $Msg" -ForegroundColor Red }

function Stop-RunningRuntime {
    # Stop the scheduled task gracefully if it exists. -ErrorAction
    # SilentlyContinue swallows the "task not found" / "task not
    # running" errors which are noise on a fresh install.
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null } catch { }

    # Kill any lingering senda.exe whose path is in our install
    # tree. Match by full path (not just image name) to avoid touching
    # an unrelated `senda` build the user might be running from
    # source elsewhere. Repeat across two short sleeps because the
    # runtime can momentarily fork helper subprocesses (llama.cpp
    # workers) that we want to catch too.
    $targetBin = Join-Path $InstallDir 'senda.exe'
    for ($i = 0; $i -lt 2; $i++) {
        try {
            Get-Process -Name senda -ErrorAction SilentlyContinue |
                Where-Object { $_.Path -and ($_.Path -ieq $targetBin) } |
                Stop-Process -Force -ErrorAction SilentlyContinue
        } catch { }
        Start-Sleep -Milliseconds 250
    }

    # Also kill the wscript.exe launcher (see Write-LaunchVbs) when
    # it's currently shepherding a senda.exe. Without this the
    # scheduled task's wscript host process keeps the .vbs file
    # locked and we can't rewrite it on upgrade.
    $vbsPath = Join-Path $InstallDir 'senda-launch.vbs'
    try {
        Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and ($_.CommandLine -like "*senda-launch.vbs*") } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch { }

    # Give Windows a moment to release file handles before the caller
    # tries to Copy-Item over the binary or rewrite the .vbs.
    Start-Sleep -Milliseconds 400
}

function Write-LaunchVbs {
    # Generates a tiny VBScript next to the runtime binary that
    # CreateProcess()'s senda.exe with no console window, with
    # stdout and stderr redirected to log files, then blocks until
    # it exits.
    #
    # Why all this machinery:
    #
    # 1. senda.exe is a console-subsystem binary. When a
    #    Scheduled Task with LogonType=Interactive runs it directly,
    #    Windows always allocates a console - and on Win11 the user's
    #    default terminal handler (Windows Terminal) opens a visible
    #    tab titled with the binary's path. The runtime also paints a
    #    TUI status board ("Running llama.cpp instances...") in that
    #    tab. Looks exactly like the desktop app spawned a stray dev
    #    terminal on every login.
    #
    # 2. Without redirection, senda.exe's stdout and stderr go
    #    to the void (Scheduled Task allocates a console and never
    #    captures it). The dashboard's Activity page reads these
    #    streams from disk, so on Windows it stayed permanently
    #    empty - a friend who set a startup model and waited for it
    #    to load saw "no activity, no errors" because the runtime
    #    was logging to /dev/null.
    #
    # The fix: wrap the run inside `cmd /S /c "<bin> <args> >>
    # stdout.log 2>> stderr.log"` invoked via wscript.exe.
    # wscript.exe is a Windows-subsystem host so no console pops;
    # `cmd /S /c` strips its outer quote pair and runs the rest as a
    # single command line; the `>>` and `2>>` redirections are
    # interpreted by cmd, not the runtime, so senda's normal
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
    # The SENDA_ARGS comment line at the top is the canonical
    # source of args for the desktop app's idempotency check
    # (current_windows_task_args in desktop/src/mesh.rs reads it).
    # Don't remove it.
    param([string]$Bin, [string]$ArgString)

    $vbsPath = Join-Path $InstallDir 'senda-launch.vbs'

    # SENDA_ARGS / SENDA_BIN / SENDA_LOGDIR are
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
    # and that fallback collapses to `./.cache/huggingface/hub` -
    # whichever process's CWD launched the runtime. Two CWDs => two
    # caches => a model the user "downloaded" via the dashboard is
    # invisible to the startup-loading task => the runtime silently
    # restarts a multi-GB download on every "make this my startup
    # model" click. Setting the env var here pins it. Mirror in
    # desktop/src/mesh.rs::REGISTER_TASK_PS and main.rs.
    $hfCacheDir = Join-Path $env:LOCALAPPDATA 'huggingface\hub'
    if (-not (Test-Path $hfCacheDir)) { New-Item -ItemType Directory -Force -Path $hfCacheDir | Out-Null }
    $userProfile = $env:USERPROFILE
    if (-not $userProfile) { $userProfile = $env:HOMEDRIVE + $env:HOMEPATH }
    $configToml = Join-Path $userProfile '.senda\config.toml'

    $vbs = @"
' Auto-generated by Senda installer. Do not edit by hand;
' reinstall the runtime to regenerate. See install.ps1::Write-LaunchVbs
' and desktop/src/mesh.rs::REGISTER_TASK_PS for the same wrapper used
' by the desktop app's auto-install path.
'
' SENDA_BIN: ${Bin}
' SENDA_ARGS: ${ArgString}
' SENDA_LOGDIR: ${LogDir}
' SENDA_HF_HUB_CACHE: ${hfCacheDir}
' SENDA_CONFIG: ${configToml}
Option Explicit
Dim sh, fso, cmd, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FolderExists("${LogDir}") Then fso.CreateFolder("${LogDir}")
If Not fso.FolderExists("${hfCacheDir}") Then fso.CreateFolder("${hfCacheDir}")
' Pin HOME + config so Scheduled Task always reads %USERPROFILE%\.senda\config.toml
sh.Environment("PROCESS")("HOME") = "${userProfile}"
sh.Environment("PROCESS")("USERPROFILE") = "${userProfile}"
sh.Environment("PROCESS")("SENDA_CONFIG") = "${configToml}"
' Pin the HuggingFace cache for THIS process; cmd / senda inherit.
sh.Environment("PROCESS")("HF_HUB_CACHE") = "${hfCacheDir}"
' Keep logs across restarts so crash-loops remain diagnosable.
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

    Write-Warn2 'No GPU detected - falling back to Vulkan flavor (CPU-only path TBD on Windows).'
    return 'vulkan'
}

function Get-Target {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -ne 'AMD64' -and $arch -ne 'x86_64') {
        Write-Err "Senda on Windows requires x86_64. Detected: $arch"
        Write-Err "ARM64 Windows is not yet supported. Build from source: https://github.com/$Repo"
        throw 'Unsupported architecture.'
    }

    $flavor = Detect-Backend
    if ($flavor -notin @('cuda', 'vulkan')) {
        Write-Err "Unsupported Windows backend: $flavor"
        Write-Err "Set `$env:SENDA_BACKEND = 'cuda' or 'vulkan' to override."
        throw 'Unsupported backend.'
    }
    return "windows-x86_64-$flavor"
}

function Download-Binary {
    param([string]$Target)

    $asset = "senda-$Target.zip"
    $url = "https://github.com/$Repo/releases/latest/download/$asset"
    $tmp = New-Item -ItemType Directory -Path (Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString()))

    try {
        Write-Info "Downloading $asset from $Repo..."
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile (Join-Path $tmp $asset)
        } catch {
            Write-Err "Failed to download $url"
            Write-Err 'If your hardware does not have a release artifact yet, try'
            Write-Err "  `$env:SENDA_BACKEND = 'vulkan'; iwr -useb https://senda.network/install.ps1 | iex"
            Write-Err 'or build from source: https://github.com/' + $Repo
            throw
        }

        Write-Info 'Extracting...'
        $unpack = Join-Path $tmp 'unpack'
        Expand-Archive -Path (Join-Path $tmp $asset) -DestinationPath $unpack -Force

        $binSrc = Join-Path $unpack 'senda.exe'
        if (-not (Test-Path $binSrc)) {
            throw "Extracted archive did not contain senda.exe at $binSrc"
        }

        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        }

        # Make sure the previous runtime isn't holding the destination
        # binary open. Without this, Copy-Item -Force fails with
        # "The process cannot access the file '...\senda.exe'
        # because it is being used by another process." on every
        # re-install (e.g. user clicks the Setup button while the
        # service is already running).
        Stop-RunningRuntime

        # Drop EVERY file from the runtime ZIP into $InstallDir, not
        # just senda.exe. As of senda-llm v0.66.4 the
        # Windows ZIP is self-contained: senda.exe + rpc-server.exe
        # + llama-server.exe + the full ggml-*.dll fan-out (and on the
        # cuda flavor, cudart_64_*.dll). Pre-this-commit Copy-Item only
        # touched senda.exe and discarded the helpers - so a user
        # who upgraded straight from a release that ALSO had only
        # senda.exe would still see "rpc-server.exe not found".
        # Install-LlamaCppHelpers below remains as a fallback for
        # (older / future) runtime ZIPs that don't bundle them.
        $copied = 0
        Get-ChildItem -Path $unpack -File | ForEach-Object {
            try {
                Copy-Item -Force $_.FullName (Join-Path $InstallDir $_.Name)
                $copied++
            } catch {
                Write-Warn2 ("Could not place $($_.Name): " + $_.Exception.Message)
            }
        }
        Write-Ok "Installed $copied file(s) into $InstallDir (senda.exe + helpers if bundled)."
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

# llama.cpp release tag the runtime is built against. Bump this when the
# runtime upgrades its `.deps/llama.cpp` checkout (see
# `git -C senda-llm/.deps/llama.cpp describe --tags`). The user's
# rpc-server.exe / llama-server.exe must speak the same RPC and CLI
# protocol as the senda.exe in this bundle, and llama.cpp does
# break protocol inside major releases - so keeping the two in lockstep
# matters more than chasing the latest llama.cpp build.
$LlamaCppTag = 'b9041'

# Map senda flavor (the suffix on senda-windows-x86_64-<flavor>.zip)
# to the matching llama.cpp official Windows release.
#
# Why we pull these from ggml-org/llama.cpp instead of bundling them in
# the senda runtime release: as of 0.66.x the senda-llm
# Windows CI pipeline (release.yml::build_windows) only compiles
# senda.exe and skips the llama.cpp bundle (`scripts/release-
# senda.ps1` ships senda.exe + LICENSE + the task XML, end of
# list). So the runtime ZIP genuinely doesn't contain rpc-server.exe or
# llama-server.exe - without this fallback the runtime fails every
# model load with "rpc-server.exe not found in
# C:\Users\...\AppData\Local\senda\bin", which is exactly what
# 0.1.70 users saw. Long-term fix is on the runtime side; until that
# lands, this installer pulls the matching binaries directly from
# llama.cpp's official Windows releases.
function Get-LlamaCppAsset {
    param([string]$Flavor)

    switch ($Flavor) {
        'cuda'   { return "llama-$LlamaCppTag-bin-win-cuda-12.4-x64.zip" }
        'vulkan' { return "llama-$LlamaCppTag-bin-win-vulkan-x64.zip" }
        'cpu'    { return "llama-$LlamaCppTag-bin-win-cpu-x64.zip" }
        default {
            throw "Unsupported flavor for llama.cpp helper download: $Flavor"
        }
    }
}

function Install-LlamaCppHelpers {
    param([string]$Flavor)

    # Idempotency. Two short-circuits:
    #
    #   1. If our stamp matches "$LlamaCppTag/$Flavor", we already
    #      installed this exact version; skip.
    #   2. If rpc-server.exe + llama-server.exe + at least one ggml
    #      dll are already on disk, the runtime ZIP just shipped them
    #      (senda-llm v0.66.4+ bundles helpers natively). We
    #      don't know exactly which llama.cpp version the runtime
    #      bundled, but we trust the runtime's choice over ours, so
    #      skip and write the stamp as "bundled".
    #
    # Without short-circuit #2 every Setup-button click would
    # re-download a 70MB ZIP from ggml-org just to install the same
    # files the runtime already dropped seconds earlier.
    $stamp = Join-Path $InstallDir '.llama-cpp-version'
    $rpc = Join-Path $InstallDir 'rpc-server.exe'
    $srv = Join-Path $InstallDir 'llama-server.exe'

    if ((Test-Path $stamp) -and (Test-Path $rpc) -and (Test-Path $srv)) {
        $current = (Get-Content -Path $stamp -Raw -ErrorAction SilentlyContinue).Trim()
        if ($current -eq "$LlamaCppTag/$Flavor") {
            Write-Info "llama.cpp helpers already at $LlamaCppTag/$Flavor; skipping download."
            return
        }
    }

    if ((Test-Path $rpc) -and (Test-Path $srv)) {
        # ggml-base.dll ships in every flavor of llama.cpp's Windows
        # release; its presence is a good proxy for "the helpers
        # actually have their DLL deps next to them." On Windows
        # without a *.dll set the helpers fail to load with the
        # opaque exit 0xC0000135.
        $hasGgml = Get-ChildItem -Path $InstallDir -Filter 'ggml-base.dll' -File -ErrorAction SilentlyContinue
        if ($hasGgml) {
            Write-Info "llama.cpp helpers already bundled by the runtime; skipping ggml-org download."
            Set-Content -Path $stamp -Value "bundled/$Flavor" -NoNewline -Encoding ASCII
            return
        }
    }

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    }

    $asset = Get-LlamaCppAsset -Flavor $Flavor
    $url = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaCppTag/$asset"
    $tmp = New-Item -ItemType Directory -Path (Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString()))

    try {
        Write-Info "Fetching llama.cpp $LlamaCppTag helpers ($asset)..."
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile (Join-Path $tmp $asset)
        } catch {
            Write-Err "Failed to download $url"
            Write-Err 'The runtime needs rpc-server.exe / llama-server.exe to host models.'
            Write-Err 'Without these, senda.exe joins the mesh but cannot load any local model.'
            throw
        }

        $extractDir = Join-Path $tmp 'llama'
        Expand-Archive -Path (Join-Path $tmp $asset) -DestinationPath $extractDir -Force

        # llama.cpp's Windows ZIPs unpack flat (rpc-server.exe and *.dll
        # at the root). Defensive against a future layout change: search
        # recursively and fall over only if the two helpers are missing.
        $rpcSrc = Get-ChildItem -Path $extractDir -Filter 'rpc-server.exe' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        $srvSrc = Get-ChildItem -Path $extractDir -Filter 'llama-server.exe' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $rpcSrc -or -not $srvSrc) {
            throw "llama.cpp $LlamaCppTag $Flavor build did not contain rpc-server.exe / llama-server.exe in $extractDir"
        }

        # The runtime is currently shut down by Stop-RunningRuntime
        # (called from Download-Binary right before this) so DLLs can
        # be replaced cleanly. Belt-and-braces: if a wscript launcher
        # somehow restarted the runtime, we tolerate Copy-Item failure
        # on individual DLLs rather than blow up the whole install.
        Stop-RunningRuntime

        Copy-Item -Force $rpcSrc.FullName (Join-Path $InstallDir 'rpc-server.exe')
        Copy-Item -Force $srvSrc.FullName (Join-Path $InstallDir 'llama-server.exe')

        # Drop every shipped DLL next to the helpers. Both rpc-server
        # and llama-server depend on a fan-out of ggml-*.dll variants
        # (ggml-base, ggml-cpu-<isa>, ggml-vulkan / ggml-cuda, ...) that
        # they LoadLibrary at runtime. Missing any one of them surfaces
        # as an opaque exit code 0xC0000135 with no stderr - easier to
        # just install the whole DLL set.
        $dllSrcDir = $rpcSrc.DirectoryName
        Get-ChildItem -Path $dllSrcDir -Filter '*.dll' -File -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                Copy-Item -Force $_.FullName (Join-Path $InstallDir $_.Name)
            } catch {
                Write-Warn2 ("Could not replace $($_.Name) (in use?): " + $_.Exception.Message)
            }
        }

        # CUDA flavor: also drop the CUDA runtime DLLs the helpers
        # link against. llama.cpp ships these in a separate `cudart-*`
        # zip on the same release. Users who already have a system
        # CUDA install will just see overwrites; everyone else needs
        # them to load any model at all.
        if ($Flavor -eq 'cuda') {
            $cudartAsset = "cudart-llama-bin-win-cuda-12.4-x64.zip"
            $cudartUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaCppTag/$cudartAsset"
            try {
                Write-Info "Fetching CUDA runtime DLLs ($cudartAsset)..."
                Invoke-WebRequest -UseBasicParsing -Uri $cudartUrl -OutFile (Join-Path $tmp $cudartAsset)
                $cudartDir = Join-Path $tmp 'cudart'
                Expand-Archive -Path (Join-Path $tmp $cudartAsset) -DestinationPath $cudartDir -Force
                Get-ChildItem -Path $cudartDir -Filter '*.dll' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                    try {
                        Copy-Item -Force $_.FullName (Join-Path $InstallDir $_.Name)
                    } catch {
                        Write-Warn2 ("Could not replace $($_.Name) (in use?): " + $_.Exception.Message)
                    }
                }
            } catch {
                Write-Warn2 "Could not fetch $cudartAsset - CUDA models may fail to load with 0xC0000135."
                Write-Warn2 "Manually install the CUDA 12.4 runtime if that happens, or set SENDA_BACKEND=vulkan."
            }
        }

        Set-Content -Path $stamp -Value "$LlamaCppTag/$Flavor" -NoNewline -Encoding ASCII
        Write-Ok  "Installed llama.cpp $LlamaCppTag $Flavor helpers in $InstallDir"
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

function Install-ScheduledTaskUnit {
    $bin = Join-Path $InstallDir 'senda.exe'
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
    # eaten it - wrap in try/catch so a missing task is silently OK.
    try { schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null } catch { }

    # `serve --auto --publish --mesh-name senda ...` discovers and
    # joins the public Senda through the canonical entry node at
    # entry.senda.network, AND advertises this node on Nostr so peers
    # and the public entry can find it. Without --publish senda.network
    # shows "0 models" even when joined.
    #
    # `--join-url` is preferred (the runtime re-fetches the token on
    # every restart so an entry-node key rotation doesn't strand
    # installs), but we only embed it when the installed CLI actually
    # understands the flag - senda-llm < v0.65.0 crashloops with
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
        $joinSegment = ' --join-url https://entry.senda.network/api/status'
        Write-Info 'CLI supports --join-url; embedding it in the Scheduled Task.'
    } else {
        $token = $null
        try {
            $resp  = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 -Uri 'https://entry.senda.network/api/status'
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

    # Override the runtime's default Iroh relay map: senda-llm v0.65.0-rc2
    # ships *.michaelneale.mesh-llm.iroh.link defaults that no longer resolve,
    # so without these the runtime can't tunnel through NAT to the public
    # entry node and senda.network shows "0 models". n0's canary relays
    # are publicly maintained.
    $relayArgs = '--relay https://use1-1.relay.n0.iroh-canary.iroh.link./ --relay https://euw-1.relay.n0.iroh-canary.iroh.link./'
    $argString = "serve --auto --publish --mesh-name senda${joinSegment} ${relayArgs} --headless"

    # Wrap the runtime in a hidden VBS launcher so login doesn't pop a
    # Windows Terminal tab. See Write-LaunchVbs for the rationale.
    # We also Stop-RunningRuntime first so the previous wscript host
    # releases its lock on senda-launch.vbs before we rewrite it.
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
        -Description 'Senda - private LLM mesh node' | Out-Null

    Write-Ok "Registered Scheduled Task: $TaskName"

    if (-not $NoStartService) {
        try {
            Start-ScheduledTask -TaskName $TaskName
            Write-Ok 'Started Senda service'
        } catch {
            Write-Warn2 "Could not auto-start the service. Try: Start-ScheduledTask -TaskName $TaskName"
        }
    } else {
        Write-Ok "Service installed (not started). Start later: Start-ScheduledTask -TaskName $TaskName"
    }
}

function Invoke-Install {
    Write-Info 'Installing Senda - private LLM mesh on the compute you already own.'
    Write-Info "Repo:    https://github.com/$Repo"
    Write-Info "Bin dir: $InstallDir"

    $target = Get-Target
    Write-Info "Target:  $target"

    Download-Binary -Target $target

    try {
        $null = & (Join-Path $InstallDir 'senda.exe') --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw "senda --version exited $LASTEXITCODE" }
    } catch {
        Write-Err 'Installed binary did not run cleanly. Aborting.'
        throw
    }

    # Pull rpc-server.exe / llama-server.exe + llama.cpp DLLs from
    # ggml-org/llama.cpp's official Windows release. Without these the
    # runtime joins the mesh but every model load fails immediately
    # with "rpc-server.exe not found in <InstallDir>" (see
    # senda-llm/senda/src/inference/launch.rs::resolve_binary).
    # Long-term this should move into the senda-llm CI bundle.
    # `$target` is "windows-x86_64-<flavor>"; strip the prefix.
    $flavorOnly = $target -replace '^windows-x86_64-', ''
    Install-LlamaCppHelpers -Flavor $flavorOnly

    if ($Service) { Install-ScheduledTaskUnit }

    Add-PathHint

    Write-Host ''
    Write-Host '  Senda installed.'
    Write-Host ''
    Write-Host '  Try:'
    Write-Host '    senda --version'
    Write-Host '    senda serve --auto              # foreground (joins the public mesh)'
    if ($Service) {
        Write-Host "    Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo  # service status"
        Write-Host "    Stop-ScheduledTask -TaskName $TaskName                          # stop the service"
    }
    Write-Host ''
    Write-Host '  Open the chat at https://senda.network (or http://127.0.0.1:42141 if you ran the local app).'
    Write-Host ''
}

# When the script is fetched and piped to iex, the function below is exposed
# so the user can re-invoke with arguments (e.g. -Service). The script also
# runs Invoke-Install once on dot-source unless SENDA_INSTALL_NO_AUTO=1.
function senda-install {
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

if (-not $env:SENDA_INSTALL_NO_AUTO) {
    Invoke-Install
}
