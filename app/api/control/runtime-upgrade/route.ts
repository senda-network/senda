import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { isPublic } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runtime auto-upgrade bridge between the Rust desktop shell and the
 * dashboard.
 *
 * The Rust shell's `spawn_runtime_upgrade_loop` (desktop/src/mesh.rs)
 * writes a small JSON file to the platform desktop-log directory after
 * every check outcome (`upgraded`, `up_to_date`, `failed`). The
 * dashboard polls this endpoint to surface:
 *
 *   - the installed runtime version (so users can stop wondering
 *     "is the upgrade even happening?"),
 *   - the latest published version when known,
 *   - whether a check / swap is currently in flight,
 *   - the most-recent completed swap (drives the "Runtime upgraded
 *     X -> Y" toast).
 *
 * POSTing to this endpoint drops a `runtime-upgrade-request.flag`
 * sibling file. The Rust loop polls for that file every few seconds
 * during its long sleeps and consumes it to break out and run a check
 * early — that's the "Check for update now" button on the dashboard.
 *
 * Why a state file rather than a Tauri command + IPC: the dashboard
 * runs inside a Tauri webview pointing at a Next.js sidecar process
 * (Node.js), not at the Rust shell directly. There's no first-party
 * channel for the JS side to call a Rust function. A tiny JSON file
 * in `~/Library/Logs/closedmesh/` (or platform equivalent) lets the
 * two processes communicate with zero coupling, survives sidecar
 * restarts, and shows up in the existing log directory the user can
 * already inspect when something goes wrong.
 */

const REQUEST_FILE_BASENAME = "runtime-upgrade-request.flag";
const STATE_FILE_BASENAME = "runtime-upgrade-state.json";

/**
 * Platform desktop-log directory. Must agree with
 * `desktop/src/mesh.rs::default_log_dir`. Hardcoding the same paths
 * here (rather than letting the Rust shell tell us via env var) keeps
 * the controller's read path stable across the desktop app being
 * killed mid-write — and matches the convention used by `LOG_PATHS`
 * in `_lib.ts`, which already hardcodes the same platform layout.
 */
function logDir(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Logs", "closedmesh");
  }
  if (process.platform === "linux") {
    return path.join(home, ".local", "state", "closedmesh");
  }
  // Windows: dirs::data_dir() resolves to %APPDATA%\Roaming on Win10+;
  // the Rust side appends "closedmesh\logs". Note this differs from the
  // runtime's own log location (%LOCALAPPDATA%\closedmesh\logs) used by
  // LOG_PATHS — the desktop shell deliberately writes its own logs
  // under Roaming\closedmesh\logs to keep "desktop event log" and
  // "runtime stdout/stderr" separate, so the user can rotate one
  // without nuking the other.
  return path.join(
    process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
    "closedmesh",
    "logs",
  );
}

/**
 * State written by the Rust upgrade loop. Mirrors the struct in
 * `desktop/src/mesh.rs` — keep the field names in sync (camelCase
 * because the Rust side serializes with `#[serde(rename_all = "camelCase")]`).
 * Treat every field as optional on read: an older desktop build may
 * write fewer fields, and a partial write during a crash should
 * gracefully degrade to "controller can't read state" rather than
 * 500.
 */
type StateFile = {
  schemaVersion?: number;
  checkedAt?: string;
  installedVersion?: string | null;
  latestVersion?: string | null;
  lastOutcome?: "upgraded" | "up_to_date" | "failed" | null;
  checking?: boolean;
  lastUpgrade?: {
    from: string;
    to: string;
    at: string;
  } | null;
};

type GetResp =
  | {
      ok: true;
      installedVersion: string | null;
      latestVersion: string | null;
      checkedAt: string | null;
      lastOutcome: "upgraded" | "up_to_date" | "failed" | null;
      checking: boolean;
      lastUpgrade: { from: string; to: string; at: string } | null;
    }
  | { ok: false; message: string };

type PostResp =
  | { ok: true; queued: true; path: string }
  | { ok: false; message: string };

export async function GET() {
  if (isPublic) {
    return NextResponse.json<GetResp>(
      {
        ok: false,
        message:
          "Runtime upgrade state isn't available on the hosted public site.",
      },
      { status: 200 },
    );
  }

  const filepath = path.join(logDir(), STATE_FILE_BASENAME);
  let raw: string;
  try {
    raw = await fs.readFile(filepath, "utf-8");
  } catch (err: unknown) {
    // ENOENT is by far the most common path here — the upgrade loop
    // hasn't run yet (fresh install) or this is a desktop build older
    // than the one that started writing the state file. Either way the
    // dashboard should quietly degrade: just hide the runtime-version
    // line rather than show "couldn't read state" as a scary error.
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return NextResponse.json<GetResp>({
        ok: true,
        installedVersion: null,
        latestVersion: null,
        checkedAt: null,
        lastOutcome: null,
        checking: false,
        lastUpgrade: null,
      });
    }
    return NextResponse.json<GetResp>({
      ok: false,
      message:
        err instanceof Error ? err.message : "couldn't read upgrade state",
    });
  }

  let parsed: StateFile;
  try {
    parsed = JSON.parse(raw) as StateFile;
  } catch (err) {
    // Mid-write torn JSON. The Rust side writes via tempfile + rename
    // so this should be impossible, but in case it ever isn't, return
    // a soft-null state rather than 500'ing the dashboard.
    return NextResponse.json<GetResp>({
      ok: false,
      message: err instanceof Error ? err.message : "state file malformed",
    });
  }

  return NextResponse.json<GetResp>({
    ok: true,
    installedVersion: parsed.installedVersion ?? null,
    latestVersion: parsed.latestVersion ?? null,
    checkedAt: parsed.checkedAt ?? null,
    lastOutcome: parsed.lastOutcome ?? null,
    checking: parsed.checking ?? false,
    lastUpgrade: parsed.lastUpgrade ?? null,
  });
}

export async function POST() {
  if (isPublic) {
    return NextResponse.json<PostResp>(
      {
        ok: false,
        message:
          "Runtime upgrade requests aren't available on the hosted public site.",
      },
      { status: 200 },
    );
  }

  const dir = logDir();
  const filepath = path.join(dir, REQUEST_FILE_BASENAME);
  try {
    // Best-effort directory creation. The desktop shell creates the
    // log dir on its own startup, so this is just defense in depth
    // for the case where the controller spawns first.
    await fs.mkdir(dir, { recursive: true });
    // Write the wall-clock timestamp the request was created so the
    // Rust side can age out a stale flag if it sat around through a
    // sleep -> machine-suspend -> wake cycle. The Rust loop only
    // checks the file's existence, but having something useful in
    // the body costs us nothing and helps post-mortem debugging.
    await fs.writeFile(filepath, new Date().toISOString(), "utf-8");
  } catch (err) {
    return NextResponse.json<PostResp>({
      ok: false,
      message:
        err instanceof Error ? err.message : "couldn't queue upgrade request",
    });
  }

  return NextResponse.json<PostResp>({
    ok: true,
    queued: true,
    path: filepath,
  });
}
