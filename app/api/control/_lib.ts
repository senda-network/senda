import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// `.trim()` defensively — a stray trailing newline in the Vercel env var
// (`"public\n"` vs `"public"`) would silently turn this flag off otherwise,
// and any /api/control/* handler would happily try to spawn closedmesh on
// a Vercel function. Belt-and-braces alongside proxy.ts.
function flagSet(value: string | undefined): boolean {
  return (value ?? "").trim() === "public";
}

export const isPublic =
  flagSet(process.env.NEXT_PUBLIC_DEPLOYMENT) ||
  flagSet(process.env.CLOSEDMESH_DEPLOYMENT) ||
  flagSet(process.env.FORGEMESH_DEPLOYMENT);

const explicit = process.env.CLOSEDMESH_BIN ?? process.env.FORGEMESH_BIN;
const isWindows = process.platform === "win32";

// Pre-0.1.66 this list was Unix-only and `/api/control/status` always
// returned `available: false` on Windows even after install.ps1 had
// dropped a binary at AppData\Local\closedmesh\bin\closedmesh.exe.
// Setup.tsx polled the endpoint after install, never saw available
// flip to true, and showed "Something went wrong. Try again." which
// gave the impression the install had failed when it had actually
// fully succeeded.
const candidates = [
  explicit,
  // Windows: install.ps1 (Setup-button install path) drops the binary
  // here; the Rust auto-install path on first launch matches.
  isWindows
    ? path.join(homedir(), "AppData", "Local", "closedmesh", "bin", "closedmesh.exe")
    : null,
  // Windows: secondary location used by Rust ensure_runtime_installed
  // when the .ps1 path doesn't exist yet (and on Unix, the canonical
  // user-local install path).
  isWindows
    ? path.join(homedir(), ".local", "bin", "closedmesh.exe")
    : path.join(homedir(), ".local", "bin", "closedmesh"),
  // macOS: Homebrew (Apple Silicon and Intel respectively).
  isWindows ? null : "/opt/homebrew/bin/closedmesh",
  isWindows ? null : "/usr/local/bin/closedmesh",
  // Legacy fallbacks (one release of grace from the forgemesh rename).
  isWindows
    ? path.join(homedir(), "AppData", "Local", "forgemesh", "bin", "forgemesh.exe")
    : path.join(homedir(), ".local", "bin", "forgemesh"),
  isWindows ? null : "/opt/homebrew/bin/forgemesh",
  isWindows ? null : "/usr/local/bin/forgemesh",
].filter((p): p is string => typeof p === "string" && p.length > 0);

let cachedBin: string | null = null;

/**
 * Locate the closedmesh runtime binary on disk.
 *
 * We cache the resolved path because `/api/control/status` polls every 4s
 * and stat'ing 6+ candidate paths on every poll is wasteful. But we
 * *re-verify* the cached path is still executable before returning it —
 * otherwise an uninstall (whether through the UI's `service uninstall`
 * flow or a manual `rm`) leaves the dashboard claiming the runtime is
 * still here, never showing the Setup screen again until the controller
 * is restarted. Re-stat'ing one path is essentially free.
 */
// Windows reports `mode` bits from the read-only attribute, not Unix
// execute permissions, so the `mode & 0o111` check that guards the
// Unix paths against accidental matches on data files would always
// fail on Windows even when closedmesh.exe is perfectly executable.
// The .exe extension is the platform's executability signal anyway.
function isExecutable(stat: import("node:fs").Stats): boolean {
  if (isWindows) return stat.isFile();
  return stat.isFile() && (stat.mode & 0o111) !== 0;
}

export async function findClosedmeshBin(): Promise<string | null> {
  if (cachedBin) {
    try {
      const stat = await fs.stat(cachedBin);
      if (isExecutable(stat)) return cachedBin;
    } catch {
      // fall through and rescan; the cached path is no longer valid
    }
    cachedBin = null;
  }
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (isExecutable(stat)) {
        cachedBin = candidate;
        return candidate;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export type RunResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

export function runClosedmesh(
  bin: string,
  args: string[],
  timeoutMs = 8000,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      // CRITICAL on Windows: this controller runs as a Node sidecar of the
      // Tauri desktop app, which is a GUI process (`windows_subsystem =
      // "windows"`). When such a parent spawns a console-subsystem child
      // like `closedmesh.exe`, `schtasks.exe`, or `tar.exe`, Windows
      // allocates a brand-new console window for it. With `/api/control/*`
      // routes invoked on every dashboard tick, that meant a terminal
      // window flashed on the user's screen 4× a second forever — the
      // "opening terminals like crazy" symptom. `windowsHide` translates
      // to `CREATE_NO_WINDOW` (0x0800_0000) on the underlying CreateProcess
      // call, which suppresses the allocation. No effect on macOS / Linux.
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code: code ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: stderr || "spawn failed" });
    });
  });
}

// Where the runtime writes its stdout / stderr on each platform.
// /api/control/logs tails these files for the dashboard's Activity page.
//
// On macOS and Linux, the OS-native autostart unit (launchd plist /
// systemd unit, set up by `closedmesh service install`) does the
// redirection itself — same paths the runtime CLI's `service status`
// and homebrew formulas reference.
//
// On Windows there's no equivalent in the Scheduled Task XML, so the
// VBS launcher generated by install.ps1 / mesh.rs::REGISTER_TASK_PS
// runs the runtime through `cmd /S /c ... >> stdout.log 2>> stderr.log`
// targeting %LOCALAPPDATA%\closedmesh\logs. Pre-0.1.68 this constant
// hard-coded the macOS path on every platform — meaning the
// dashboard's Activity page was permanently empty on Windows even
// when the runtime was logging fine, which made an apparent-stuck
// model load impossible to diagnose.
export const LOG_PATHS =
  process.platform === "win32"
    ? {
        stdout: path.join(
          homedir(),
          "AppData",
          "Local",
          "closedmesh",
          "logs",
          "stdout.log",
        ),
        stderr: path.join(
          homedir(),
          "AppData",
          "Local",
          "closedmesh",
          "logs",
          "stderr.log",
        ),
      }
    : process.platform === "darwin"
      ? {
          stdout: path.join(
            homedir(),
            "Library",
            "Logs",
            "closedmesh",
            "stdout.log",
          ),
          stderr: path.join(
            homedir(),
            "Library",
            "Logs",
            "closedmesh",
            "stderr.log",
          ),
        }
      : {
          // Linux: matches the systemd unit that closedmesh-llm's
          // `service install` writes to ~/.config/systemd/user/.
          stdout: path.join(
            homedir(),
            ".local",
            "state",
            "closedmesh",
            "stdout.log",
          ),
          stderr: path.join(
            homedir(),
            ".local",
            "state",
            "closedmesh",
            "stderr.log",
          ),
        };

/**
 * The `closedmesh service start` command can emit a multi-section status
 * dump after an error (the "closedmesh ┌ Running …" block, or the legacy
 * "mesh-llm" equivalent on older runtimes). Strip that noise and return
 * only the first meaningful error lines so the dashboard toast stays
 * readable.
 */
export function extractStartError(raw: string): string {
  if (!raw) return "start failed";
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // The status dump starts with a bare binary-name line ("closedmesh" on
  // current builds, "mesh-llm" on the legacy CLI) or with box-drawing
  // characters (┌ / └─). Everything before that is the actual error from
  // launchctl / the CLI itself.
  const dumpStart = lines.findIndex(
    (l) =>
      l === "mesh-llm" ||
      l === "closedmesh" ||
      l === "> closedmesh" ||
      l.startsWith("┌ ") ||
      l.startsWith("└─"),
  );
  const errorLines = dumpStart > 0 ? lines.slice(0, dumpStart) : lines.slice(0, 4);
  return errorLines.join(" ").trim() || raw.slice(0, 300);
}

/**
 * True when the CLI's failure looks like the launchctl race that hits
 * when `bootstrap` fires before the previous `bootout` has finished
 * unloading — exit code 5 / "Input/output error". The runtime CLI has
 * no retry for this; a 2 s wait followed by a second `service start`
 * almost always succeeds because launchd's async unload completes in
 * the meantime.
 */
export function isLaunchctlBootstrapRace(stderr: string, stdout: string): boolean {
  const blob = `${stderr}\n${stdout}`.toLowerCase();
  return (
    blob.includes("bootstrap failed") ||
    blob.includes("launchctl bootstrap failed") ||
    /exit code\s+(?:some\()?5\)?/i.test(blob) ||
    blob.includes("input/output error")
  );
}

export async function tailFile(filepath: string, maxBytes = 16_384) {
  try {
    const stat = await fs.stat(filepath);
    const start = Math.max(0, stat.size - maxBytes);
    const handle = await fs.open(filepath, "r");
    try {
      const buf = Buffer.alloc(stat.size - start);
      await handle.read(buf, 0, buf.length, start);
      return buf.toString("utf-8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}
