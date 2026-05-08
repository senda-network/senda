//! Talks to the local `closedmesh` runtime — both the admin HTTP API for
//! status, and the `closedmesh` CLI for service control. Mirrors what the
//! deprecated Swift `MeshService.swift` did, but cross-platform.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Deserialize;

/// Extension trait: hide the Windows console window on every child we spawn.
///
/// Why this exists: the desktop binary is built with
/// `windows_subsystem = "windows"`, i.e. no console of its own. When a
/// console-subsystem child (`closedmesh.exe`, `node.exe`, `tar.exe`,
/// `schtasks.exe`, `taskkill.exe`, `rpc-server.exe`, `llama-server.exe`)
/// is spawned by such a parent on Windows, the OS allocates a *new*
/// console window and attaches the child to it. The window flashes for
/// short-lived children and stays open for long-lived ones (the bundled
/// Node sidecar, in particular, was a permanently-visible black box on
/// every user's screen). On a fresh install the desktop spawns a dozen
/// of these in the first 30 seconds — `tar` to extract the runtime,
/// `closedmesh --version` to verify it, `closedmesh service start`,
/// then the runtime itself spawning `rpc-server` and `llama-server`,
/// each with its own console — and on a Scheduled-Task autostart loop
/// (1 min restart interval, 3 retries) a crash-restart cycle multiplies
/// the count. Users on lower-end Windows boxes reported the cascade as
/// "opening apps and terminals like crazy until it crashed the whole
/// computer", which it effectively was.
///
/// `CREATE_NO_WINDOW` (0x0800_0000) tells `CreateProcess` not to
/// allocate a console for the child. Combined with stdout/stderr
/// redirection (which we already do for the sidecar), the child runs
/// completely headless. No effect on macOS / Linux — the call is
/// compiled away.
pub(crate) trait CommandExtNoWindow {
    fn hide_console(&mut self) -> &mut Self;
}

impl CommandExtNoWindow for Command {
    #[cfg(windows)]
    fn hide_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        self.creation_flags(CREATE_NO_WINDOW)
    }
    #[cfg(not(windows))]
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Debug, Deserialize, Default)]
struct InvitePayload {
    #[serde(default)]
    token: Option<String>,
}

/// Snapshot of the local mesh state, polled from `127.0.0.1:3131/api/status`
/// every few seconds and rendered into the tray tooltip + title.
///
/// `PartialEq` is load-bearing: the tray applies a fresh status to the
/// `NSStatusItem`'s menu only when something actually changed. Replacing
/// the menu mid-track on macOS dismisses an open menu (AppKit drops the
/// `NSMenuTracking` when the menu pointer flips), so blind 5-second
/// rebuilds make the menu look like it "closes on hover".
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MeshStatus {
    pub online: bool,
    pub node_count: usize,
    pub model: Option<String>,
    pub backend: Option<String>,
}

/// Loose deserialization shim for the admin payload. The real schema is
/// richer (see `app/api/status/route.ts`); we only pluck the fields we
/// surface in the tray. Anything missing falls back to a default — the
/// admin API has churned a couple of times during early development and
/// we'd rather degrade gracefully than crash on a missing field.
///
/// Field coverage as of v0.65 of the runtime: the runtime's own
/// `127.0.0.1:3131/api/status` exposes `peers` (an array of remote nodes),
/// `models`, `serving_models`, `node_status`, and `capability` — but
/// neither `online` nor `node_count` nor `nodes` (those names are only
/// emitted by the website's higher-level `/api/status` aggregator). The
/// previous version of this struct only knew about the website's names,
/// so against a live runtime the parse would succeed but every field
/// would be `None`, leaving `online: false` — and the tray's Start/Stop
/// menu item permanently stuck on "Start" while the service was very
/// much running.
#[derive(Debug, Deserialize, Default)]
struct StatusPayload {
    #[serde(default)]
    node_count: Option<usize>,
    #[serde(default)]
    nodes: Option<Vec<NodeRow>>,
    /// Runtime emits this; website aggregator emits `nodes` instead.
    /// Either is treated as proof the runtime is up + a way to count
    /// peers.
    #[serde(default)]
    peers: Option<Vec<NodeRow>>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    model_name: Option<String>,
    #[serde(default)]
    models: Option<Vec<String>>,
    #[serde(default)]
    serving_models: Option<Vec<String>>,
    #[serde(default)]
    loaded_models: Option<Vec<String>>,
    #[serde(default)]
    capability: Option<Capability>,
}

#[derive(Debug, Deserialize, Default)]
struct NodeRow {
    #[serde(default)]
    capability: Option<Capability>,
}

#[derive(Debug, Deserialize, Default)]
struct Capability {
    #[serde(default)]
    backend: Option<String>,
}

const ADMIN_STATUS_URL: &str = "http://127.0.0.1:3131/api/status";
const LEGACY_LOCAL_CONTROLLER_URL: &str = "http://localhost:3000";
const REMOTE_CHAT_URL: &str = "https://closedmesh.com";

/// Returns the URL the WebView should load.
///
/// Order (after Phase 8b — the sidecar is now the default):
///   1. `CLOSEDMESH_APP_URL` env var (dev / staging override)
///   2. `http://127.0.0.1:<sidecar_port>` if the bundled Next.js
///      controller spawned successfully (the common case)
///   3. `http://localhost:3000` if a user-installed launchd controller
///      is still around from before the sidecar (legacy install) AND it
///      positively identifies as a closedmesh controller
///   4. `https://closedmesh.com` as a marketing/install fallback
pub fn preferred_url() -> String {
    if let Ok(u) = std::env::var("CLOSEDMESH_APP_URL") {
        if !u.is_empty() {
            return u;
        }
    }
    if let Some(port) = crate::sidecar::current_port() {
        return format!("http://127.0.0.1:{port}");
    }
    if legacy_controller_up() {
        return LEGACY_LOCAL_CONTROLLER_URL.to_string();
    }
    REMOTE_CHAT_URL.to_string()
}

/// Header the closedmesh controller stamps onto `/api/control/status`
/// responses. The desktop shell looks for it before trusting whatever's on
/// `:3000` to be ours — without the marker we'd happily load an unrelated
/// Next.js / Vite / static server the user happens to be running on the
/// same port into the WebView, which is a confusing failure that's worse
/// than just falling through to closedmesh.com.
const CONTROLLER_HEADER: &str = "x-closedmesh-controller";

/// HTTP probe of `:3000` that *positively* confirms it's the closedmesh
/// controller, not just any server willing to accept a TCP connection.
/// We deliberately don't fall back to a bare TCP probe — a "yes it answered"
/// from someone else's Next.js dev server is exactly the failure we're
/// trying to avoid here.
fn legacy_controller_up() -> bool {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(250))
        .timeout_read(Duration::from_millis(750))
        .build();
    match agent.get("http://127.0.0.1:3000/api/control/status").call() {
        Ok(resp) => resp.header(CONTROLLER_HEADER).is_some(),
        Err(_) => false,
    }
}

/// Where the controller writes stdout/stderr logs. Used by `Sidecar` to
/// redirect Node's output, and by the tray "Show Logs" menu item to
/// reveal the dir in Finder / Explorer / xdg-open.
pub fn default_log_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    if cfg!(target_os = "macos") {
        Some(home.join("Library/Logs/closedmesh"))
    } else if cfg!(target_os = "linux") {
        Some(home.join(".local/state/closedmesh"))
    } else {
        dirs::data_dir().map(|d| d.join("closedmesh").join("logs"))
    }
}

/// One status poll. Returns `MeshStatus::default()` (offline) on any error
/// — the caller renders that as "no mesh detected", which is the right
/// answer whether the runtime is missing, crashed, or just starting up.
pub fn fetch_status() -> MeshStatus {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(800))
        .timeout_read(Duration::from_millis(1500))
        .build();

    // A successful HTTP 200 from the runtime's admin port is itself
    // proof the runtime is up — counting nodes/peers refines the tooltip
    // but doesn't gate the Start/Stop menu item. Treating a parse-able
    // 200 as `online: true` even when the body is unexpected is the
    // safer default; the previous behavior (return `default()` on any
    // missing field) painted "Start ClosedMesh Service" over a service
    // that was actively serving a model.
    let payload: StatusPayload = match agent.get(ADMIN_STATUS_URL).call() {
        Ok(resp) => match resp.into_json() {
            Ok(p) => p,
            Err(_) => {
                return MeshStatus {
                    online: true,
                    node_count: 1,
                    model: None,
                    backend: None,
                };
            }
        },
        Err(_) => return MeshStatus::default(),
    };

    let peer_count = payload
        .peers
        .as_ref()
        .map(|p| p.len())
        .or_else(|| payload.nodes.as_ref().map(|n| n.len()))
        .unwrap_or(0);

    // We talked to the admin port and got JSON back — the runtime is up.
    // `node_count` always includes self (peers + 1), or falls back to
    // the website-aggregator's pre-counted value when the response
    // happens to come from there instead of the runtime directly.
    let node_count = payload.node_count.unwrap_or(peer_count + 1).max(1);

    let model = payload
        .model
        .or(payload.model_name)
        .or_else(|| {
            payload
                .serving_models
                .as_ref()
                .and_then(|m| m.first().cloned())
        })
        .or_else(|| payload.models.as_ref().and_then(|m| m.first().cloned()))
        .or_else(|| {
            payload
                .loaded_models
                .as_ref()
                .and_then(|m| m.first().cloned())
        })
        // Empty placeholders like "(standby)" come back from a router-only
        // entry node when the local runtime is in standby — not useful in
        // the tray title, so suppress them.
        .filter(|m| !m.starts_with('(') && !m.is_empty());

    let backend = payload
        .capability
        .as_ref()
        .and_then(|c| c.backend.clone())
        .or_else(|| {
            payload
                .nodes
                .as_ref()
                .and_then(|n| n.first())
                .and_then(|n| n.capability.as_ref())
                .and_then(|c| c.backend.clone())
        })
        .or_else(|| {
            payload
                .peers
                .as_ref()
                .and_then(|n| n.first())
                .and_then(|n| n.capability.as_ref())
                .and_then(|c| c.backend.clone())
        });

    MeshStatus {
        online: true,
        node_count,
        model,
        backend,
    }
}

// ---------- Service control ---------------------------------------------

/// File-name prefixes that the runtime spawns alongside `closedmesh` and
/// that must therefore live in the same directory. `resolve_binary_path`
/// in the runtime accepts both the generic name (`rpc-server`) and the
/// per-flavor variants (`rpc-server-metal`, `rpc-server-cuda`, …), so
/// any name that equals a prefix or starts with `<prefix>-` qualifies.
///
/// `MOVE_PREFIXES` includes the moe CLI helpers — we ship them in the
/// tarball and want them re-installed during repairs/upgrades — but
/// `REQUIRED_PREFIXES` only includes the two the runtime can't survive
/// without. That asymmetry matters: if a future tarball stops shipping
/// (say) `llama-moe-analyze`, requiring it for `helpers_present` would
/// make every desktop launch re-download the full 42 MB bundle forever.
const MOVE_PREFIXES: &[&str] = &[
    "rpc-server",
    "llama-server",
    "llama-moe-analyze",
    "llama-moe-split",
];
const REQUIRED_PREFIXES: &[&str] = &["rpc-server", "llama-server"];

fn name_matches_prefix(name: &str, prefix: &str) -> bool {
    name == prefix || (name.starts_with(prefix) && name.as_bytes().get(prefix.len()) == Some(&b'-'))
}

/// True if `install_helpers_from_stage` should move this file out of
/// the staging dir into the runtime install dir. Helpers (rpc-server,
/// llama-server, llama-moe-*) qualify everywhere. On Windows we also
/// move every DLL: the llama.cpp build there ships a fan-out of
/// `ggml-*.dll`, `llama.dll`, `llama-common.dll`, `libomp140.x86_64.dll`
/// (and on CUDA, the `cudart_64_*.dll` family), all of which the
/// helpers `LoadLibrary` at runtime. Missing any one of them surfaces
/// as exit `0xC0000135` with no stderr — exactly the silent failure
/// mode 0.1.71 saw when only the .exe helpers got installed.
///
/// We deliberately don't move `closedmesh.exe` here: the upgrade
/// caller has its own "stop service, atomic rename" sequencing for
/// the main binary, and double-handling would race.
fn helper_stage_file_should_move(name: &str) -> bool {
    if name.eq_ignore_ascii_case("closedmesh.exe") || name == "closedmesh" {
        return false;
    }
    if MOVE_PREFIXES
        .iter()
        .any(|prefix| name_matches_prefix(name, prefix))
    {
        return true;
    }
    if cfg!(windows) {
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".dll") {
            return true;
        }
    }
    false
}

/// Returns true iff `dir` contains at least one binary matching every
/// prefix in [`REQUIRED_PREFIXES`]. We require *one* flavor per prefix,
/// not all of them — the tarball for a given platform only ships one
/// flavor (e.g. `-metal` on darwin-aarch64).
fn helpers_present(dir: &Path) -> bool {
    let entries: Vec<String> = match std::fs::read_dir(dir) {
        Ok(it) => it
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect(),
        Err(_) => return false,
    };
    REQUIRED_PREFIXES
        .iter()
        .all(|prefix| entries.iter().any(|name| name_matches_prefix(name, prefix)))
}

/// Move every file in `stage_dir` whose name matches a helper prefix
/// into `dest_dir`, replacing whatever was there. The `closedmesh`
/// binary itself is handled separately by the caller (it has its own
/// "stop service first" sequencing); this function only touches the
/// llama.cpp helpers.
///
/// We use `rename` rather than copy so the swap is atomic — important
/// on a slow disk where a half-replaced helper would crash the running
/// runtime mid-request. `rename` requires same-filesystem; we keep
/// `stage_dir` as a sibling of `dest_dir` to guarantee that.
fn install_helpers_from_stage(stage_dir: &Path, dest_dir: &Path) -> usize {
    let entries = match std::fs::read_dir(stage_dir) {
        Ok(it) => it,
        Err(e) => {
            eprintln!(
                "[closedmesh] helpers: read stage dir {} failed: {e}",
                stage_dir.display()
            );
            return 0;
        }
    };
    let mut moved = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !helper_stage_file_should_move(&name_str) {
            continue;
        }
        let src = entry.path();
        let dst = dest_dir.join(&name);
        if let Err(e) = std::fs::rename(&src, &dst) {
            eprintln!(
                "[closedmesh] helpers: rename {} -> {} failed: {e}",
                src.display(),
                dst.display()
            );
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(&dst) {
                let mut perm = meta.permissions();
                perm.set_mode(0o755);
                let _ = std::fs::set_permissions(&dst, perm);
            }
        }
        #[cfg(target_os = "macos")]
        {
            let _ = Command::new("xattr")
                .args(["-d", "com.apple.quarantine"])
                .arg(&dst)
                .hide_console()
                .output();
        }
        moved += 1;
        eprintln!("[closedmesh] helpers: installed {}", dst.display());
    }
    moved
}

/// Download the latest runtime tarball, extract just the helpers, and
/// install them next to `bin`. Used to repair installs that have a
/// `closedmesh` binary in place (from `install.sh` or a hand-fetched
/// release) but are missing the llama.cpp helpers — without this they
/// crash on the first inference request with `rpc-server not found`.
///
/// The closedmesh binary itself is left untouched: its version is the
/// auto-upgrade thread's responsibility, and we don't want to bounce
/// the service every launch just to refresh helpers.
///
/// Returns `true` only when at least one helper was successfully laid
/// down. The caller uses that signal to decide whether the launchd
/// agent needs a hard bounce — a runtime that crashed earlier on
/// `rpc-server not found` is being restart-throttled by launchd, and
/// without a bootout/bootstrap cycle the user could be stuck waiting
/// minutes for the next KeepAlive retry to kick in.
fn repair_missing_helpers(bin: &Path) -> bool {
    let Some(parent) = bin.parent() else {
        return false;
    };
    if helpers_present(parent) {
        return false;
    }
    eprintln!(
        "[closedmesh] helpers: missing in {}; fetching latest runtime bundle",
        parent.display()
    );
    let Some(asset) = runtime_asset_name() else {
        return false;
    };
    let url = format!("{RUNTIME_RELEASE_BASE}/{asset}");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(120))
        .redirects(8)
        .build();
    let resp = match agent.get(&url).call() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[closedmesh] helpers: download {url} failed: {e}");
            return false;
        }
    };

    let stage_dir = parent.join(".closedmesh.helpers-stage");
    let _ = std::fs::remove_dir_all(&stage_dir);
    if let Err(e) = std::fs::create_dir_all(&stage_dir) {
        eprintln!("[closedmesh] helpers: mkdir staging failed: {e}");
        return false;
    }
    let archive = stage_dir.join(&asset);
    let mut tmp_file = match std::fs::File::create(&archive) {
        Ok(f) => f,
        Err(e) => {
            eprintln!(
                "[closedmesh] helpers: create archive {} failed: {e}",
                archive.display()
            );
            let _ = std::fs::remove_dir_all(&stage_dir);
            return false;
        }
    };
    if let Err(e) = std::io::copy(&mut resp.into_reader(), &mut tmp_file) {
        eprintln!("[closedmesh] helpers: stream failed: {e}");
        let _ = std::fs::remove_dir_all(&stage_dir);
        return false;
    }
    drop(tmp_file);
    let extracted_ok = if asset.ends_with(".tar.gz") {
        extract_tar_gz(&archive, &stage_dir)
    } else if asset.ends_with(".zip") {
        extract_zip(&archive, &stage_dir)
    } else {
        eprintln!("[closedmesh] helpers: unknown archive type for {asset}");
        false
    };
    if !extracted_ok {
        let _ = std::fs::remove_dir_all(&stage_dir);
        return false;
    }
    let _ = std::fs::remove_file(&archive);

    let moved = install_helpers_from_stage(&stage_dir, parent);
    let _ = std::fs::remove_dir_all(&stage_dir);
    eprintln!(
        "[closedmesh] helpers: repair from runtime ZIP complete, {moved} file(s) installed in {}",
        parent.display()
    );

    // Belt-and-braces: even after extracting the runtime ZIP, helpers
    // can still be missing on Windows for two reasons we've actually
    // hit in the wild:
    //
    //   1. The user is running a desktop release that pinned the
    //      runtime asset name to something that 404s (pre-0.1.72
    //      returned "closedmesh-windows-x86_64.zip" but only
    //      "-cuda.zip" / "-vulkan.zip" exist) — install fails silently
    //      and we have no rpc-server.exe.
    //
    //   2. The latest published runtime ZIP is from before
    //      closedmesh-llm v0.66.4 (when scripts/release-closedmesh.ps1
    //      started bundling helpers). The ZIP has only closedmesh.exe
    //      + LICENSE; install_helpers_from_stage moves zero files.
    //
    // Both cases leave the user staring at "rpc-server.exe not found in
    // C:\Users\…\AppData\Local\closedmesh\bin" on every model load.
    // Fall back to llama.cpp's own official Windows release on
    // ggml-org/llama.cpp — exactly what install.ps1 already does for
    // the Setup-button install path. Pin to the same b9041 tag the
    // runtime is built against (see closedmesh-llm/.deps/llama.cpp);
    // protocol drift inside major llama.cpp releases is real and the
    // helpers must speak the same one as closedmesh.exe.
    if !helpers_present(parent) && cfg!(windows) {
        eprintln!(
            "[closedmesh] helpers: still missing after runtime ZIP extraction; \
             falling back to ggml-org/llama.cpp b9041"
        );
        if repair_helpers_from_llama_cpp(parent) {
            return true;
        }
    }

    moved > 0
}

/// Windows-only fallback: pull rpc-server.exe / llama-server.exe and
/// the matching DLL set from llama.cpp's official Windows release on
/// ggml-org/llama.cpp, then drop them into `parent`. Same pin and
/// flavor selection as install.ps1::Install-LlamaCppHelpers — the two
/// must stay in lockstep.
#[cfg(windows)]
fn repair_helpers_from_llama_cpp(parent: &Path) -> bool {
    // Keep this in lockstep with public/install.ps1 ($LlamaCppTag) and
    // closedmesh-llm/scripts/release-closedmesh.ps1 ($LlamaCppTag). The
    // CI bundle and these two fallbacks all need to agree on the same
    // llama.cpp commit so RPC and CLI protocol stay compatible with
    // whatever closedmesh.exe was built against.
    const LLAMA_CPP_TAG: &str = "b9041";

    let flavor = match std::env::var("CLOSEDMESH_BACKEND")
        .ok()
        .map(|v| v.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("cuda") => "cuda-12.4",
        Some("cpu") => "cpu",
        _ => "vulkan",
    };
    let asset = format!("llama-{LLAMA_CPP_TAG}-bin-win-{flavor}-x64.zip");
    let url = format!(
        "https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_CPP_TAG}/{asset}"
    );

    eprintln!("[closedmesh] helpers: ggml-org fallback fetching {url}");

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(180))
        .redirects(8)
        .build();
    let resp = match agent.get(&url).call() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[closedmesh] helpers: ggml-org download failed: {e}");
            return false;
        }
    };

    let stage_dir = parent.join(".closedmesh.helpers-stage-llama");
    let _ = std::fs::remove_dir_all(&stage_dir);
    if let Err(e) = std::fs::create_dir_all(&stage_dir) {
        eprintln!("[closedmesh] helpers: ggml-org mkdir staging failed: {e}");
        return false;
    }
    let archive = stage_dir.join(&asset);
    let mut tmp_file = match std::fs::File::create(&archive) {
        Ok(f) => f,
        Err(e) => {
            eprintln!(
                "[closedmesh] helpers: ggml-org create archive {} failed: {e}",
                archive.display()
            );
            let _ = std::fs::remove_dir_all(&stage_dir);
            return false;
        }
    };
    if let Err(e) = std::io::copy(&mut resp.into_reader(), &mut tmp_file) {
        eprintln!("[closedmesh] helpers: ggml-org stream failed: {e}");
        let _ = std::fs::remove_dir_all(&stage_dir);
        return false;
    }
    drop(tmp_file);

    if !extract_zip(&archive, &stage_dir) {
        let _ = std::fs::remove_dir_all(&stage_dir);
        return false;
    }
    let _ = std::fs::remove_file(&archive);

    let moved = install_helpers_from_stage(&stage_dir, parent);
    let _ = std::fs::remove_dir_all(&stage_dir);
    eprintln!(
        "[closedmesh] helpers: ggml-org fallback installed {moved} file(s) in {}",
        parent.display()
    );

    // CUDA flavor: the helpers in the llama-* zip linkage-depend on
    // cudart_64_*.dll which ships in a separate cudart-* zip on the
    // same release. Best-effort second fetch — if it fails, the user
    // sees 0xC0000135 on first load and we tell them to switch to
    // CLOSEDMESH_BACKEND=vulkan.
    if flavor == "cuda-12.4" {
        let cudart_asset = "cudart-llama-bin-win-cuda-12.4-x64.zip";
        let cudart_url = format!(
            "https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_CPP_TAG}/{cudart_asset}"
        );
        eprintln!("[closedmesh] helpers: ggml-org fallback fetching cudart from {cudart_url}");
        if let Ok(resp) = agent.get(&cudart_url).call() {
            let stage_dir = parent.join(".closedmesh.helpers-stage-cudart");
            let _ = std::fs::remove_dir_all(&stage_dir);
            if std::fs::create_dir_all(&stage_dir).is_ok() {
                let archive = stage_dir.join(cudart_asset);
                if let Ok(mut tmp_file) = std::fs::File::create(&archive) {
                    if std::io::copy(&mut resp.into_reader(), &mut tmp_file).is_ok() {
                        drop(tmp_file);
                        if extract_zip(&archive, &stage_dir) {
                            let _ = std::fs::remove_file(&archive);
                            let cudart_moved = install_helpers_from_stage(&stage_dir, parent);
                            eprintln!(
                                "[closedmesh] helpers: ggml-org cudart installed {cudart_moved} file(s)"
                            );
                        }
                    }
                }
                let _ = std::fs::remove_dir_all(&stage_dir);
            }
        } else {
            eprintln!(
                "[closedmesh] helpers: cudart download failed; \
                 set CLOSEDMESH_BACKEND=vulkan if you hit 0xC0000135 on model load"
            );
        }
    }

    helpers_present(parent)
}

#[cfg(not(windows))]
fn repair_helpers_from_llama_cpp(_parent: &Path) -> bool {
    false
}

/// Best-effort `closedmesh service start` on launch. Silently no-ops if
/// the CLI isn't installed yet — the user just gets the offline empty
/// state (handled by the chat UI) until they install it.
///
/// On macOS, before starting the service, we also self-heal the launchd
/// agent's plist. There are two failure modes we observed in the wild:
///
///   1. The user installed the CLI a long time ago (pre-`--auto`/`--join-url`
///      plumbing), so the plist runs `closedmesh serve --headless` with no
///      mesh-discovery flags and the node lives in its own private mesh.
///   2. The user has a current `install.sh`-written plist that uses the new
///      `--join-url https://mesh.closedmesh.com/api/status` flag, but their
///      installed CLI binary predates the flag (e.g. they upgraded the .app
///      without re-running the installer, or they're running a release that
///      shipped before the flag landed). Their service crashes on launch
///      with `error: unexpected argument '--join-url'`.
///
/// Both paths leave `closedmesh.com` showing "0 models" while the user's Mac
/// is in fact running a model — just on the wrong mesh. The fix is to write
/// a plist with arguments the *installed binary* actually understands, and
/// to re-bootstrap the launchd agent. We do this on every launch so users
/// always get the canonical mesh without ever running a terminal command.
pub fn start_service_if_installed() {
    // Locate an existing runtime binary or install a fresh one. When a
    // binary is already present we also verify that it meets the minimum
    // version requirement. Old installs (v0.1.16 era, pre-rc2) may have
    // a binary that predates the --relay / --headless / --join flags we
    // emit in the launchd plist. If the version is too old we delete the
    // binary and let ensure_runtime_installed fetch the current release.
    let bin = match locate_binary() {
        Some(b) => {
            if runtime_meets_minimum(&b) {
                Some(b)
            } else {
                eprintln!(
                    "[closedmesh] runtime at {} is below minimum version; \
                     reinstalling from GitHub releases",
                    b.display()
                );
                let _ = std::fs::remove_file(&b);
                ensure_runtime_installed()
            }
        }
        None => ensure_runtime_installed(),
    };

    if let Some(bin) = bin {
        // Backfill llama.cpp helpers next to the binary if they're
        // missing. Without `rpc-server-*` and `llama-server-*` the
        // runtime joins the mesh successfully but blows up the moment
        // it tries to host a model with `<name> not found in <dir>`.
        // This handles users who installed via `install.sh` (which
        // only ships the `closedmesh` binary, not the helpers) or
        // whose previous auto-upgrade swapped `closedmesh` without
        // touching the helpers (the bug shipped in 0.1.40-0.1.43).
        let helpers_repaired = repair_missing_helpers(&bin);

        // If we just laid down helpers a previously-broken runtime is
        // currently in launchd's restart-throttle window (it crashed
        // on `start_rpc_server` → process exit → KeepAlive backoff).
        // Force a clean bootout/bootstrap so the user recovers in a
        // single second instead of waiting for launchd to relent.
        // Skipped on first install: there's no service loaded yet, and
        // `start_service` below boots it from scratch.
        #[cfg(target_os = "macos")]
        if helpers_repaired {
            if let Some(plist_path) = launchd_plist_path() {
                if plist_path.is_file() {
                    eprintln!(
                        "[closedmesh] helpers: bouncing launchd agent to clear KeepAlive throttle"
                    );
                    bounce_launchd_agent(&plist_path);
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = helpers_repaired;

        // Windows: register (or refresh) the Scheduled Task that turns
        // `closedmesh.exe serve --auto …` into a logon-triggered, restart-
        // on-failure background service. Mirrors what install.ps1 does
        // for users who came in through the PowerShell installer, and
        // makes the .msi → first-launch path single-click — no terminal
        // command, no manual install.ps1. Idempotent: if the task is
        // already registered with matching args it short-circuits, so
        // an in-flight `serve` isn't killed by a delete+create cycle.
        #[cfg(target_os = "windows")]
        register_windows_scheduled_task(&bin);

        // Start the runtime immediately with whatever plist exists.
        // We do NOT block here waiting for a token fetch — that can take
        // up to 40s on a cold network, during which the runtime isn't
        // running at all and the user sees a frozen yellow "checking
        // status" circle. The async retry loop below injects --join as
        // soon as a token is available.
        start_service();

        // Self-heal: inject --join token in the background. First
        // attempt fires in 3 s (covers the common case where the
        // network was just a beat behind the app launch). Subsequent
        // attempts at 8 s, 15 s, 30 s, then every 60 s for 15 min,
        // then every 5 min for an hour. Once --join is in the plist the
        // byte-equality guard makes further calls no-ops.
        #[cfg(target_os = "macos")]
        spawn_self_heal_retry_loop(bin.clone());

        // Background runtime upgrade loop. We let the service start on
        // the existing binary first (so users get a connected mesh in
        // the first second or two of launching the app), then check
        // GitHub for a newer runtime release. If one exists we download,
        // verify, atomically swap the binary, and bounce the service.
        // This is the only way installed users actually pick up runtime
        // bug fixes — the desktop's built-in updater only refreshes the
        // .app/.exe, never the runtime sidecar.
        spawn_runtime_upgrade_loop(bin);
    }
}

/// Background retry loop for `repair_launchd_plist`.
///
/// Fires at rapidly decreasing intervals initially (3 s, 8 s, 15 s,
/// 30 s) to handle the common "network catches up just after launch"
/// case quickly, then at 60 s intervals for 15 min, then 5 min for an
/// hour. The whole loop lives in a dedicated OS thread; it terminates
/// when the app exits or after the hour is up.
///
/// repair_launchd_plist short-circuits via byte-equality when the plist
/// already matches what we'd write — so a healthy install (plist
/// already has --join from the previous run) costs nothing more than
/// one HTTPS request per interval.
#[cfg(target_os = "macos")]
fn spawn_self_heal_retry_loop(bin: PathBuf) {
    std::thread::spawn(move || {
        // Quick bursts — covers "captive portal cleared" / "DNS just
        // resolved" / "Vercel cold start warmed up" within the first
        // ~30 s of the user's session.
        for secs in [3u64, 8, 15, 30] {
            std::thread::sleep(Duration::from_secs(secs));
            repair_launchd_plist(&bin);
        }
        // Steady phase 1: every 60 s for 15 min.
        for _ in 0..15 {
            std::thread::sleep(Duration::from_secs(60));
            repair_launchd_plist(&bin);
        }
        // Steady phase 2: every 5 min for another 45 min.
        for _ in 0..9 {
            std::thread::sleep(Duration::from_secs(300));
            repair_launchd_plist(&bin);
        }
    });
}

pub fn start_service() {
    run_cli(&["service", "start"]);
}

pub fn stop_service() {
    run_cli(&["service", "stop"]);
}

// ---------- Runtime auto-upgrade ----------------------------------------

/// How long after launch to wait before the first upgrade check. Gives
/// the freshly-started service ~30 s to reach steady state (join the
/// mesh, settle DNS, finish loading any model) before we potentially
/// bounce it. Long enough that the user is unlikely to be in the middle
/// of typing something when the bounce happens.
const RUNTIME_UPGRADE_INITIAL_DELAY: Duration = Duration::from_secs(30);

/// Steady-state re-check interval after a successful check (whether
/// the check upgraded us or confirmed we were already up-to-date). Six
/// hours is long enough that we're not hammering GitHub from machines
/// that stay open for days, but short enough that an "Elevens left
/// their laptop on for 18 hours" scenario still picks up a critical
/// fix the same day it ships.
const RUNTIME_UPGRADE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// Backoff schedule used after a *failed* upgrade attempt. The previous
/// loop slept the full 6h interval after every failure, which meant a
/// transient hiccup at T+30s after launch (Wi-Fi reconnecting, captive
/// portal, slow DNS, GitHub 5xx) silently stranded the user on the old
/// runtime for the next 6 hours — by which point most laptops have
/// gone to sleep. We instead retry at 2 min, 10 min, then 1 hour
/// before settling back into the 6 h cadence. Four extra HTTPS GETs
/// in an hour against the GitHub redirect endpoint is negligible load.
const RUNTIME_UPGRADE_FAILURE_BACKOFF: &[Duration] = &[
    Duration::from_secs(2 * 60),
    Duration::from_secs(10 * 60),
    Duration::from_secs(60 * 60),
];

/// Outcome of one `try_upgrade_runtime` call. Splitting "no upgrade
/// available" from "tried and failed" lets the caller pick the right
/// next sleep — steady 6h cadence vs the failure backoff above. The
/// previous `Option<PathBuf>` collapsed both into `None`, which is why
/// a single transient failure looked identical to a healthy node and
/// triggered the same long sleep.
enum UpgradeOutcome {
    /// Installed runtime is already at least as new as the latest
    /// release. The next attempt can wait the full steady-state
    /// interval.
    UpToDate,
    /// Successfully replaced the runtime binary; new path returned.
    Upgraded(PathBuf),
    /// The check (or download / verify / swap) failed. The caller
    /// should retry sooner than steady state.
    Failed,
}

/// GitHub "latest release" landing page. We send a no-redirect GET and
/// read the `Location` header (e.g. `…/releases/tag/v0.65.9`) — that's
/// 1 round-trip with no JSON parsing and no API rate limit (the
/// authenticated `/api/repos/.../releases/latest` endpoint caps
/// unauthenticated callers at 60 req/hr per IP, which would be tight
/// for a multi-user network behind one NAT).
const RUNTIME_LATEST_PAGE: &str = "https://github.com/closedmesh/closedmesh-llm/releases/latest";

/// Background thread: poll GitHub for a newer runtime, download and
/// hot-swap when one appears. The first check fires after
/// `RUNTIME_UPGRADE_INITIAL_DELAY` (so the service can finish coming
/// up first), then every `RUNTIME_UPGRADE_INTERVAL` for the lifetime
/// of the desktop app.
///
/// Why silent (no UI prompt): runtime fixes (host election, peer
/// eviction) ship as patch releases that fix outright broken behavior
/// on user machines. Asking permission to install them means most users
/// stay on the broken version forever. The desktop .app updater is
/// permission-gated because it requires a click-through installer
/// anyway; runtime swaps are a single rename in the user's home dir
/// and need no signing dance.
fn spawn_runtime_upgrade_loop(bin: PathBuf) {
    std::thread::spawn(move || {
        let mut current = bin;
        std::thread::sleep(RUNTIME_UPGRADE_INITIAL_DELAY);
        // Index into `RUNTIME_UPGRADE_FAILURE_BACKOFF`; reset to None on
        // any non-`Failed` outcome so the next miss starts the backoff
        // schedule from the beginning instead of from wherever the last
        // failure cluster left off.
        let mut backoff_idx: Option<usize> = None;
        loop {
            let outcome = try_upgrade_runtime(&current);
            let next_sleep = match outcome {
                UpgradeOutcome::Upgraded(p) => {
                    eprintln!(
                        "[closedmesh] runtime upgrade: success; sleeping {:?} before next check",
                        RUNTIME_UPGRADE_INTERVAL
                    );
                    current = p;
                    backoff_idx = None;
                    RUNTIME_UPGRADE_INTERVAL
                }
                UpgradeOutcome::UpToDate => {
                    backoff_idx = None;
                    RUNTIME_UPGRADE_INTERVAL
                }
                UpgradeOutcome::Failed => {
                    let next_idx = match backoff_idx {
                        Some(i) => i + 1,
                        None => 0,
                    };
                    if next_idx < RUNTIME_UPGRADE_FAILURE_BACKOFF.len() {
                        backoff_idx = Some(next_idx);
                        let d = RUNTIME_UPGRADE_FAILURE_BACKOFF[next_idx];
                        eprintln!(
                            "[closedmesh] runtime upgrade: failed (attempt {}); retrying in {:?}",
                            next_idx + 1,
                            d
                        );
                        d
                    } else {
                        // Exhausted the backoff schedule — fall through
                        // to the steady cadence and start fresh on the
                        // next failure cluster.
                        eprintln!(
                            "[closedmesh] runtime upgrade: failed and backoff exhausted; \
                             sleeping {:?}",
                            RUNTIME_UPGRADE_INTERVAL
                        );
                        backoff_idx = None;
                        RUNTIME_UPGRADE_INTERVAL
                    }
                }
            };
            std::thread::sleep(next_sleep);
        }
    });
}

/// Single upgrade attempt. The three-way return distinguishes "we
/// upgraded" from "nothing to do" from "we tried and failed", which
/// the loop uses to pick the right sleep duration. Before 0.1.41 we
/// collapsed the latter two into `None` and slept the same 6 hours
/// either way — which is why a single 13:41 hiccup left a user stuck
/// on v0.65.6 with no second attempt until 19:41.
///
/// Strategy:
///   1. Read installed version (`closedmesh --version`).
///   2. Read latest release tag (GitHub redirect probe).
///   3. If installed >= latest, return [`UpgradeOutcome::UpToDate`].
///   4. Download tarball into a sibling staging dir on the same
///      filesystem as the install path (so the final move is rename,
///      not copy).
///   5. Extract, chmod +x, strip macOS quarantine.
///   6. Verify the staged binary reports the version we expected. This
///      catches "GitHub redirected us to a tag that doesn't exist yet"
///      and "the tarball was for a different platform than we asked".
///   7. Stop the service so the binary isn't held open (mandatory on
///      Windows; harmless on POSIX).
///   8. Atomic rename over the live binary.
///   9. Restart the service. On macOS also re-run the launchd self-heal
///      so any new flags the new version supports get into the plist.
///
/// Any failure mid-flight aborts the swap, leaves the old binary in
/// place, and returns [`UpgradeOutcome::Failed`] so the caller retries
/// soon instead of waiting the full steady-state interval.
fn try_upgrade_runtime(bin: &Path) -> UpgradeOutcome {
    let Some(installed) = installed_runtime_version(bin) else {
        eprintln!(
            "[closedmesh] runtime upgrade: could not read installed version from {}",
            bin.display()
        );
        return UpgradeOutcome::Failed;
    };
    let Some(latest) = latest_runtime_version() else {
        // `latest_runtime_version` already logs the specific failure
        // mode (DNS, redirect parse, etc).
        return UpgradeOutcome::Failed;
    };
    if !version_lt(&installed, &latest) {
        return UpgradeOutcome::UpToDate;
    }
    eprintln!(
        "[closedmesh] runtime upgrade available: {} -> {}; staging download",
        fmt_version(&installed),
        fmt_version(&latest),
    );

    let Some(asset) = runtime_asset_name() else {
        eprintln!(
            "[closedmesh] runtime upgrade: no published asset for this OS/arch; \
             skipping (this is a build-time configuration, not a transient failure)"
        );
        // Not really `Failed` in the retry-soon sense — there's nothing
        // for us to retry. But the steady-state cadence is the right
        // place for unsupported platforms too, so map to UpToDate.
        return UpgradeOutcome::UpToDate;
    };
    let Some(dest) = runtime_install_path() else {
        eprintln!("[closedmesh] runtime upgrade: could not resolve install path");
        return UpgradeOutcome::Failed;
    };
    let Some(parent) = dest.parent() else {
        eprintln!(
            "[closedmesh] runtime upgrade: install path {} has no parent",
            dest.display()
        );
        return UpgradeOutcome::Failed;
    };

    let stage_dir = parent.join(format!(".closedmesh.upgrade-{}", fmt_version(&latest)));
    let _ = std::fs::remove_dir_all(&stage_dir);
    if let Err(e) = std::fs::create_dir_all(&stage_dir) {
        eprintln!("[closedmesh] runtime upgrade: mkdir staging failed: {e}");
        return UpgradeOutcome::Failed;
    }

    let url = format!("{RUNTIME_RELEASE_BASE}/{asset}");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(120))
        .redirects(8)
        .build();
    let resp = match agent.get(&url).call() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[closedmesh] runtime upgrade: download {url} failed: {e}");
            let _ = std::fs::remove_dir_all(&stage_dir);
            return UpgradeOutcome::Failed;
        }
    };

    let archive = stage_dir.join(&asset);
    let mut tmp_file = match std::fs::File::create(&archive) {
        Ok(f) => f,
        Err(e) => {
            eprintln!(
                "[closedmesh] runtime upgrade: create {} failed: {e}",
                archive.display()
            );
            let _ = std::fs::remove_dir_all(&stage_dir);
            return UpgradeOutcome::Failed;
        }
    };
    if let Err(e) = std::io::copy(&mut resp.into_reader(), &mut tmp_file) {
        eprintln!("[closedmesh] runtime upgrade: stream failed: {e}");
        let _ = std::fs::remove_dir_all(&stage_dir);
        return UpgradeOutcome::Failed;
    }
    drop(tmp_file);

    let extracted_ok = if asset.ends_with(".tar.gz") {
        extract_tar_gz(&archive, &stage_dir)
    } else if asset.ends_with(".zip") {
        extract_zip(&archive, &stage_dir)
    } else {
        eprintln!("[closedmesh] runtime upgrade: unknown archive type for {asset}");
        false
    };
    if !extracted_ok {
        let _ = std::fs::remove_dir_all(&stage_dir);
        return UpgradeOutcome::Failed;
    }
    let _ = std::fs::remove_file(&archive);

    let exe_name = if cfg!(windows) {
        "closedmesh.exe"
    } else {
        "closedmesh"
    };
    let new_bin = stage_dir.join(exe_name);
    if !new_bin.is_file() {
        eprintln!(
            "[closedmesh] runtime upgrade: extraction OK but {} is missing",
            new_bin.display()
        );
        let _ = std::fs::remove_dir_all(&stage_dir);
        return UpgradeOutcome::Failed;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&new_bin) {
            let mut perm = meta.permissions();
            perm.set_mode(0o755);
            let _ = std::fs::set_permissions(&new_bin, perm);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(&new_bin)
            .hide_console()
            .output();
    }

    // Sanity check: the staged binary must report the version we asked
    // for. Catches an asset-name / tag mismatch that would silently
    // install the wrong build (e.g. an arch-mismatched binary that
    // refuses to launch).
    let actual = installed_runtime_version(&new_bin);
    if actual.as_ref() != Some(&latest) {
        eprintln!(
            "[closedmesh] runtime upgrade: staged binary reports {:?}, expected {}; aborting",
            actual.as_ref().map(fmt_version),
            fmt_version(&latest),
        );
        let _ = std::fs::remove_dir_all(&stage_dir);
        return UpgradeOutcome::Failed;
    }

    // Stop the service so launchd / SCM releases its handle on the
    // current binary. POSIX rename-over-running-binary is technically
    // legal (the kernel keeps the old inode alive for the running
    // process) but Windows holds an exclusive lock; doing the same
    // dance everywhere keeps the code simple.
    stop_service();
    std::thread::sleep(Duration::from_secs(2));

    if let Err(e) = std::fs::rename(&new_bin, &dest) {
        eprintln!(
            "[closedmesh] runtime upgrade: rename {} -> {} failed: {e}; restarting old service",
            new_bin.display(),
            dest.display()
        );
        let _ = std::fs::remove_dir_all(&stage_dir);
        start_service();
        return UpgradeOutcome::Failed;
    }

    // Refresh the llama.cpp helpers (`rpc-server-*`, `llama-server-*`,
    // `llama-moe-*`) from the same tarball. Pre-0.1.44 we skipped this
    // step and `remove_dir_all` below silently nuked the helpers — fine
    // when the user already had compatible ones from a prior install,
    // but a hard crash for fresh users who never had them on disk
    // (their runtime would join the mesh and then fail on the first
    // host attempt with "rpc-server not found"). Best-effort: a partial
    // refresh leaves the runtime at least as functional as before.
    let helpers_moved = install_helpers_from_stage(&stage_dir, parent);

    let _ = std::fs::remove_dir_all(&stage_dir);
    eprintln!(
        "[closedmesh] runtime upgraded to {} at {} ({} helper(s) refreshed)",
        fmt_version(&latest),
        dest.display(),
        helpers_moved,
    );

    // Bring the service back. On macOS we go straight through our own
    // launchd routines (`bounce_launchd_agent`) — calling
    // `closedmesh service start` here as well used to race with the
    // `repair_launchd_plist` bounce immediately after, leaving us in a
    // state where the agent was bootout'd but the racing bootstrap had
    // hit EIO. The new flow:
    //
    //   1. `repair_launchd_plist` rewrites the plist if the binary path
    //      / args have actually changed. If not, it would normally
    //      short-circuit — but we *just* swapped the binary inode at
    //      the same path, and launchd needs to restart the process to
    //      pick that up. So we explicitly bounce regardless.
    //
    // On non-macOS we still go through the runtime CLI's `service
    // start`, which delegates to systemd / SCM as appropriate.
    #[cfg(target_os = "macos")]
    {
        repair_launchd_plist(&dest);
        // Defence in depth: if `repair_launchd_plist` short-circuited
        // because the plist content was byte-identical (binary path
        // unchanged across the upgrade), it didn't bounce. Force it
        // here so the new binary at `dest` actually starts running.
        if let Some(plist_path) = launchd_plist_path() {
            if plist_path.is_file() {
                bounce_launchd_agent(&plist_path);
            } else {
                eprintln!(
                    "[closedmesh] post-upgrade: plist {} missing, calling `service start`",
                    plist_path.display()
                );
                start_service();
            }
        } else {
            start_service();
        }
    }
    #[cfg(not(target_os = "macos"))]
    start_service();

    UpgradeOutcome::Upgraded(dest)
}

/// Run `bin --version` and parse the first semver-shaped token. Returns
/// `None` if the binary won't launch or its output doesn't contain a
/// version number we recognize. We intentionally accept whatever
/// `(0, 0, 0, None)` parse_semver returns here too — it's a sentinel
/// that the comparator treats as "very old", which means a broken
/// binary will always look upgrade-eligible.
fn installed_runtime_version(bin: &Path) -> Option<(u32, u32, u32, Option<String>)> {
    let out = Command::new(bin)
        .arg("--version")
        .hide_console()
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let token = text
        .split_whitespace()
        .find(|t| t.chars().next().map_or(false, |c| c.is_ascii_digit()))?;
    Some(parse_semver(token))
}

/// Probe `https://github.com/.../releases/latest` and read the
/// `Location` header without following the redirect. The redirect
/// target is `…/releases/tag/vX.Y.Z`, so the last path segment is the
/// tag name. Returns `None` on any error so the upgrade loop falls
/// through to "try again later".
fn latest_runtime_version() -> Option<(u32, u32, u32, Option<String>)> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(10))
        .redirects(0)
        .build();
    let resp = match agent.get(RUNTIME_LATEST_PAGE).call() {
        Ok(r) => r,
        // ureq treats 3xx-with-no-follow as a `Status` error but still
        // hands back the response so we can read its headers.
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => {
            eprintln!("[closedmesh] runtime upgrade: latest version probe failed: {e}");
            return None;
        }
    };
    let loc = resp.header("location")?;
    let tag = loc.rsplit('/').next()?;
    let stripped = tag.strip_prefix('v').unwrap_or(tag);
    let parsed = parse_semver(stripped);
    if parsed == (0, 0, 0, None) {
        eprintln!("[closedmesh] runtime upgrade: could not parse latest tag {tag:?}");
        return None;
    }
    Some(parsed)
}

/// Strict-less-than for our `(major, minor, patch, pre)` tuples.
///
/// Pre-release semantics follow semver §11: `1.2.3-rc < 1.2.3`. We
/// don't try to be clever with rc1 vs rc2 ordering — string comparison
/// is good enough for the rc1/rc2/beta1 tags we actually publish, and
/// "different pre-release strings on the same release" is rare enough
/// that we'd rather bias toward not auto-upgrading in that edge case.
fn version_lt(a: &(u32, u32, u32, Option<String>), b: &(u32, u32, u32, Option<String>)) -> bool {
    match (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)) {
        std::cmp::Ordering::Less => true,
        std::cmp::Ordering::Greater => false,
        std::cmp::Ordering::Equal => match (&a.3, &b.3) {
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (Some(p_a), Some(p_b)) => p_a < p_b,
            (None, None) => false,
        },
    }
}

fn fmt_version(v: &(u32, u32, u32, Option<String>)) -> String {
    let base = format!("{}.{}.{}", v.0, v.1, v.2);
    match &v.3 {
        Some(pre) => format!("{base}-{pre}"),
        None => base,
    }
}

// ---------- Launchd self-healing (macOS) --------------------------------

#[cfg(target_os = "macos")]
const SERVICE_LABEL: &str = "dev.closedmesh.closedmesh";

/// Windows Task Scheduler task name. Matches install.ps1.
#[cfg(target_os = "windows")]
const SERVICE_NAME_WINDOWS: &str = "ClosedMesh";

/// Live join endpoint for the canonical entry node. Used by both the
/// macOS launchd plist and the Windows Scheduled Task: the runtime
/// re-fetches the token from this URL on every restart so an entry-node
/// key rotation never strands existing installs.
#[cfg(any(target_os = "macos", target_os = "windows"))]
const ENTRY_STATUS_URL: &str = "https://mesh.closedmesh.com/api/status";

/// Fallback join token baked in at build time.
///
/// The canonical entry node (mesh.closedmesh.com) runs in Docker on AWS
/// Lightsail. As of the May 5 2026 cleanup the entry no longer publishes
/// itself on the upstream `mesh-llm` Nostr channel and no longer auto-joins
/// other meshes (`--auto` and `--publish` removed from its systemd unit) —
/// so the ONLY way for a fresh install to find us is via this token plus
/// the live `--join-url` path. It is no longer optional infra; if it goes
/// stale every new install is stranded on a one-node mesh.
///
/// The runtime auto-rotates the iroh identity whenever the entry transitions
/// public→private (or vice-versa), so any future "make the entry public
/// again" flip will also force a token refresh here.
///
/// The live `--join-url https://mesh.closedmesh.com/api/status` path
/// (added in closedmesh-llm v0.65.0) always re-fetches on restart, so this
/// fallback also covers users whose installed CLI is older than that.
///
/// Update this constant whenever the entry node container is restarted
/// (e.g. image update, config change). Read it from the box with:
///   ssh ubuntu@3.210.30.58 'docker logs mesh-entry 2>&1 | \
///       grep -oE "Invite created.*: \S+" | tail -1 | awk "{print \$NF}"'
#[cfg(any(target_os = "macos", target_os = "windows"))]
const FALLBACK_JOIN_TOKEN: &str = "eyJpZCI6IjY2ZmFkNDNhMmZhZWRmMzIwMGZjN2M3YjU4NTVjMzIwZWRjMmY4ZjA0OGU2OTM1ZDIyZjljODkwMjFkNmQwM2EiLCJhZGRycyI6W3siUmVsYXkiOiJodHRwczovL3VzZTEtMS5yZWxheS5uMC5pcm9oLWNhbmFyeS5pcm9oLmxpbmsuLyJ9LHsiSXAiOiIzLjIxMC4zMC41ODo0MjE0MCJ9LHsiSXAiOiIxNzIuMTcuMC4xOjQyMTQwIn0seyJJcCI6IjE3Mi4yNi4zLjkxOjQyMTQwIn0seyJJcCI6IlsyNjAwOjFmMTg6NTI2Zjo0OTAwOjY4NjU6YzY4NzoxYTc0OjRiOWJdOjQ2OTMzIn1dfQ";

/// Public Iroh relays we explicitly hand to the runtime via `--relay`.
///
/// closedmesh-llm v0.65.0-rc2 (the latest published release at the time
/// of writing) hard-codes a default relay map of
/// `*.michaelneale.mesh-llm.iroh.link` URLs that no longer resolve, so
/// without an override the runtime can't punch through NAT to reach the
/// public entry node — which is exactly the failure that surfaces on
/// `closedmesh.com` as "Mesh online · 0 models" even when a user is
/// running a model locally. Until the runtime ships a fix we override
/// the relay map at the launchd plist level. n0's canary relays are
/// public and operationally maintained by the iroh team.
#[cfg(any(target_os = "macos", target_os = "windows"))]
const DEFAULT_RELAYS: &[&str] = &[
    "https://use1-1.relay.n0.iroh-canary.iroh.link./",
    "https://euw-1.relay.n0.iroh-canary.iroh.link./",
];

/// Rewrites `~/Library/LaunchAgents/dev.closedmesh.closedmesh.plist` so the
/// service uses arguments compatible with the installed `closedmesh` binary,
/// then bounces the launchd agent. A no-op if we can't locate `$HOME` or if
/// rewriting fails; the user falls back to whatever plist they had, which
/// is no worse than today.
///
/// Strategy:
///   1. Probe the installed CLI for `--join-url` support (added in
///      closedmesh-llm v0.65.0). If present, embed the canonical entry
///      URL — the runtime then re-fetches the token on every restart,
///      which means an entry-node restart that rotates its node id
///      doesn't permanently strand existing installs.
///   2. Otherwise (older CLI), fetch a token from the entry's HTTP API
///      *now* and embed it as a literal `--join <token>`. This copy of
///      the token is good for as long as the entry's node id is stable;
///      after that the user's next desktop launch will refresh it.
///   3. If both strategies fail (no `--join-url`, no reachable entry),
///      we still write a plist with `--auto --publish` so the service
///      at least advertises itself on Nostr and other peers can find
///      it via auto-discovery — strictly better than the previous
///      behavior of writing a private-by-default plist.
#[cfg(target_os = "macos")]
fn repair_launchd_plist(bin: &std::path::Path) {
    let Some(plist_path) = launchd_plist_path() else {
        return;
    };

    let supports_join_url = cli_supports_join_url(bin);
    let join_args: Vec<String> = if supports_join_url {
        vec!["--join-url".to_string(), ENTRY_STATUS_URL.to_string()]
    } else {
        // fetch_entry_token always returns a token — either live from
        // mesh.closedmesh.com or the built-in fallback. Either way we
        // always get --join in the plist.
        let token = fetch_entry_token();
        vec!["--join".to_string(), token]
    };

    let xml = build_launchd_plist_xml(bin, &join_args);

    let existing = std::fs::read(&plist_path).ok();

    // If the plist is already byte-identical to what we'd write, skip
    // the rewrite entirely. Avoids a needless launchd bounce on every
    // app launch (which would race against a freshly-started runtime).
    if let Some(bytes) = &existing {
        if bytes == xml.as_bytes() {
            return;
        }
        // Log what actually changed so we can diagnose spurious bounces.
        // We only show the first differing line from each side to keep the
        // log concise; a future reader can compare the full plist on disk.
        let old_str = String::from_utf8_lossy(bytes);
        let first_old_diff = old_str
            .lines()
            .zip(xml.lines())
            .find(|(a, b)| a != b)
            .map(|(old, _)| old.trim())
            .unwrap_or("<length mismatch>");
        let first_new_diff = xml
            .lines()
            .zip(old_str.lines())
            .find(|(a, b)| a != b)
            .map(|(new, _)| new.trim())
            .unwrap_or("<length mismatch>");
        eprintln!(
            "[closedmesh] self-heal: plist changed — first diff: \
             old={first_old_diff:?} new={first_new_diff:?}; bouncing launchd"
        );
    } else {
        eprintln!("[closedmesh] self-heal: writing plist for the first time; bouncing launchd");
    }

    // Some users (and at least one previous incarnation of this code,
    // when manually patching plists during outages) set `chflags uchg`
    // on the plist to lock it. Best-effort clear that flag before we
    // try to rewrite — if the user really did intend it as a hard lock,
    // chflags will succeed but std::fs::write may still fail, and we
    // early-return.
    let _ = Command::new("chflags")
        .args(["nouchg"])
        .arg(&plist_path)
        .hide_console()
        .output();

    // Ensure the log directory referenced in the plist exists. launchd
    // refuses to bootstrap (exit code 5 / EIO) if it can't open the log
    // files, and it does NOT create the directory itself.
    if let Some(home) = dirs::home_dir() {
        let _ = std::fs::create_dir_all(home.join("Library/Logs/closedmesh"));
    }

    // Clear the macOS quarantine attribute on the binary before bootstrapping.
    // Downloaded binaries receive com.apple.quarantine from the OS. The desktop
    // process can spawn them fine (inherited trust), but launchd launching them
    // as a fresh session gets EIO (exit code 5). This is a safe no-op on
    // already-cleared binaries.
    let _ = Command::new("xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(bin)
        .hide_console()
        .output();

    let tmp_path = plist_path.with_extension("plist.tmp");
    if let Some(parent) = plist_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&tmp_path, xml.as_bytes()) {
        eprintln!(
            "[closedmesh] self-heal: failed to write {}: {e}",
            tmp_path.display()
        );
        return;
    }
    if let Err(e) = std::fs::rename(&tmp_path, &plist_path) {
        eprintln!(
            "[closedmesh] self-heal: failed to rename {} -> {}: {e}",
            tmp_path.display(),
            plist_path.display()
        );
        let _ = std::fs::remove_file(&tmp_path);
        return;
    }

    bounce_launchd_agent(&plist_path);
}

#[cfg(target_os = "macos")]
fn launchd_plist_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join("Library")
            .join("LaunchAgents")
            .join(format!("{SERVICE_LABEL}.plist"))
    })
}

/// Probes `closedmesh serve --help` for the `--join-url` token. Cheap (a
/// fork+exec of our own binary printing static help text) and avoids
/// hard-coding a CLI version the desktop has to keep in sync with.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn cli_supports_join_url(bin: &std::path::Path) -> bool {
    let Ok(output) = Command::new(bin)
        .args(["serve", "--help"])
        .hide_console()
        .output()
    else {
        return false;
    };
    let combined: Vec<u8> = output
        .stdout
        .into_iter()
        .chain(output.stderr.into_iter())
        .collect();
    String::from_utf8_lossy(&combined).contains("--join-url")
}

/// One-shot HTTPS GET to the canonical entry node's status endpoint.
/// We deliberately use short timeouts: the desktop is on the launch path
/// and we'd rather start with auto-discovery only than block the GUI for
/// 30s if the user's offline.
///
/// Logs each failure mode to stderr (which lands in
/// `~/Library/Logs/closedmesh/stderr.log` once launchd takes over the
/// process). The previous implementation used `.ok()?` to swallow every
/// error — when this silently returned `None` for a v0.1.16 user we had
/// no way to tell whether DNS, TLS, the HTTP fetch, or the JSON decode
/// was the problem, and the user's plist quietly fell back to a private
/// mesh of one.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn fetch_entry_token() -> String {
    // 5 s connect, 10 s read. Each attempt is called from the retry loop
    // (T+3 s, T+8 s, T+15 s, T+30 s, then every 60 s) so a slow attempt
    // doesn't stall the next try for long.
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(10))
        .build();

    let live = (|| {
        let resp = agent.get(ENTRY_STATUS_URL).call().map_err(|e| {
            eprintln!("[closedmesh] self-heal: GET {ENTRY_STATUS_URL} failed: {e}");
            e.to_string()
        })?;
        let payload: InvitePayload = resp.into_json().map_err(|e| {
            eprintln!("[closedmesh] self-heal: parse {ENTRY_STATUS_URL} body failed: {e}");
            e.to_string()
        })?;
        let t = payload
            .token
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        t.ok_or_else(|| {
            eprintln!("[closedmesh] self-heal: {ENTRY_STATUS_URL} returned no `token` field");
            "no token field".to_string()
        })
    })();

    match live {
        Ok(t) => {
            eprintln!("[closedmesh] self-heal: fetched live entry token");
            t
        }
        Err(_) => {
            eprintln!(
                "[closedmesh] self-heal: live fetch failed — using built-in fallback token \
                 (relay-based connection will still work)"
            );
            FALLBACK_JOIN_TOKEN.to_string()
        }
    }
}

/// Mirrors the plist `install.sh` writes today, but with the
/// `ProgramArguments` array constructed from `join_args` so the same
/// codepath handles `--join-url`, `--join <token>`, or no join flag at
/// all (Nostr-only fallback).
///
/// `--publish` is required even when joining via `--join` / `--join-url`:
/// without it, the local node is in private mode and won't broadcast
/// itself on Nostr — meaning peers (and the public entry node behind
/// `mesh.closedmesh.com`) can't discover it, and `closedmesh.com` shows
/// "0 models" even though we successfully joined the canonical mesh.
/// This was the headline bug in v0.1.16.
#[cfg(target_os = "macos")]
fn build_launchd_plist_xml(bin: &std::path::Path, join_args: &[String]) -> String {
    let home = dirs::home_dir()
        .map(|h| h.display().to_string())
        .unwrap_or_else(|| "/".to_string());
    let log_dir = format!("{home}/Library/Logs/closedmesh");

    let mut program_args = vec![
        bin.display().to_string(),
        "serve".to_string(),
        "--auto".to_string(),
        "--publish".to_string(),
        "--mesh-name".to_string(),
        "closedmesh".to_string(),
    ];
    program_args.extend(join_args.iter().cloned());
    for relay in DEFAULT_RELAYS {
        program_args.push("--relay".to_string());
        program_args.push((*relay).to_string());
    }
    program_args.push("--headless".to_string());

    let args_xml = program_args
        .iter()
        .map(|a| format!("        <string>{}</string>", xml_escape(a)))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
{args}
    </array>
    <key>WorkingDirectory</key>
    <string>{home}</string>
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
    <string>{log_dir}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/stderr.log</string>
</dict>
</plist>
"#,
        label = SERVICE_LABEL,
        args = args_xml,
        home = xml_escape(&home),
        log_dir = xml_escape(&log_dir),
    )
}

#[cfg(target_os = "macos")]
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// `launchctl bootout` (idempotent — succeeds whether or not the agent is
/// loaded) followed by `launchctl bootstrap` to pick up the rewritten plist.
///
/// If `bootstrap` fails we call `start_service()` as a last-resort fallback
/// so that a failed launchd registration does not leave the node dead. The
/// most common cause on macOS is a transient I/O error (exit code 5) from
/// launchd when the log directory or the plist hasn't flushed to disk yet;
/// `start_service()` retries the same codepath and usually succeeds on the
/// second attempt.
#[cfg(target_os = "macos")]
fn bounce_launchd_agent(plist_path: &std::path::Path) {
    let uid = current_uid();
    let target = format!("gui/{uid}");
    let label_target = format!("{target}/{SERVICE_LABEL}");

    let _ = Command::new("launchctl")
        .args(["bootout", &label_target])
        .hide_console()
        .output();

    // Wait for launchd's async unload to actually finish before we
    // bootstrap the same label. macOS's `launchctl bootout` returns
    // immediately, but the underlying unload-and-cleanup is queued —
    // a follow-up `bootstrap` issued in the next ~1s reliably fails
    // with EIO ("Bootstrap failed: 5: Input/output error") because
    // launchd still considers the previous instance loaded.
    //
    // 2s clears it on a healthy machine; we add a longer retry below
    // for laptops under load (waking from sleep, big spotlight scan,
    // etc.). This is the same race that left v0.65.6 → v0.65.9
    // upgrades stranded on 0.1.42.
    std::thread::sleep(std::time::Duration::from_secs(2));

    let plist_str = plist_path.display().to_string();

    // Up to three bootstrap attempts spaced 0s / 3s / 5s apart. We've
    // observed first-attempt EIO followed by clean success on attempt
    // two; the third try is purely defence in depth for slow machines.
    // Anything still failing after ~10s of accumulated wait is almost
    // certainly a real plist / permissions problem rather than a race,
    // and the `start_service` fallback below will surface it.
    let backoff = [
        std::time::Duration::from_secs(0),
        std::time::Duration::from_secs(3),
        std::time::Duration::from_secs(5),
    ];
    let mut last_failure: Option<(Option<i32>, String)> = None;
    let mut succeeded = false;
    for (i, wait) in backoff.iter().enumerate() {
        if !wait.is_zero() {
            std::thread::sleep(*wait);
        }
        let bootstrap = Command::new("launchctl")
            .args(["bootstrap", &target, &plist_str])
            .hide_console()
            .output();
        match &bootstrap {
            Ok(out) if out.status.success() => {
                eprintln!(
                    "[closedmesh] launchctl bootstrap succeeded (attempt {})",
                    i + 1
                );
                succeeded = true;
                break;
            }
            Ok(out) => {
                let msg = [
                    String::from_utf8_lossy(&out.stderr).trim().to_string(),
                    String::from_utf8_lossy(&out.stdout).trim().to_string(),
                ]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" / ");
                eprintln!(
                    "[closedmesh] launchctl bootstrap attempt {} failed (exit {:?}): {msg}",
                    i + 1,
                    out.status.code()
                );
                last_failure = Some((out.status.code(), msg));
            }
            Err(e) => {
                eprintln!(
                    "[closedmesh] launchctl bootstrap attempt {} could not spawn: {e}",
                    i + 1
                );
                last_failure = Some((None, e.to_string()));
            }
        }
    }

    if !succeeded {
        let (code, detail) = last_failure.unwrap_or((None, "no attempt made".to_string()));
        eprintln!(
            "[closedmesh] launchctl bootstrap exhausted retries (last exit {:?}): {detail}; \
             plist={} — falling back to `closedmesh service start`",
            code,
            plist_path.display(),
        );
        std::thread::sleep(std::time::Duration::from_secs(2));
        start_service();
    }
}

#[cfg(target_os = "macos")]
fn current_uid() -> u32 {
    // `id -u` is a 1-process fork that prints the numeric UID. We avoid
    // adding a libc dep just for `getuid()` — this codepath runs once at
    // launch and the cost is negligible.
    Command::new("id")
        .arg("-u")
        .hide_console()
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8(o.stdout)
                .ok()
                .and_then(|s| s.trim().parse::<u32>().ok())
        })
        .unwrap_or(501)
}

/// Reads the `keepMeshRunningAfterQuit` toggle from the controller's
/// settings file. The Settings page writes to this same JSON, so the
/// preference is shared without any IPC. Returns `false` (the default
/// — i.e. "stop the runtime on quit") when the file is missing,
/// unparseable, or the field is absent. We deliberately don't depend
/// on `serde_json` for this one bool: a regex is robust enough and
/// keeps the desktop binary lean.
pub fn keep_running_after_quit() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    let path = home.join(".closedmesh").join("controller-settings.json");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    // Tolerant scan — handles `"keepMeshRunningAfterQuit":true` and
    // `"keepMeshRunningAfterQuit": true` and trailing comma variants.
    // serde_json would be 30 LoC less but pulls in another dep.
    let needle = "\"keepMeshRunningAfterQuit\"";
    let Some(idx) = raw.find(needle) else {
        return false;
    };
    let after = &raw[idx + needle.len()..];
    // Skip the colon + whitespace, then look for the literal `true` /
    // `false` token.
    let trimmed = after.trim_start_matches([':', ' ', '\t', '\n', '\r']);
    trimmed.starts_with("true")
}

// ---------- Windows / Task Scheduler ------------------------------------

/// PowerShell script that registers (or refreshes) the ClosedMesh
/// Scheduled Task. Mirrors `Install-ScheduledTaskUnit` in
/// `public/install.ps1` so a user who started from the .msi gets the
/// exact same task definition (RestartInterval, AllowStartIfOnBatteries,
/// Limited principal, AtLogon trigger) as one who ran the PowerShell
/// installer manually. Embedded as a string constant so we don't have
/// to find install.ps1 on disk at runtime.
///
/// Parameters are passed positionally because PowerShell's `-File` mode
/// needs them via the script's own `param(...)` block. Idempotency
/// (delete-before-register) is intentional and called from the Rust
/// caller only when args genuinely changed.
#[cfg(target_os = "windows")]
const REGISTER_TASK_PS: &str = r#"param(
    [Parameter(Mandatory=$true)][string]$BinPath,
    [Parameter(Mandatory=$true)][string]$ArgString,
    [Parameter(Mandatory=$true)][string]$UserName,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory,
    [Parameter(Mandatory=$true)][string]$TaskName
)
$ErrorActionPreference = 'Stop'

# Stop any running runtime first. Without this:
#   - Stop-ScheduledTask + Register-ScheduledTask can race against a
#     running closedmesh.exe that still holds the binary file open,
#     and the user's next launch quietly runs the old image.
#   - The wscript.exe launcher (see below) holds an exclusive lock
#     on closedmesh-launch.vbs while it's shepherding the runtime,
#     so re-writing the .vbs from this script would fail with a
#     "file in use" error.
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null } catch { }
$installDir = Split-Path -Parent $BinPath
for ($i = 0; $i -lt 2; $i++) {
    try {
        Get-Process -Name closedmesh -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -and ($_.Path -ieq $BinPath) } |
            Stop-Process -Force -ErrorAction SilentlyContinue
    } catch { }
    Start-Sleep -Milliseconds 250
}
try {
    Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and ($_.CommandLine -like "*closedmesh-launch.vbs*") } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { }
Start-Sleep -Milliseconds 400

# schtasks writes to stderr when the task doesn't exist (the expected
# case on the very first install). Under $ErrorActionPreference =
# 'Stop' that stderr write becomes a terminating NativeCommandError
# even though `2>$null` should have eaten it — wrap in try/catch so
# a missing prior task is silently OK.
try { schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null } catch { }

# Generate a tiny VBScript that CreateProcess()'s closedmesh.exe with
# no console window AND redirects its stdout/stderr to log files,
# then blocks until it exits. See public/install.ps1::Write-LaunchVbs
# for the rationale (mirrored verbatim — keep the two in sync).
#
# Two problems solved at once:
#
#   1. console window. closedmesh.exe is a console-subsystem binary,
#      so a Scheduled Task with LogonType=Interactive allocates a
#      console for it and Win11's default terminal handler pops a
#      visible Windows Terminal tab on every login.
#
#   2. log visibility. Without redirection the runtime's stdout and
#      stderr go to the void, the dashboard's Activity page stays
#      permanently empty, and a user who set a startup model and
#      watched it appear-to-not-load had no way to tell whether the
#      runtime was loading slowly, stuck, or had crashed silently.
#
# wscript.exe is a Windows-subsystem host (no console allocation);
# `cmd /S /c "<bin>" args >> stdout.log 2>> stderr.log` pipes the
# streams to disk; sh.Run "..", 0, True hides the (now-redundant) cmd
# window and blocks wscript on the child so Stop-ScheduledTask still
# has something to terminate.
$logDir  = Join-Path $env:LOCALAPPDATA 'closedmesh\logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$logFileStdout = Join-Path $logDir 'stdout.log'
$logFileStderr = Join-Path $logDir 'stderr.log'

# Pin the HuggingFace Hub cache so the runtime task always finds models
# the dashboard downloaded and vice-versa. The runtime CLI's own
# resolver falls back to `$HOME/.cache/huggingface/hub`, but on Windows
# `HOME` is unset and the resolver collapses to `./.cache/huggingface/hub`
# — i.e. relative to whichever process's CWD launched it. Two launch
# contexts (the Scheduled Task running with USERPROFILE as CWD vs the
# bundled Node controller running with %LOCALAPPDATA%\ClosedMesh as CWD)
# produced two different cache dirs, so a model the user downloaded via
# the dashboard ended up invisible to the startup-loading task —
# which silently re-downloaded a 33 GB file from scratch. Setting the
# env var explicitly here pins the location regardless of who launches
# the task. Mirror in main.rs::pin_huggingface_cache_dir.
$hfCacheDir = Join-Path $env:LOCALAPPDATA 'huggingface\hub'
if (-not (Test-Path $hfCacheDir)) { New-Item -ItemType Directory -Force -Path $hfCacheDir | Out-Null }

$vbsPath = Join-Path $installDir 'closedmesh-launch.vbs'
$vbs = @"
' Auto-generated by ClosedMesh desktop app. Do not edit by hand;
' relaunching the desktop app regenerates this file. See
' public/install.ps1::Write-LaunchVbs for the same wrapper used by the
' standalone PowerShell installer.
'
' CLOSEDMESH_BIN: ${BinPath}
' CLOSEDMESH_ARGS: ${ArgString}
' CLOSEDMESH_LOGDIR: ${logDir}
' CLOSEDMESH_HF_HUB_CACHE: ${hfCacheDir}
Option Explicit
Dim sh, fso, cmd, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FolderExists("${logDir}") Then fso.CreateFolder("${logDir}")
If Not fso.FolderExists("${hfCacheDir}") Then fso.CreateFolder("${hfCacheDir}")
' Pin the HuggingFace cache for THIS process (and every child cmd/closedmesh
' inherits the value). The runtime would otherwise resolve the cache from
' \$HOME, which Windows doesn't set, and fall back to a CWD-relative path.
sh.Environment("PROCESS")("HF_HUB_CACHE") = "${hfCacheDir}"
q = Chr(34)
cmd = "cmd /S /c " & q & q & "${BinPath}" & q & " ${ArgString} >> " & q & "${logFileStdout}" & q & " 2>> " & q & "${logFileStderr}" & q & q
sh.Run cmd, 0, True
Set sh = Nothing
Set fso = Nothing
"@
Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII

$wscriptArgs = "//B //Nologo `"$vbsPath`""
$action    = New-ScheduledTaskAction    -Execute 'wscript.exe' -Argument $wscriptArgs -WorkingDirectory $WorkingDirectory
$trigger   = New-ScheduledTaskTrigger   -AtLogOn -User $UserName
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -RestartCount 3 `
    -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId $UserName -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'ClosedMesh - private LLM mesh node' | Out-Null
"#;

/// Compose the runtime CLI argument string baked into the Scheduled
/// Task. Matches the line install.ps1 generates at install time so a
/// machine bootstrapped by the PowerShell installer and one
/// bootstrapped by the desktop app behave identically.
///
/// `--join-url` is preferred when the installed CLI supports it (the
/// runtime then re-fetches the token on every restart, surviving entry
/// node key rotations); older CLIs fall back to a literal `--join
/// <token>` fetched at install time.
#[cfg(target_os = "windows")]
fn build_windows_service_args(bin: &std::path::Path) -> String {
    let supports_join_url = cli_supports_join_url(bin);
    let join_segment = if supports_join_url {
        format!(" --join-url {ENTRY_STATUS_URL}")
    } else {
        let token = fetch_entry_token();
        format!(" --join {token}")
    };
    let mut relays = String::new();
    for r in DEFAULT_RELAYS {
        relays.push_str(" --relay ");
        relays.push_str(r);
    }
    format!("serve --auto --publish --mesh-name closedmesh{join_segment}{relays} --headless")
}

/// Returns the closedmesh-runtime argument string the currently
/// installed Scheduled Task will pass to `closedmesh.exe`, or `None`
/// if no .vbs launcher exists (the task isn't registered yet, or it's
/// from a pre-VBS-launcher version of the desktop app, or the .vbs
/// is from before the redirected-output rewrite).
///
/// We can't read the task's Action.Arguments directly because as of
/// the VBS-launcher refactor the task runs `wscript.exe //B //Nologo
/// "<vbs>"` — the actual closedmesh args live inside the `.vbs`. We
/// also can't reliably parse the embedded `cmd /S /c` invocation
/// because the VBS uses Chr(34) string concatenation to assemble
/// quotes, which would force this side to mirror the same string-
/// building logic. Instead the writers (install.ps1 and the
/// REGISTER_TASK_PS sibling here) emit the canonical args string as
/// a stable comment marker at the top of the file:
///
///     ' CLOSEDMESH_ARGS: serve --auto --publish ... --headless
///
/// This function just reads that line back. Robust against future
/// changes to the runtime invocation as long as the marker stays.
///
/// Used to decide whether `register_windows_scheduled_task` actually
/// needs to re-register: re-registering on every desktop launch would
/// kill the running task (delete + create) and disconnect any in-flight
/// inference. Same idempotency principle as the macOS plist self-heal.
#[cfg(target_os = "windows")]
fn current_windows_task_args(bin: &std::path::Path) -> Option<String> {
    let vbs_path = bin.parent()?.join("closedmesh-launch.vbs");
    let contents = std::fs::read_to_string(&vbs_path).ok()?;

    const MARKER: &str = "' CLOSEDMESH_ARGS:";
    let line = contents.lines().find(|l| l.starts_with(MARKER))?;
    let args = line.trim_start_matches(MARKER).trim().to_string();
    if args.is_empty() {
        None
    } else {
        Some(args)
    }
}

/// Make sure the ClosedMesh Scheduled Task exists and points at `bin`
/// with the right argument string. No-op when the task already matches
/// what we'd write.
///
/// Why this exists: pre-0.1.62 the desktop app's `start_service_if_installed`
/// happily downloaded `closedmesh.exe` to `~/.local/bin/` on Windows, then
/// called `closedmesh service start` — which on Windows just runs
/// `schtasks /Run /TN ClosedMesh` and errors if the task isn't registered.
/// Result: a friend who installed the .msi and opened the app got
/// "In-app install isn't wired for Windows yet. Run install.ps1 manually
/// for now." This function closes that gap so .msi → first launch → online
/// is the same one-step flow as macOS .dmg → first launch → online.
#[cfg(target_os = "windows")]
fn register_windows_scheduled_task(bin: &std::path::Path) {
    let args = build_windows_service_args(bin);

    // Skip the re-register if the task already matches. PowerShell
    // canonicalizes the Arguments string slightly differently from how
    // we feed it in (no leading whitespace, normalised internal spacing),
    // so compare on a normalised form rather than byte-equal.
    let normalised = |s: &str| {
        s.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    if let Some(existing) = current_windows_task_args(bin) {
        if normalised(&existing) == normalised(&args) {
            return;
        }
        eprintln!(
            "[closedmesh] scheduled task args changed; re-registering ({SERVICE_NAME_WINDOWS})"
        );
    } else {
        eprintln!(
            "[closedmesh] scheduled task '{SERVICE_NAME_WINDOWS}' not registered (or pre-VBS-launcher); creating it"
        );
    }

    let user_name = std::env::var("USERNAME").unwrap_or_default();
    if user_name.is_empty() {
        eprintln!("[closedmesh] cannot register scheduled task: USERNAME env var is empty");
        return;
    }
    let working_dir = std::env::var("USERPROFILE")
        .ok()
        .or_else(|| dirs::home_dir().map(|p| p.display().to_string()))
        .unwrap_or_else(|| ".".to_string());

    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join("closedmesh-register-task.ps1");
    if let Err(e) = std::fs::write(&script_path, REGISTER_TASK_PS) {
        eprintln!(
            "[closedmesh] could not stage register-task script at {}: {e}",
            script_path.display()
        );
        return;
    }

    let bin_str = bin.display().to_string();
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script_path)
        .arg("-BinPath")
        .arg(&bin_str)
        .arg("-ArgString")
        .arg(&args)
        .arg("-UserName")
        .arg(&user_name)
        .arg("-WorkingDirectory")
        .arg(&working_dir)
        .arg("-TaskName")
        .arg(SERVICE_NAME_WINDOWS)
        .hide_console()
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[closedmesh] register-scheduled-task spawn failed: {e}");
            let _ = std::fs::remove_file(&script_path);
            return;
        }
    };
    let _ = std::fs::remove_file(&script_path);
    if !output.status.success() {
        eprintln!(
            "[closedmesh] register-scheduled-task failed (exit {:?}): stderr={:?} stdout={:?}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim(),
            String::from_utf8_lossy(&output.stdout).trim(),
        );
        return;
    }
    eprintln!(
        "[closedmesh] scheduled task '{SERVICE_NAME_WINDOWS}' registered for {} (user {user_name})",
        bin.display()
    );
}

// ---------- Runtime auto-install ----------------------------------------

/// GitHub "latest release" asset URL for the closedmesh-llm runtime. The
/// `/releases/latest/download/<asset>` shape redirects to whatever GitHub
/// currently considers the latest non-prerelease — meaning desktop builds
/// don't have to know specific tag names, the runtime can ship updates
/// independently, and the desktop self-installer picks them up on the
/// next first-launch (or any launch where the user has nuked the binary).
const RUNTIME_RELEASE_BASE: &str =
    "https://github.com/closedmesh/closedmesh-llm/releases/latest/download";

/// Return `true` if the installed runtime binary is new enough to support
/// all the flags we emit in the launchd plist (`--relay`, `--join`,
/// `--headless`, `--publish`) AND has the 30-second iroh relay timeout
/// required for Apple Silicon machines on Tailscale/CGNAT to be reachable
/// from the cloud entry node. The minimum acceptable version is `0.65.0`
/// (full release — rc1 and rc2 both had a 5s relay timeout that silently
/// produced relay-less iroh invites, leaving home-network nodes invisible
/// to the entry node and the production website).
///
/// We call `closedmesh --version`, parse the `major.minor.patch` triplet
/// from the first token that looks like a semantic version, and compare
/// against the threshold (0, 65, 0). Pre-release suffixes are rejected.
///
/// Any binary that refuses to run, produces no version output, or has an
/// unparseable version string is conservatively rejected so it gets
/// replaced with a known-good download.
fn runtime_meets_minimum(bin: &std::path::Path) -> bool {
    let out = match Command::new(bin).arg("--version").hide_console().output() {
        Ok(o) => o,
        Err(e) => {
            eprintln!(
                "[closedmesh] runtime version check failed ({}): {e}",
                bin.display()
            );
            return false;
        }
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let text = text.trim();
    eprintln!("[closedmesh] runtime reports version: {text:?}");

    // Find the first substring that looks like "MAJOR.MINOR.PATCH…"
    let version_token = text
        .split_whitespace()
        .find(|t| t.chars().next().map_or(false, |c| c.is_ascii_digit()))
        .unwrap_or(text);

    // Parse "0.65.0-rc2" → (0, 65, 0, Some("rc2"))
    let (maj, min, patch, pre) = parse_semver(version_token);

    // Accept any version that is strictly greater than 0.65.0, or is
    // exactly 0.65.0 without a pre-release suffix. rc1 and rc2 both had
    // a 5-second iroh relay timeout that was too short for Apple Silicon
    // machines on Tailscale/CGNAT — they publish relay-less iroh invites
    // and are unreachable from the cloud entry node. The full 0.65.0
    // release bumps this to 30s and fixes the "Mesh online · 0 models"
    // symptom for home-network users.
    if (maj, min, patch) > (0, 65, 0) {
        return true;
    }
    if (maj, min, patch) == (0, 65, 0) {
        return pre.is_none(); // only the full release, not rc1/rc2
    }
    // (maj, min, patch) < (0, 65, 0) — definitely too old
    false
}

/// Parse "0.65.0-rc2" into (0u32, 65u32, 0u32, Some("rc2")).
/// Returns (0, 0, 0, None) for any unparseable input.
fn parse_semver(s: &str) -> (u32, u32, u32, Option<String>) {
    let (numeric, pre) = match s.find('-') {
        Some(i) => (&s[..i], Some(s[i + 1..].to_string())),
        None => (s, None),
    };
    let parts: Vec<u32> = numeric.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    let maj = parts.first().copied().unwrap_or(0);
    let min = parts.get(1).copied().unwrap_or(0);
    let patch = parts.get(2).copied().unwrap_or(0);
    (maj, min, patch, pre)
}

/// First-launch installer for the `closedmesh` CLI runtime.
///
/// The .app is a thin shell — it talks to a separate runtime binary that
/// does the real work (joining the mesh, hosting llama.cpp, exposing the
/// admin/OpenAI APIs). For the longest time the runtime had to be installed
/// separately via `curl … | sh`, which means a "download the .app and chat"
/// pitch to non-technical users hit a wall the moment they opened the app.
///
/// This function closes that gap: if `locate_binary` came up empty, we
/// fetch the platform-appropriate tarball from the latest closedmesh-llm
/// GitHub release, extract it into `~/.local/bin/closedmesh`, and return
/// the resolved path. The caller (`start_service_if_installed`) then runs
/// the normal launchd self-heal + service start on it.
///
/// Failure modes (all return `None`):
///   - Unsupported platform (no published asset for our OS/arch).
///   - Network / GitHub failure (offline, rate limit).
///   - Tarball extraction failure (corrupt download, missing `tar`).
///
/// In all of those cases we land in the same "service not running"
/// branch we'd have hit without the auto-installer — strictly an
/// improvement over the previous behavior.
fn ensure_runtime_installed() -> Option<PathBuf> {
    let asset = runtime_asset_name()?;
    let dest = runtime_install_path()?;

    if dest.is_file() {
        // Race: someone (e.g. a parallel `install.sh` run) put the binary
        // in place while we were probing. Use it.
        return Some(dest);
    }

    eprintln!("[closedmesh] runtime not found; fetching {asset} from GitHub releases");

    let url = format!("{RUNTIME_RELEASE_BASE}/{asset}");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(120))
        .redirects(8)
        .build();

    let resp = match agent.get(&url).call() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[closedmesh] runtime download failed: GET {url}: {e}");
            return None;
        }
    };

    // Stream the tarball into a temp file in the same dir we'll extract
    // to, so the rename/move at the end is on the same filesystem.
    let parent = dest.parent()?;
    let _ = std::fs::create_dir_all(parent);
    let tmp_archive = parent.join(format!(".closedmesh.{asset}.partial"));

    let mut reader = resp.into_reader();
    let mut tmp_file = match std::fs::File::create(&tmp_archive) {
        Ok(f) => f,
        Err(e) => {
            eprintln!(
                "[closedmesh] runtime install: create {} failed: {e}",
                tmp_archive.display()
            );
            return None;
        }
    };
    if let Err(e) = std::io::copy(&mut reader, &mut tmp_file) {
        eprintln!("[closedmesh] runtime download: stream failed: {e}");
        let _ = std::fs::remove_file(&tmp_archive);
        return None;
    }
    drop(tmp_file);

    let extracted_ok = if asset.ends_with(".tar.gz") {
        extract_tar_gz(&tmp_archive, parent)
    } else if asset.ends_with(".zip") {
        extract_zip(&tmp_archive, parent)
    } else {
        eprintln!("[closedmesh] runtime install: unknown archive type for {asset}");
        false
    };

    let _ = std::fs::remove_file(&tmp_archive);

    if !extracted_ok {
        return None;
    }

    if !dest.is_file() {
        eprintln!(
            "[closedmesh] runtime install: extraction succeeded but {} is missing",
            dest.display()
        );
        return None;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&dest) {
            let mut perm = meta.permissions();
            perm.set_mode(0o755);
            let _ = std::fs::set_permissions(&dest, perm);
        }
    }

    // macOS Gatekeeper quarantines binaries downloaded by a quarantined
    // .app. The runtime would refuse to launch with "killed: 9" on first
    // try and only work after the user did the System Settings -> Open
    // Anyway dance. Strip the attribute if it's there — best-effort,
    // non-fatal.
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(&dest)
            .hide_console()
            .output();
    }

    eprintln!("[closedmesh] runtime installed at {}", dest.display());
    Some(dest)
}

/// GitHub release asset name for our build target. `None` means we don't
/// publish a runtime for this platform yet — the caller should leave the
/// binary uninstalled and the user falls through to the chat-from-website
/// experience instead of running a node locally.
///
/// Windows is the odd one out: the runtime release ships
/// `closedmesh-windows-x86_64-{cuda,vulkan}.zip` (flavor-specific), not
/// a single `closedmesh-windows-x86_64.zip`. Pre-0.1.72 we returned the
/// flavorless filename here and silently 404'd on every Windows
/// auto-update / `repair_missing_helpers` call — which is why a user who
/// upgraded the desktop without re-clicking Setup never picked up
/// `rpc-server.exe`. Default to vulkan because it works on every GPU
/// (NVIDIA / AMD / Intel) without a system CUDA install; the user can
/// override via `CLOSEDMESH_BACKEND=cuda` if they actually have a
/// modern NVIDIA card and CUDA 12.x runtime present.
fn runtime_asset_name() -> Option<String> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("closedmesh-darwin-aarch64.tar.gz".to_string())
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("closedmesh-darwin-x86_64.tar.gz".to_string())
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("closedmesh-linux-x86_64.tar.gz".to_string())
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("closedmesh-linux-aarch64.tar.gz".to_string())
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        let flavor = match std::env::var("CLOSEDMESH_BACKEND")
            .ok()
            .map(|v| v.trim().to_ascii_lowercase())
            .as_deref()
        {
            Some("cuda") => "cuda",
            Some("cpu") => "cpu",
            _ => "vulkan",
        };
        Some(format!("closedmesh-windows-x86_64-{flavor}.zip"))
    } else {
        None
    }
}

/// Where the auto-installer puts the binary. Matches the locations
/// `locate_binary` already searches, so a successful install is
/// transparent to the rest of the codebase.
fn runtime_install_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let dir = home.join(".local").join("bin");
    let name = if cfg!(windows) {
        "closedmesh.exe"
    } else {
        "closedmesh"
    };
    Some(dir.join(name))
}

/// Extracts a `.tar.gz` archive into `dest_dir`, expecting the bundled
/// `closedmesh` binary at the archive root. We shell out to `tar`
/// because every platform we target ships it (macOS, Linux, and
/// Windows 10 1803+), and pulling in `flate2` + `tar` crates would
/// double the desktop binary size for one-shot first-launch use.
fn extract_tar_gz(archive: &std::path::Path, dest_dir: &std::path::Path) -> bool {
    let output = match Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(dest_dir)
        .hide_console()
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[closedmesh] runtime install: spawn `tar` failed: {e}");
            return false;
        }
    };
    if !output.status.success() {
        eprintln!(
            "[closedmesh] runtime install: tar -xzf failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return false;
    }
    true
}

/// Same as `extract_tar_gz` but for `.zip` (Windows runtime artifacts).
/// Windows 10 1803+ ships a `tar` that handles `.zip`, so we use the
/// same tool everywhere instead of plumbing a separate code path.
fn extract_zip(archive: &std::path::Path, dest_dir: &std::path::Path) -> bool {
    let output = match Command::new("tar")
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(dest_dir)
        .hide_console()
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[closedmesh] runtime install: spawn `tar` failed (zip): {e}");
            return false;
        }
    };
    if !output.status.success() {
        eprintln!(
            "[closedmesh] runtime install: tar -xf (zip) failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return false;
    }
    true
}

// ---------- Binary discovery --------------------------------------------

/// Resolves the `closedmesh` binary. Order matches the deprecated Swift
/// implementation, plus Windows-specific install locations.
fn locate_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CLOSEDMESH_BIN") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/closedmesh"));
        if cfg!(windows) {
            candidates.push(home.join(".local/bin/closedmesh.exe"));
            // install.ps1 (the PowerShell installer) drops the runtime
            // here. Discovering it lets a user who installed via
            // `iwr | iex` skip the redundant Rust download on first
            // launch — and lets the dashboard's Setup-button install
            // path (which also runs install.ps1) reuse its own output
            // instead of duplicating work.
            candidates.push(home.join("AppData/Local/closedmesh/bin/closedmesh.exe"));
            // Legacy path from earlier install.ps1 versions.
            candidates.push(home.join("AppData/Local/closedmesh/closedmesh.exe"));
        }
    }
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/bin/closedmesh"));
        candidates.push(PathBuf::from("/usr/local/bin/closedmesh"));
    } else if cfg!(target_os = "linux") {
        candidates.push(PathBuf::from("/usr/local/bin/closedmesh"));
        candidates.push(PathBuf::from("/usr/bin/closedmesh"));
    }

    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }

    // Last resort: walk $PATH. `which` is the canonical Unix tool but
    // pulling the `which` crate just for this would be silly.
    if let Ok(path_env) = std::env::var("PATH") {
        let exe_name = if cfg!(windows) {
            "closedmesh.exe"
        } else {
            "closedmesh"
        };
        let separator = if cfg!(windows) { ';' } else { ':' };
        for dir in path_env.split(separator) {
            let candidate = PathBuf::from(dir).join(exe_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn run_cli(args: &[&str]) {
    let Some(bin) = locate_binary() else { return };
    // The tray polls `:3131/api/status` for ground truth, so we don't need
    // to parse output for success. But we do log failures so they appear in
    // macOS Console (searchable with "closedmesh" subsystem) and in any
    // attached terminal session.
    match Command::new(&bin).args(args).hide_console().output() {
        Ok(out) if !out.status.success() => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            eprintln!(
                "[closedmesh] {} {:?} failed (exit {:?}){}{}",
                bin.display(),
                args,
                out.status.code(),
                if stderr.trim().is_empty() {
                    String::new()
                } else {
                    format!(": {}", stderr.trim())
                },
                if stdout.trim().is_empty() {
                    String::new()
                } else {
                    format!(" [stdout: {}]", stdout.trim())
                },
            );
        }
        Err(e) => {
            eprintln!(
                "[closedmesh] failed to spawn {} {:?}: {e}",
                bin.display(),
                args,
            );
        }
        _ => {}
    }
}
