import { NextResponse } from "next/server";
import {
  CONFIG_PATH,
  readConfigFile,
  readStartupModels,
  writeConfigFile,
  writeStartupModels,
  type StartupModel,
} from "../../_config-toml";
import {
  extractStartError,
  findSendaBin,
  isLaunchctlBootstrapRace,
  isPublic,
  runSenda,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step-by-step instrumentation for the "Set as startup" bounce.
 *
 * The flow has historically been opaque: a user clicks the button, the
 * route shells out to `senda service stop`, an internal PowerShell
 * residual-kill, and `senda service start`, and we'd see only the
 * final ok/error message in the UI toast. When the desktop app crashed
 * mid-bounce on Windows (initial reports: a stray libuv UV_UNKNOWN
 * spawn failure left in `controller.stderr.log`) we had no way to tell
 * which child process failed.
 *
 * Every step now writes a one-line JSON record to stderr (which the
 * Tauri sidecar redirects to `controller.stderr.log`; see
 * `desktop/src/sidecar.rs`). Each line carries a per-request `rid`
 * tag so a single click is `rg '"rid":"<id>"' controller.stderr.log`.
 */
function reqId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function startupLog(rid: string, event: string, fields: Record<string, unknown> = {}): void {
  try {
    const entry = {
      tag: "startup",
      rid,
      event,
      ts: new Date().toISOString(),
      platform: process.platform,
      ...fields,
    };
    // Stderr (not stdout) so the existing Next.js banner spam in
    // controller.stdout.log doesn't drown the bounce trace.
    console.error(`[startup] ${JSON.stringify(entry)}`);
  } catch {
    // Logging must never fail the request. Swallow JSON.stringify
    // failures on circular fields (none expected, but cheap to guard).
  }
}

/** Trim a captured stderr/stdout blob for log embedding. */
function trim(s: string | undefined, n = 400): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…(+${s.length - n} chars)` : s;
}

/**
 * Manage which model(s) the local runtime loads on boot.
 *
 *   GET  → { ok, models: StartupModel[], configPath }
 *   POST { model: "Qwen3-8B-Q4_K_M", ctxSize?: 8192 }
 *        → replaces the [[models]] section with this single entry,
 *          then bounces the autostart unit so the runtime picks it up.
 *   DELETE → clears [[models]] entirely (node will start, but immediately
 *            warn it has no startup model).
 *
 * Why "replace" rather than "append": the desktop UI exposes a single
 * "Make this my startup model" button per row, which is what 95% of users
 * want for a single-Mac contributor flow. Power users with multi-model
 * setups can edit ~/.senda/config.toml by hand — this endpoint is a
 * convenience layer for the common case, not the only path.
 */

type StartupModelInput = {
  model?: string;
  ctxSize?: number;
  /**
   * Per-model "Run on the mesh" toggle. When true, writes `force_split = true`
   * to the `[[models]]` block; runtime then launches this model in
   * pipeline-parallel mode regardless of whether one host could fit it
   * solo. Omitted/false leaves the runtime default (no force).
   */
  forceSplit?: boolean;
};

type StartupResponse =
  | {
      ok: true;
      models: StartupModel[];
      configPath: string;
      restart?: { ok: boolean; message: string };
    }
  | { ok: false; message: string; models?: StartupModel[]; configPath?: string };

export async function GET() {
  if (isPublic) return forbiddenOnPublic();

  try {
    const content = await readConfigFile();
    const models = readStartupModels(content);
    return NextResponse.json<StartupResponse>({
      ok: true,
      models,
      configPath: CONFIG_PATH,
    });
  } catch (err) {
    return NextResponse.json<StartupResponse>(
      {
        ok: false,
        message: err instanceof Error ? err.message : "read failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (isPublic) return forbiddenOnPublic();

  const rid = reqId();
  // Top-level guard: prior to this, an exception inside bounceService
  // (e.g. a synchronous spawn throw on Windows) escaped to Next.js'
  // default error path and the client received an HTML 500. The UI
  // surfaces that as "request failed" with no actionable detail, and
  // in the worst case the Node sidecar died on an unhandled rejection.
  // Catch everything, log it, return a structured ok:false.
  try {
    startupLog(rid, "post.enter");

    let body: StartupModelInput;
    try {
      body = (await req.json()) as StartupModelInput;
    } catch {
      startupLog(rid, "post.bad_json");
      return NextResponse.json<StartupResponse>(
        { ok: false, message: "expected JSON body { model, ctxSize? }" },
        { status: 400 },
      );
    }

    const model = (body.model ?? "").trim();
    if (!model) {
      startupLog(rid, "post.missing_model");
      return NextResponse.json<StartupResponse>(
        { ok: false, message: "missing 'model' (catalog id or canonical ref)" },
        { status: 400 },
      );
    }
    if (model.length > 256 || /[\r\n"\\]/.test(model)) {
      startupLog(rid, "post.illegal_model_id", { len: model.length });
      return NextResponse.json<StartupResponse>(
        { ok: false, message: "model id contains illegal characters" },
        { status: 400 },
      );
    }

    const ctxSize =
      typeof body.ctxSize === "number" && Number.isFinite(body.ctxSize)
        ? Math.max(1, Math.floor(body.ctxSize))
        : undefined;

    const forceSplit = body.forceSplit === true ? true : undefined;

    startupLog(rid, "post.body_parsed", { model, ctxSize, forceSplit });

    const next: StartupModel = { model, ctxSize, forceSplit };

    let updated: string;
    try {
      const existing = await readConfigFile();
      updated = writeStartupModels(existing, [next]);
      await writeConfigFile(updated);
      startupLog(rid, "config.written", {
        path: CONFIG_PATH,
        bytes: updated.length,
      });
    } catch (err) {
      startupLog(rid, "config.write_failed", {
        path: CONFIG_PATH,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json<StartupResponse>(
        {
          ok: false,
          message:
            err instanceof Error
              ? `write failed: ${err.message}`
              : "write failed",
          configPath: CONFIG_PATH,
        },
        { status: 500 },
      );
    }

    const restart = await bounceService(rid);

    startupLog(rid, "post.done", {
      restartOk: restart.ok,
      restartMessage: restart.message,
    });

    return NextResponse.json<StartupResponse>({
      ok: true,
      models: readStartupModels(updated),
      configPath: CONFIG_PATH,
      restart,
    });
  } catch (err) {
    startupLog(rid, "post.unhandled", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json<StartupResponse>(
      {
        ok: false,
        message:
          err instanceof Error
            ? `internal error: ${err.message}`
            : "internal error",
        configPath: CONFIG_PATH,
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  if (isPublic) return forbiddenOnPublic();

  const rid = reqId();
  try {
    startupLog(rid, "delete.enter");
    const existing = await readConfigFile();
    const cleared = writeStartupModels(existing, []);
    await writeConfigFile(cleared);
    startupLog(rid, "delete.config_cleared", { path: CONFIG_PATH });
    const restart = await bounceService(rid);
    startupLog(rid, "delete.done", {
      restartOk: restart.ok,
      restartMessage: restart.message,
    });
    return NextResponse.json<StartupResponse>({
      ok: true,
      models: [],
      configPath: CONFIG_PATH,
      restart,
    });
  } catch (err) {
    startupLog(rid, "delete.unhandled", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json<StartupResponse>(
      {
        ok: false,
        message: err instanceof Error ? err.message : "clear failed",
      },
      { status: 500 },
    );
  }
}

/**
 * Stop and re-start the autostart unit so the runtime re-reads
 * config.toml. Self-heals: if `service start` fails because the
 * launchd / systemd / scheduled task hasn't been installed yet (which
 * happens when the user unticked "Start automatically when I log in"
 * during first-run setup), we install it and try again before giving
 * up.
 *
 * The restart takes a few seconds because the runtime reloads weights
 * into memory. We return immediately after the service-start command
 * exits; the caller polls /api/control/status to watch the model
 * actually come up.
 */
async function bounceService(
  rid: string,
): Promise<{ ok: boolean; message: string }> {
  const bin = await findSendaBin();
  startupLog(rid, "bounce.bin_resolved", { bin });
  if (!bin) {
    return {
      ok: false,
      message:
        "Saved config, but the senda binary isn't on this machine yet — install it first.",
    };
  }

  // `service stop` exits non-zero if the unit was already stopped or
  // never installed, which is fine. We treat both as "ok to start now".
  const stop = await runSenda(bin, ["service", "stop"], 10_000);
  startupLog(rid, "bounce.stop_result", {
    ok: stop.ok,
    code: stop.code,
    stdout: trim(stop.stdout),
    stderr: trim(stop.stderr),
  });

  // Windows-only: bridge two async-termination races between stop and
  // start, both of which manifest as "I clicked Make startup model and
  // the model never loaded" because the *new* instance silently failed
  // to launch.
  //
  //   1. `senda service stop` shells out to `schtasks /End`, which
  //      returns as soon as the End command is queued — not when the
  //      process tree has actually exited. The Scheduled Task's default
  //      MultipleInstances policy is IgnoreNew, so the next
  //      `schtasks /Run` we issue is a no-op while the old wscript →
  //      cmd → senda.exe tree is still tearing down. The user
  //      sees the toast "your model will be available in a few seconds"
  //      but the runtime never re-reads config.toml because it never
  //      restarted.
  //
  //   2. If the previous run crashed, an orphaned `senda.exe` may
  //      be holding admin port 3131 open. The new task action launches,
  //      its senda.exe fails to bind, exits silently, and the
  //      Scheduled Task's RestartCount=3 / RestartInterval=1m kicks in
  //      — so the user waits a full minute (or never recovers) before
  //      anything happens.
  //
  // We sleep 1.5s to let `schtasks /End`'s tree termination settle,
  // then force-kill any residual senda.exe whose image path is
  // exactly $bin. Path-equality (not just image name) protects any
  // unrelated `senda.exe` the user might have lying around (e.g. a
  // dev checkout). The kill is best-effort: if PowerShell isn't on
  // PATH we just skip it and rely on the sleep alone.
  if (process.platform === "win32") {
    await new Promise((r) => setTimeout(r, 1500));
    const ps = `Get-Process -Name senda -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -ieq '${bin.replace(/'/g, "''")}') } | Stop-Process -Force -ErrorAction SilentlyContinue`;
    const residualKill = await runSenda(
      "powershell",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
      5_000,
    ).catch((err) => ({
      ok: false,
      code: -1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    }));
    startupLog(rid, "bounce.win_residual_kill", {
      ok: residualKill.ok,
      code: residualKill.code,
      stderr: trim(residualKill.stderr),
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  let start = await runSenda(bin, ["service", "start"], 15_000);
  startupLog(rid, "bounce.start_result", {
    attempt: 1,
    ok: start.ok,
    code: start.code,
    stdout: trim(start.stdout),
    stderr: trim(start.stderr),
  });

  // Work around a known race in the runtime CLI's `service start`:
  // `launchctl bootout` returns immediately but the agent unload is
  // async, so a `bootstrap` issued in the next ~1 s reliably fails with
  // EIO ("Bootstrap failed: 5: Input/output error"). The desktop app
  // already retries with backoff for its own bounce path; the CLI
  // doesn't, so we retry here. Two attempts spaced 2 s and 4 s after
  // the initial failure is enough on a healthy machine — if it's still
  // failing after ~6 s of accumulated wait, it's almost certainly a
  // real plist / permissions problem and we surface the error.
  const backoffMs = [2_000, 4_000];
  let attempt = 1;
  for (const wait of backoffMs) {
    if (start.ok) break;
    if (!isLaunchctlBootstrapRace(start.stderr, start.stdout)) break;
    attempt += 1;
    startupLog(rid, "bounce.start_retry_scheduled", { attempt, waitMs: wait });
    await new Promise((r) => setTimeout(r, wait));
    start = await runSenda(bin, ["service", "start"], 15_000);
    startupLog(rid, "bounce.start_result", {
      attempt,
      ok: start.ok,
      code: start.code,
      stdout: trim(start.stdout),
      stderr: trim(start.stderr),
    });
  }

  if (start.ok) {
    startupLog(rid, "bounce.success");
    return {
      ok: true,
      message:
        "Saved. Restarting the runtime — your model will be available in a few seconds.",
    };
  }

  // The most common failure here on a fresh install is "service not
  // installed" — the launchd plist / systemd unit doesn't exist yet
  // because the user opted out of autostart. Install it and retry
  // once. We don't loop on the second failure; if `service install`
  // itself broke we want the surface error rather than a generic
  // "couldn't start".
  const looksMissing = looksLikeServiceMissing(start.stderr, start.stdout);
  startupLog(rid, "bounce.start_failed", { looksMissing });
  if (looksMissing) {
    const install = await runSenda(bin, ["service", "install"], 20_000);
    startupLog(rid, "bounce.install_result", {
      ok: install.ok,
      code: install.code,
      stdout: trim(install.stdout),
      stderr: trim(install.stderr),
    });
    if (install.ok) {
      const retry = await runSenda(bin, ["service", "start"], 15_000);
      startupLog(rid, "bounce.start_after_install_result", {
        ok: retry.ok,
        code: retry.code,
        stdout: trim(retry.stdout),
        stderr: trim(retry.stderr),
      });
      if (retry.ok) {
        return {
          ok: true,
          message:
            "Installed the autostart service and started it — your model will be available in a few seconds.",
        };
      }
      return {
        ok: false,
        message: extractStartError(retry.stderr || retry.stdout || ""),
      };
    }
    return {
      ok: false,
      message: extractStartError(install.stderr || install.stdout || ""),
    };
  }

  return {
    ok: false,
    message: extractStartError(start.stderr || start.stdout || ""),
  };
}

/**
 * Heuristic match for "service not installed" across the three
 * platforms' tooling. We match on substrings rather than an exact
 * message because the runtime CLI's wording has changed across
 * versions and we'd rather over-trigger the auto-install fallback
 * than under-trigger.
 */
function looksLikeServiceMissing(stderr: string, stdout: string): boolean {
  const blob = `${stderr}\n${stdout}`.toLowerCase();
  return (
    blob.includes("not installed") ||
    blob.includes("no such service") ||
    blob.includes("could not find") ||
    blob.includes("unit not found") ||
    blob.includes("service was not installed") ||
    blob.includes("not loaded") ||
    blob.includes("unable to start")
  );
}

function forbiddenOnPublic() {
  return NextResponse.json<StartupResponse>(
    {
      ok: false,
      message: "Startup-model management isn't exposed on the hosted public site.",
    },
    { status: 403 },
  );
}
