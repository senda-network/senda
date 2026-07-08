#!/usr/bin/env bash
# Senda installer — macOS arm64, Linux x86_64/aarch64.
#
#   curl -fsSL https://senda.network/install | sh
#   curl -fsSL https://senda.network/install | sh -s -- --service
#
# What it does:
#   1. Detects OS, CPU arch, and (on Linux) preferred GPU backend.
#   2. Downloads the matching senda release tarball from GitHub.
#   3. Installs the `senda` binary into ~/.local/bin (or $SENDA_INSTALL_DIR).
#   4. With --service: installs an OS-native autostart unit:
#        - macOS: launchd LaunchAgent (~/Library/LaunchAgents)
#        - Linux: systemd --user unit (~/.config/systemd/user)
#
# No Apple Developer account, no Xcode, no compilation. Just a binary download
# into your home directory. Uninstall with: senda service stop && rm -rf
# ~/.local/bin/senda.
#
# Backend override (Linux):
#   SENDA_BACKEND=cuda|rocm|vulkan|cpu  curl ... | sh

set -euo pipefail

REPO="${SENDA_INSTALL_REPO:-${FORGEMESH_INSTALL_REPO:-senda-network/senda-llm}}"
INSTALL_DIR="${SENDA_INSTALL_DIR:-${FORGEMESH_INSTALL_DIR:-$HOME/.local/bin}}"
SERVICE_LABEL="network.senda.runtime"
LINUX_SERVICE_NAME="senda"
DATA_DIR="$HOME/.senda"
LEGACY_FORGEMESH_DIR="$HOME/.forgemesh"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
LAUNCHD_PLIST="$LAUNCHD_DIR/$SERVICE_LABEL.plist"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SYSTEMD_UNIT="$SYSTEMD_USER_DIR/$LINUX_SERVICE_NAME.service"
LOG_DIR_DARWIN="$HOME/Library/Logs/senda"
LOG_DIR_LINUX="$HOME/.local/state/senda"
INSTALL_SERVICE=0
START_SERVICE=1

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info()  { color "0;36" "[senda] $*"; }
ok()    { color "0;32" "[senda] $*"; }
warn()  { color "0;33" "[senda] $*"; }
err()   { color "0;31" "[senda] $*" >&2; }

usage() {
    cat <<EOF
Senda installer

Usage:
  curl -fsSL https://senda.network/install | sh
  curl -fsSL https://senda.network/install | sh -s -- [options]

Options:
  --service              Also install and start an OS-native autostart unit.
                         (launchd on macOS, systemd --user on Linux.)
  --no-start-service     With --service, install the unit but don't start it yet.
  -h, --help             Show this help.

Environment:
  SENDA_INSTALL_REPO   GitHub repo to pull releases from (default: senda-network/senda-llm)
  SENDA_INSTALL_DIR    Where to put the binary (default: \$HOME/.local/bin)
  SENDA_BACKEND        Force a Linux GPU backend (cuda, rocm, vulkan, cpu).
                            Overrides auto-detection. Useful when probing fails
                            on exotic hardware. Ignored on macOS.
EOF
}

while (($# > 0)); do
    case "$1" in
        --service)            INSTALL_SERVICE=1 ;;
        --no-start-service)   START_SERVICE=0 ;;
        -h|--help)            usage; exit 0 ;;
        *)                    err "unknown option: $1"; usage >&2; exit 1 ;;
    esac
    shift
done

require() {
    if ! command -v "$1" >/dev/null 2>&1; then
        err "required command not found: $1"
        exit 1
    fi
}

# detect_target — produce the platform-suffix used in the release asset name.
#
# Returns one of (matches the matrix in senda-llm/scripts/release-senda.sh):
#   darwin-aarch64
#   linux-x86_64-{cpu,cuda,rocm,vulkan}
#   linux-aarch64-{cpu,vulkan}
#
# Anything else -> aborts with a "build from source" message.
detect_target() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$arch" in
        x86_64|amd64) arch="x86_64" ;;
        arm64|aarch64) arch="aarch64" ;;
    esac

    case "$os" in
        Darwin)
            if [[ "$arch" != "aarch64" ]]; then
                err "Senda on macOS requires Apple Silicon (arm64). Detected Intel Mac."
                err "Build from source: https://github.com/$REPO"
                exit 1
            fi
            echo "darwin-aarch64"
            return 0
            ;;
        Linux)
            local backend
            backend="${SENDA_BACKEND:-$(detect_linux_backend)}"
            case "$arch/$backend" in
                x86_64/cuda|x86_64/rocm|x86_64/vulkan|x86_64/cpu)
                    echo "linux-x86_64-$backend"
                    return 0
                    ;;
                aarch64/vulkan|aarch64/cpu)
                    echo "linux-aarch64-$backend"
                    return 0
                    ;;
                aarch64/cuda)
                    # Jetson / NVIDIA ARM. Not yet shipping a tarball — fall back to CPU
                    # so installs succeed and CUDA acceleration kicks in once we ship.
                    warn "No CUDA tarball for aarch64 yet; falling back to CPU backend."
                    echo "linux-aarch64-cpu"
                    return 0
                    ;;
                *)
                    err "Unsupported Linux target: $arch with backend $backend."
                    err "Set SENDA_BACKEND=cpu|cuda|rocm|vulkan to override."
                    err "Or build from source: https://github.com/$REPO"
                    exit 1
                    ;;
            esac
            ;;
        *)
            err "Senda ships pre-built binaries for macOS arm64 and Linux only."
            err "Detected: $os $arch."
            err "On Windows, install via PowerShell:"
            err "  iwr -useb https://senda.network/install.ps1 | iex"
            err "Or build from source: https://github.com/$REPO"
            exit 1
            ;;
    esac
}

# detect_linux_backend — pick a reasonable default GPU backend on Linux.
#
# Priority: NVIDIA -> AMD -> Intel/Vulkan -> CPU. Probes both running drivers
# (e.g. nvidia-smi) and present devices via /sys, so it works in containers
# without nvidia-smi installed (e.g. podman with --device=nvidia.com/gpu).
detect_linux_backend() {
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
        echo cuda; return
    fi
    if [[ -e /proc/driver/nvidia/version ]]; then
        echo cuda; return
    fi
    if command -v rocminfo >/dev/null 2>&1 && rocminfo >/dev/null 2>&1; then
        echo rocm; return
    fi
    if [[ -e /dev/kfd ]]; then
        echo rocm; return
    fi
    if command -v vulkaninfo >/dev/null 2>&1 && vulkaninfo --summary >/dev/null 2>&1; then
        echo vulkan; return
    fi
    # /dev/dri/renderD* is the catch-all for "this machine has a GPU we could
    # talk to via Vulkan if vulkaninfo were installed."
    if compgen -G "/dev/dri/renderD*" >/dev/null 2>&1; then
        echo vulkan; return
    fi
    echo cpu
}

asset_extension_for_target() {
    case "$1" in
        windows-*) echo "zip" ;;
        *)         echo "tar.gz" ;;
    esac
}

legacy_dir_hint() {
    if [[ -d "$LEGACY_FORGEMESH_DIR" && ! -d "$DATA_DIR" ]]; then
        warn "Found legacy data at $LEGACY_FORGEMESH_DIR. Senda will auto-migrate"
        warn "it to $DATA_DIR on first launch, or you can do it now:"
        warn "  mv $LEGACY_FORGEMESH_DIR $DATA_DIR"
    fi
}

download_binary() {
    local target="$1"
    local ext
    ext="$(asset_extension_for_target "$target")"
    local asset="senda-${target}.${ext}"
    local url="https://github.com/${REPO}/releases/latest/download/${asset}"
    local tmpdir
    tmpdir="$(mktemp -d)"
    trap "rm -rf '$tmpdir'" RETURN

    info "Downloading ${asset} from ${REPO}…"
    if ! curl -fsSL --retry 3 "$url" -o "$tmpdir/$asset"; then
        err "Failed to download $url"
        err "If your hardware doesn't have a release artifact yet, try"
        err "  SENDA_BACKEND=cpu curl -fsSL https://senda.network/install | sh"
        err "or build from source: cd $REPO && cargo build --release"
        exit 1
    fi

    info "Extracting…"
    case "$ext" in
        tar.gz) tar -xzf "$tmpdir/$asset" -C "$tmpdir" ;;
        zip)    require unzip; unzip -q "$tmpdir/$asset" -d "$tmpdir" ;;
    esac

    if [[ ! -x "$tmpdir/senda" ]]; then
        err "Extracted tarball did not contain a 'senda' executable."
        exit 1
    fi

    mkdir -p "$INSTALL_DIR"
    install -m 0755 "$tmpdir/senda" "$INSTALL_DIR/senda"

    # For macOS metal and Linux CPU, release-senda.sh packs the full
    # llama.cpp runtime (rpc-server-<flavor>, llama-server-<flavor>,
    # llama-moe-{analyze,split}, and any runtime shared libs) into the same
    # tarball. Copy those out too so the runtime can actually spawn llama.cpp
    # after install — otherwise the user hits `rpc-server not found in
    # ~/.local/bin` the first time they try to serve a model.
    install_bundled_runtime_from "$tmpdir"

    ok "Installed: $INSTALL_DIR/senda"
}

# install_bundled_runtime_from <dir> — copy any llama.cpp runtime binaries and
# shared libs from <dir> into $INSTALL_DIR. Idempotent; safe to call on a dir
# that happens not to contain them (e.g. GPU-flavored slim tarballs).
install_bundled_runtime_from() {
    local src="$1"
    local name
    for name in rpc-server llama-server; do
        for variant in "${name}-metal" "${name}-cpu" "${name}-cuda" "${name}-rocm" "${name}-vulkan" "$name"; do
            if [[ -f "$src/$variant" ]]; then
                install -m 0755 "$src/$variant" "$INSTALL_DIR/$variant"
            fi
        done
    done
    for name in llama-moe-analyze llama-moe-split; do
        if [[ -f "$src/$name" ]]; then
            install -m 0755 "$src/$name" "$INSTALL_DIR/$name"
        fi
    done
    shopt -s nullglob
    local libs=()
    libs+=("$src"/*.dylib "$src"/*.so "$src"/*.so.*)
    shopt -u nullglob
    if (( ${#libs[@]} > 0 )); then
        local lib
        for lib in "${libs[@]}"; do
            install -m 0644 "$lib" "$INSTALL_DIR/"
        done
    fi
}

# download_llama_runtime_if_needed <target> — on Linux GPU flavors the slim
# installer tarball ships only the main `senda` binary. Fetch the matching
# `senda-v<version>-<target>.tar.gz` (produced by package-release.sh) for
# the llama.cpp runtime binaries + GPU shared libraries and drop them next to
# `senda` in $INSTALL_DIR.
#
# No-op on macOS and Linux CPU — those targets ship the runtime in the main
# tarball already.
download_llama_runtime_if_needed() {
    local target="$1"
    case "$target" in
        linux-x86_64-cuda|linux-x86_64-rocm|linux-x86_64-vulkan|linux-aarch64-vulkan)
            ;;
        *) return 0 ;;
    esac

    local version
    version="$("$INSTALL_DIR/senda" --version 2>/dev/null | awk '{print $2}')"
    if [[ -z "$version" ]]; then
        warn "Could not determine senda version — skipping GPU runtime download."
        warn "Install it manually from https://github.com/$REPO/releases/latest"
        return 0
    fi

    local asset="senda-v${version}-${target}.tar.gz"
    local url="https://github.com/${REPO}/releases/download/v${version}/${asset}"
    local tmpdir
    tmpdir="$(mktemp -d)"
    trap "rm -rf '$tmpdir'" RETURN

    info "Downloading llama.cpp GPU runtime (${asset})…"
    if ! curl -fsSL --retry 3 "$url" -o "$tmpdir/$asset"; then
        warn "Failed to download $url"
        warn "The main senda binary is installed, but the llama.cpp GPU runtime is not."
        warn "Serve mode will fail with 'rpc-server not found' until the runtime is in place."
        warn "You can install it later with:"
        warn "  curl -fsSL $url | tar -xz -C '$INSTALL_DIR' --strip-components=1"
        return 0
    fi

    tar -xzf "$tmpdir/$asset" -C "$tmpdir"
    if [[ ! -d "$tmpdir/mesh-bundle" ]]; then
        warn "Unexpected archive layout in $asset (no mesh-bundle/ dir). Skipping runtime install."
        return 0
    fi

    install_bundled_runtime_from "$tmpdir/mesh-bundle"
    ok "Installed llama.cpp GPU runtime for $target"
}

install_from_local_build() {
    # If the caller already has a local build (rare; mostly for the host
    # who shipped the release), allow installing from that path via env.
    local src="${SENDA_LOCAL_BINARY:-${FORGEMESH_LOCAL_BINARY:-}}"
    if [[ -n "$src" && -x "$src" ]]; then
        mkdir -p "$INSTALL_DIR"
        install -m 0755 "$src" "$INSTALL_DIR/senda"
        ok "Installed (from local build): $INSTALL_DIR/senda"
        return 0
    fi
    return 1
}

# cli_supports_join_url — does the just-installed binary understand the
# `--join-url` flag? We grep `serve --help` (and the fuller
# `serve --help-advanced` because clap-derive sometimes hides advanced
# flags from the short help). Older releases (pre-v0.65.0) crash on
# launch with `error: unexpected argument '--join-url'`, so on those
# we have to use a literal `--join <token>` instead.
cli_supports_join_url() {
    local bin="$1"
    "$bin" serve --help 2>&1 | grep -q -- '--join-url' && return 0
    "$bin" serve --help-advanced 2>&1 | grep -q -- '--join-url' && return 0
    return 1
}

# fetch_entry_token — pull a fresh invite token from the canonical
# entry node's HTTP API. Used as a fallback when the installed binary
# doesn't speak `--join-url`. Returns empty on any failure; the caller
# treats that as "skip the --join arg, fall back to Nostr auto-discovery".
fetch_entry_token() {
    curl -fsSL --max-time 6 https://entry.senda.network/api/status 2>/dev/null \
        | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' \
        | head -1
}

# build_join_args — emit either `--join-url <URL>` or `--join <TOKEN>`
# (or nothing) into the array variable named by $1. Bash 3-compatible
# (macOS still ships /bin/bash 3.2): we just append to a global array.
JOIN_ARGS=()
build_join_args() {
    local bin="$1"
    JOIN_ARGS=()
    if cli_supports_join_url "$bin"; then
        JOIN_ARGS=( "--join-url" "https://entry.senda.network/api/status" )
        info "CLI supports --join-url; embedding it in the service unit."
        return
    fi
    local token
    token="$(fetch_entry_token)"
    if [[ -n "$token" ]]; then
        JOIN_ARGS=( "--join" "$token" )
        info "Older CLI without --join-url; embedded a fresh invite token."
        return
    fi
    warn "Could not embed a join arg (older CLI, entry node unreachable)."
    warn "Service will fall back to Nostr auto-discovery."
}

write_launchd_plist() {
    mkdir -p "$LAUNCHD_DIR" "$LOG_DIR_DARWIN" "$DATA_DIR"
    # Args, in order:
    #   serve --auto --publish --mesh-name senda
    #     <--join-url URL> | <--join TOKEN> | (nothing — Nostr fallback)
    #     --headless
    #
    # `--auto` discovers, `--publish` advertises this node on Nostr so
    # peers + the public entry node behind entry.senda.network can find
    # it (without --publish senda.network shows "0 models" even when
    # joined — see desktop/src/mesh.rs). `--mesh-name senda`
    # disambiguates from the unnamed community pool.
    #
    # `--join-url` is the bootstrap pointer to the canonical entry node:
    # on startup the runtime re-fetches the URL, pulls the entry's
    # current invite token, and treats it as `--join <token>`. So an
    # entry-node restart that rotates its keys doesn't permanently
    # strand existing installs. We only embed `--join-url` when the
    # installed CLI actually understands it (senda-llm v0.65.0+);
    # older CLIs would crashloop. For older CLIs we embed a literal
    # `--join <token>` fetched at install-time instead.
    #
    # `--headless` keeps the embedded web console on its loopback port
    # but turns off the TTY UI (launchd has no real terminal).
    build_join_args "$INSTALL_DIR/senda"
    local args_xml=""
    args_xml+="        <string>${INSTALL_DIR}/senda</string>
"
    args_xml+="        <string>serve</string>
"
    args_xml+="        <string>--auto</string>
"
    args_xml+="        <string>--publish</string>
"
    args_xml+="        <string>--mesh-name</string>
"
    args_xml+="        <string>senda</string>
"
    local a
    for a in "${JOIN_ARGS[@]}"; do
        args_xml+="        <string>${a}</string>
"
    done
    # Override the runtime's default Iroh relay map. Without this the
    # senda-llm v0.65.0-rc2 binary uses a *.michaelneale.mesh-llm.iroh.link
    # default that no longer resolves, the runtime can't tunnel back to the
    # public entry node behind entry.senda.network, and senda.network shows
    # "Mesh online · 0 models" even with a model loaded locally. n0's canary
    # relays are publicly maintained by the iroh team.
    args_xml+="        <string>--relay</string>
"
    args_xml+="        <string>https://use1-1.relay.n0.iroh-canary.iroh.link./</string>
"
    args_xml+="        <string>--relay</string>
"
    args_xml+="        <string>https://euw-1.relay.n0.iroh-canary.iroh.link./</string>
"
    args_xml+="        <string>--headless</string>"

    cat >"$LAUNCHD_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args_xml}
    </array>
    <key>WorkingDirectory</key>
    <string>${HOME}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${LOG_DIR_DARWIN}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR_DARWIN}/stderr.log</string>
</dict>
</plist>
PLIST
    ok "Wrote launchd agent: $LAUNCHD_PLIST"
}

start_launchd_service() {
    local target="gui/$(id -u)"
    launchctl bootout "$target/$SERVICE_LABEL" >/dev/null 2>&1 || true
    if launchctl bootstrap "$target" "$LAUNCHD_PLIST" >/dev/null 2>&1; then
        ok "Started Senda service ($SERVICE_LABEL)"
    else
        warn "Could not auto-start the service. Try: senda service start"
    fi
}

write_systemd_user_unit() {
    if ! command -v systemctl >/dev/null 2>&1; then
        warn "systemctl not found — skipping --service install."
        warn "Run manually: $INSTALL_DIR/senda serve --auto --mesh-name senda"
        return 1
    fi

    mkdir -p "$SYSTEMD_USER_DIR" "$LOG_DIR_LINUX" "$DATA_DIR"
    build_join_args "$INSTALL_DIR/senda"
    local exec_join=""
    local a
    for a in "${JOIN_ARGS[@]}"; do
        # systemd ExecStart is a single line; quote nothing but rely on
        # the absence of spaces in tokens / URLs we control.
        exec_join+=" ${a}"
    done
    cat >"$SYSTEMD_UNIT" <<UNIT
[Unit]
Description=Senda — peer-to-peer LLM mesh node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/senda serve --auto --publish --mesh-name senda${exec_join} --relay https://use1-1.relay.n0.iroh-canary.iroh.link./ --relay https://euw-1.relay.n0.iroh-canary.iroh.link./ --headless
WorkingDirectory=${HOME}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_DIR_LINUX}/stdout.log
StandardError=append:${LOG_DIR_LINUX}/stderr.log

[Install]
WantedBy=default.target
UNIT
    ok "Wrote systemd user unit: $SYSTEMD_UNIT"
    return 0
}

start_systemd_service() {
    if ! systemctl --user daemon-reload >/dev/null 2>&1; then
        warn "systemctl --user daemon-reload failed (no user session bus?)."
        warn "Try logging out + back in, then: systemctl --user enable --now senda"
        return 1
    fi
    if systemctl --user enable --now "$LINUX_SERVICE_NAME" >/dev/null 2>&1; then
        ok "Started Senda user service ($LINUX_SERVICE_NAME)"
        # Linger keeps the service running when the user logs out — opt-in
        # because it requires `loginctl enable-linger` (no sudo on most distros
        # but technically a privileged op).
        info "To keep Senda running when you log out:"
        info "  loginctl enable-linger \$USER"
    else
        warn "Could not auto-start the service. Try: systemctl --user enable --now $LINUX_SERVICE_NAME"
    fi
}

install_service() {
    case "$(uname -s)" in
        Darwin)
            write_launchd_plist
            if (( START_SERVICE )); then
                start_launchd_service
            else
                ok "Service installed (not started). Start later: senda service start"
            fi
            ;;
        Linux)
            if write_systemd_user_unit && (( START_SERVICE )); then
                start_systemd_service
            elif (( ! START_SERVICE )); then
                ok "Service installed (not started). Start later: systemctl --user enable --now $LINUX_SERVICE_NAME"
            fi
            ;;
        *)
            warn "--service is not supported on this OS yet."
            ;;
    esac
}

# Drop a default ~/.senda/config.toml on first install so the runtime
# has something to load. `senda serve` exits with a "needs at least one
# startup model" warning if neither config nor --model is supplied; that's
# the right behavior for the CLI but a bad first-run experience for the
# desktop app, which can't easily edit launchd args after the fact. The
# stub here lists the recommended-for-Apple-Silicon model commented out so
# users can uncomment after `senda download Qwen3-8B-Q4_K_M`.
seed_default_config() {
    mkdir -p "$DATA_DIR"
    local cfg="$DATA_DIR/config.toml"
    if [[ -f "$cfg" ]]; then
        info "Existing config preserved: $cfg"
        return 0
    fi
    cat >"$cfg" <<'TOML'
# Senda node config — written by the installer on first run.
#
# At least one [[models]] entry must be uncommented (and the matching
# model downloaded with `senda download <id>`) before the runtime
# will start serving. Pick whichever fits your machine:
#
#   senda gpus                       # what backend / how much VRAM
#   senda models recommended         # the curated catalog
#   senda download Qwen3-8B-Q4_K_M   # ~5 GB, fits an M2/M3 Mac
#
# Then uncomment the matching block below and restart the service:
#
#   senda service stop
#   senda service start

# [[models]]
# model = "Qwen3-8B-Q4_K_M"
# ctx_size = 8192

# [[models]]
# model = "Qwen2.5-3B-Instruct-Q4_K_M"
# ctx_size = 4096
TOML
    ok "Wrote starter config: $cfg"
}

ensure_path_hint() {
    case ":$PATH:" in
        *":$INSTALL_DIR:"*) return 0 ;;
    esac
    warn "Note: $INSTALL_DIR is not on your PATH."
    case "$(uname -s)" in
        Darwin) warn "Add this to ~/.zshrc:  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
        Linux)  warn "Add this to ~/.bashrc / ~/.zshrc:  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
    esac
}

main() {
    require curl
    require tar

    info "Installing Senda — private LLM mesh on the compute you already own."
    info "Repo:    https://github.com/$REPO"
    info "Bin dir: $INSTALL_DIR"

    local target
    target="$(detect_target)"
    info "Target:  $target"

    legacy_dir_hint

    if ! install_from_local_build; then
        download_binary "$target"
    fi

    "$INSTALL_DIR/senda" --version >/dev/null 2>&1 || {
        err "Installed binary did not run cleanly. Aborting."
        exit 1
    }

    download_llama_runtime_if_needed "$target"

    seed_default_config

    if (( INSTALL_SERVICE )); then
        install_service
    fi

    ensure_path_hint

    cat <<EOF

  Senda installed.

  Try:
    senda --version
    senda serve --auto --mesh-name senda   # foreground (joins the senda public mesh, logs in your terminal)
$( (( INSTALL_SERVICE )) && echo '    senda service status            # check the autostart service' )
$( (( INSTALL_SERVICE )) && echo '    senda service stop              # stop the autostart service' )

  Open the chat at https://senda.network (or http://127.0.0.1:42141 if you ran the local app).

EOF
}

main "$@"
