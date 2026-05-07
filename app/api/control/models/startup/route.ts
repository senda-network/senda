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
  findClosedmeshBin,
  isLaunchctlBootstrapRace,
  isPublic,
  runClosedmesh,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * setups can edit ~/.closedmesh/config.toml by hand — this endpoint is a
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

  let body: StartupModelInput;
  try {
    body = (await req.json()) as StartupModelInput;
  } catch {
    return NextResponse.json<StartupResponse>(
      { ok: false, message: "expected JSON body { model, ctxSize? }" },
      { status: 400 },
    );
  }

  const model = (body.model ?? "").trim();
  if (!model) {
    return NextResponse.json<StartupResponse>(
      { ok: false, message: "missing 'model' (catalog id or canonical ref)" },
      { status: 400 },
    );
  }
  if (model.length > 256 || /[\r\n"\\]/.test(model)) {
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

  const next: StartupModel = { model, ctxSize, forceSplit };

  let updated: string;
  try {
    const existing = await readConfigFile();
    updated = writeStartupModels(existing, [next]);
    await writeConfigFile(updated);
  } catch (err) {
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

  const restart = await bounceService();

  return NextResponse.json<StartupResponse>({
    ok: true,
    models: readStartupModels(updated),
    configPath: CONFIG_PATH,
    restart,
  });
}

export async function DELETE() {
  if (isPublic) return forbiddenOnPublic();

  try {
    const existing = await readConfigFile();
    const cleared = writeStartupModels(existing, []);
    await writeConfigFile(cleared);
    const restart = await bounceService();
    return NextResponse.json<StartupResponse>({
      ok: true,
      models: [],
      configPath: CONFIG_PATH,
      restart,
    });
  } catch (err) {
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
async function bounceService(): Promise<{ ok: boolean; message: string }> {
  const bin = await findClosedmeshBin();
  if (!bin) {
    return {
      ok: false,
      message:
        "Saved config, but the closedmesh binary isn't on this machine yet — install it first.",
    };
  }

  // `service stop` exits non-zero if the unit was already stopped or
  // never installed, which is fine. We treat both as "ok to start now".
  await runClosedmesh(bin, ["service", "stop"], 10_000);

  // Windows-only: bridge two async-termination races between stop and
  // start, both of which manifest as "I clicked Make startup model and
  // the model never loaded" because the *new* instance silently failed
  // to launch.
  //
  //   1. `closedmesh service stop` shells out to `schtasks /End`, which
  //      returns as soon as the End command is queued — not when the
  //      process tree has actually exited. The Scheduled Task's default
  //      MultipleInstances policy is IgnoreNew, so the next
  //      `schtasks /Run` we issue is a no-op while the old wscript →
  //      cmd → closedmesh.exe tree is still tearing down. The user
  //      sees the toast "your model will be available in a few seconds"
  //      but the runtime never re-reads config.toml because it never
  //      restarted.
  //
  //   2. If the previous run crashed, an orphaned `closedmesh.exe` may
  //      be holding admin port 3131 open. The new task action launches,
  //      its closedmesh.exe fails to bind, exits silently, and the
  //      Scheduled Task's RestartCount=3 / RestartInterval=1m kicks in
  //      — so the user waits a full minute (or never recovers) before
  //      anything happens.
  //
  // We sleep 1.5s to let `schtasks /End`'s tree termination settle,
  // then force-kill any residual closedmesh.exe whose image path is
  // exactly $bin. Path-equality (not just image name) protects any
  // unrelated `closedmesh.exe` the user might have lying around (e.g. a
  // dev checkout). The kill is best-effort: if PowerShell isn't on
  // PATH we just skip it and rely on the sleep alone.
  if (process.platform === "win32") {
    await new Promise((r) => setTimeout(r, 1500));
    const ps = `Get-Process -Name closedmesh -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -ieq '${bin.replace(/'/g, "''")}') } | Stop-Process -Force -ErrorAction SilentlyContinue`;
    await runClosedmesh("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], 5_000).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
  }

  let start = await runClosedmesh(bin, ["service", "start"], 15_000);

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
  for (const wait of backoffMs) {
    if (start.ok) break;
    if (!isLaunchctlBootstrapRace(start.stderr, start.stdout)) break;
    await new Promise((r) => setTimeout(r, wait));
    start = await runClosedmesh(bin, ["service", "start"], 15_000);
  }

  if (start.ok) {
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
  if (looksMissing) {
    const install = await runClosedmesh(bin, ["service", "install"], 20_000);
    if (install.ok) {
      const retry = await runClosedmesh(bin, ["service", "start"], 15_000);
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
