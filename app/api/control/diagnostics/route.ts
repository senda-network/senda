import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";

import { isPublic, LOG_PATHS, tailFile } from "../_lib";
import {
  ensureInstallId,
  readControllerSettings,
} from "../../../lib/controller-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local diagnostics collector + forwarder.
 *
 * The dashboard POSTs here when a machine looks stuck (automatically, if
 * the user opted in; or on an explicit "Send diagnostic report" click).
 * This handler runs inside the desktop's Node sidecar — so unlike the
 * runtime's own phone-home path, it can report even when the runtime
 * process itself is dead (which is exactly the case we most want to
 * catch). It:
 *
 *   1. gates auto-sends on the opt-in flag (manual sends are explicit
 *      consent and always allowed),
 *   2. gathers local-only context the client can't see (scrubbed stderr
 *      tail, runtime auto-upgrade state, OS/arch, desktop app version
 *      from the SENDA_APP_VERSION env the Tauri shell injects),
 *   3. merges the client-supplied context (backend, VRAM, phase, …),
 *   4. forwards a scrubbed bundle to `${DIAG_BASE}/api/diagnostics`.
 *
 * Nothing here ever reads or forwards chat content.
 */

const DIAG_BASE = (
  process.env.SENDA_DIAGNOSTICS_URL ??
  process.env.SENDA_PUBLIC_ORIGIN ??
  "https://senda.network"
).trim();

const REQUEST_TIMEOUT_MS = 8000;

// Keep the log bundle small: last chunk of each source, then trimmed
// after scrubbing. We pack stderr + stdout + Windows VBS markers +
// desktop.log into `stderrTail` so an empty runtime stderr (crash
// before first write, or a one-shot truncate) cannot blind triage.
const STDERR_TAIL_BYTES = 12_288;
const STDOUT_TAIL_BYTES = 8_192;
const DESKTOP_LOG_TAIL_BYTES = 6_144;
const STDERR_TAIL_LINES = 160;

type ClientContext = Partial<{
  runtimeVersion: string | null;
  desktopVersion: string | null;
  backend: string | null;
  vramGb: number | null;
  modelSizeGb: number | null;
  startupModel: string | null;
  loadedModels: string[];
  serviceState: string | null;
  runtimeReachable: boolean;
  phase: string | null;
}>;

type PostBody = Partial<{
  trigger: "auto" | "manual";
  context: ClientContext;
  note: string | null;
}>;

function logDir(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Logs", "senda");
  }
  if (process.platform === "linux") {
    return path.join(home, ".local", "state", "senda");
  }
  return path.join(
    process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
    "senda",
    "logs",
  );
}

type UpgradeState = {
  installed: string | null;
  latest: string | null;
  lastOutcome: string | null;
  lastError: string | null;
};

async function readUpgradeState(): Promise<UpgradeState | null> {
  const filepath = path.join(logDir(), "runtime-upgrade-state.json");
  try {
    const raw = await fs.readFile(filepath, "utf-8");
    const p = JSON.parse(raw) as {
      installedVersion?: string | null;
      latestVersion?: string | null;
      lastOutcome?: string | null;
      lastError?: string | null;
    };
    return {
      installed: p.installedVersion ?? null,
      latest: p.latestVersion ?? null,
      lastOutcome: p.lastOutcome ?? null,
      lastError: p.lastError ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort redaction of anything that could identify the user or leak
 * a secret from a log tail. Never perfect, but removes the obvious
 * offenders: the home-directory path, the OS username, join tokens, and
 * bearer credentials. We also strip long opaque token-shaped strings.
 */
function scrub(text: string): string {
  if (!text) return "";
  let out = text;
  const home = homedir();
  if (home) out = out.split(home).join("~");
  try {
    const user = userInfo().username;
    if (user && user.length >= 3) {
      out = out.split(user).join("<user>");
    }
  } catch {
    // userInfo can throw on exotic setups — skip username scrubbing.
  }
  out = out.replace(/(--join(?:-url)?[=\s]+)\S+/gi, "$1<redacted>");
  out = out.replace(/(authorization:\s*bearer\s+)\S+/gi, "$1<redacted>");
  out = out.replace(/([Tt]oken[=:\s]+)\S{12,}/g, "$1<redacted>");
  // Long opaque tokens (base64/hex-ish) that survived the above.
  out = out.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<redacted-token>");
  const lines = out.split(/\r?\n/);
  return lines.slice(-STDERR_TAIL_LINES).join("\n");
}

function str(v: unknown, max = 256): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v.length <= max ? v : v.slice(0, max);
}

/** Windows Scheduled Task launcher markers (bin + args + config pin). */
async function readWindowsServiceMarkers(): Promise<string> {
  if (process.platform !== "win32") return "";
  const local =
    process.env.LOCALAPPDATA ??
    path.join(homedir(), "AppData", "Local");
  const vbs = path.join(local, "senda", "bin", "senda-launch.vbs");
  try {
    const body = await fs.readFile(vbs, "utf-8");
    const keep = body
      .split(/\r?\n/)
      .filter((line) => {
        const t = line.trim();
        return (
          t.startsWith("' SENDA_BIN:") ||
          t.startsWith("' SENDA_ARGS:") ||
          t.startsWith("' SENDA_CONFIG:") ||
          t.includes("SENDA_CONFIG") ||
          t.includes("Environment(\"PROCESS\")(\"HOME\")") ||
          t.includes("DeleteFile")
        );
      })
      .slice(0, 40);
    return keep.join("\n");
  } catch {
    return `(missing ${vbs})`;
  }
}

async function readDesktopLogTail(): Promise<string> {
  // Tauri shell log — survives even when the runtime never writes stderr.
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
            "senda",
            "logs",
            "senda.log",
          ),
          path.join(
            process.env.LOCALAPPDATA ??
              path.join(homedir(), "AppData", "Local"),
            "senda",
            "logs",
            "desktop.log",
          ),
        ]
      : process.platform === "darwin"
        ? [
            path.join(homedir(), "Library", "Logs", "senda", "senda.log"),
            path.join(homedir(), "Library", "Logs", "com.network.senda", "senda.log"),
          ]
        : [
            path.join(homedir(), ".local", "state", "senda", "desktop.log"),
          ];
  for (const p of candidates) {
    const raw = await tailFile(p, DESKTOP_LOG_TAIL_BYTES);
    if (raw.trim()) return `--- ${p} ---\n${raw}`;
  }
  return "";
}

/** Pack multiple local sources into one scrubbed triage blob. */
function packLogBundle(parts: { title: string; body: string }[]): string {
  const chunks: string[] = [];
  for (const { title, body } of parts) {
    const trimmed = body.trimEnd();
    chunks.push(`===== ${title} =====\n${trimmed || "(empty)"}`);
  }
  return scrub(chunks.join("\n\n"));
}

// Unambiguous "the runtime crashed / aborted / hit a hard error" markers.
// Deliberately conservative — no generic "error"/"warn" — so the crash
// sentinel that polls this only fires on genuine faults, and dedup by the
// matched line keeps a crash-loop from flooding the report store.
const CRASH_SIGNATURES: RegExp[] = [
  /panicked at/i,
  /thread '[^']*' panicked/i,
  /fatal runtime error/i,
  /GGML_ASSERT/,
  /terminate called after throwing/i,
  /segmentation fault/i,
  /\bSIG(SEGV|ABRT|BUS|ILL)\b/,
  /abort trap/i,
  /core dumped/i,
  /CUDA error/i,
];

/**
 * Scan the tail of the runtime's stderr for a hard-error signature. Read
 * only (nothing leaves the machine); the dashboard's crash sentinel polls
 * this and, when it sees a *new* signature, fires an opt-in `POST` report.
 * Returns the scrubbed matched line as the signature so the client can
 * dedup on it.
 */
export async function GET() {
  if (isPublic) {
    return NextResponse.json(
      { ok: false, message: "Diagnostics are only available in the desktop app." },
      { status: 403 },
    );
  }
  const raw = await tailFile(LOG_PATHS.stderr, STDERR_TAIL_BYTES);
  const lines = raw.split(/\r?\n/);
  // Walk from the end so we report the most recent crash line.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (CRASH_SIGNATURES.some((re) => re.test(line))) {
      const signature = scrub(line).trim().slice(0, 200);
      return NextResponse.json({
        ok: true,
        crash: { detected: true, signature },
      });
    }
  }
  return NextResponse.json({ ok: true, crash: { detected: false, signature: null } });
}

export async function POST(req: Request) {
  if (isPublic) {
    return NextResponse.json(
      { ok: false, message: "Diagnostics are only available in the desktop app." },
      { status: 403 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    body = {};
  }
  const trigger: "auto" | "manual" =
    body.trigger === "manual" ? "manual" : "auto";
  const ctx: ClientContext = body.context ?? {};

  const settings = await readControllerSettings();
  // Auto-sends require opt-in; a manual click is its own consent.
  if (trigger === "auto" && !settings.shareDiagnostics) {
    return NextResponse.json({ ok: true, sent: false, reason: "opted-out" });
  }
  if (!DIAG_BASE) {
    return NextResponse.json({ ok: true, sent: false, reason: "disabled" });
  }

  const installId = await ensureInstallId();
  const [upgrade, stderrRaw, stdoutRaw, serviceMarkers, desktopLogRaw] =
    await Promise.all([
      readUpgradeState(),
      tailFile(LOG_PATHS.stderr, STDERR_TAIL_BYTES),
      tailFile(LOG_PATHS.stdout, STDOUT_TAIL_BYTES),
      readWindowsServiceMarkers(),
      readDesktopLogTail(),
    ]);

  // The Tauri shell injects SENDA_APP_VERSION when it spawns this
  // controller (see desktop/src/sidecar.rs). Prefer an explicit
  // client-supplied value (e.g. a future UI that knows its own
  // version), then fall through to the env the shell already sets —
  // so already-shipped desktop builds report their version without a
  // rebuild.
  const desktopVersion =
    str(ctx.desktopVersion, 64) ??
    str(process.env.SENDA_APP_VERSION?.trim() || null, 64);

  const stderrTail = packLogBundle([
    { title: "stderr", body: stderrRaw },
    { title: "stdout", body: stdoutRaw },
    { title: "windows-service", body: serviceMarkers },
    { title: "desktop-log", body: desktopLogRaw },
  ]);

  const payload = {
    installId,
    trigger,
    os: process.platform,
    arch: process.arch,
    runtimeVersion: str(ctx.runtimeVersion, 64) ?? upgrade?.installed ?? null,
    desktopVersion,
    backend: str(ctx.backend, 32),
    vramGb:
      typeof ctx.vramGb === "number" && Number.isFinite(ctx.vramGb)
        ? ctx.vramGb
        : null,
    modelSizeGb:
      typeof ctx.modelSizeGb === "number" && Number.isFinite(ctx.modelSizeGb)
        ? ctx.modelSizeGb
        : null,
    startupModel: str(ctx.startupModel, 256),
    loadedModels: Array.isArray(ctx.loadedModels)
      ? ctx.loadedModels
          .map((m) => str(m, 256))
          .filter((m): m is string => !!m)
          .slice(0, 16)
      : [],
    serviceState: str(ctx.serviceState, 32),
    runtimeReachable: ctx.runtimeReachable === true,
    phase: str(ctx.phase, 256),
    upgrade,
    stderrTail,
    note: str(body.note, 1024),
  };

  const url = `${DIAG_BASE.replace(/\/+$/, "")}/api/diagnostics`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        sent: false,
        message: `diagnostics endpoint returned HTTP ${res.status}`,
      });
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return NextResponse.json({ ok: true, sent: true, id: data.id ?? null });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      sent: false,
      message: err instanceof Error ? err.message : "request failed",
    });
  }
}
