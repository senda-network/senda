import { NextResponse } from "next/server";
import { findClosedmeshBin, isPublic, runClosedmesh } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delete a downloaded model from this node.
 *
 * Shells out to `closedmesh models delete <id> --yes --json`. The runtime
 * CLI handles the actual file removal, the HF cache snapshot bookkeeping,
 * and the mesh-managed usage record cleanup; we just forward the parsed
 * JSON result up to the dashboard.
 *
 * ── Windows file-locking gotcha ──
 *
 * On macOS / Linux you can `unlink` a file that another process has
 * mmap'd: the directory entry disappears immediately, the running
 * process keeps serving from its open handle, and disk space is
 * reclaimed when the last handle closes. The CLI relied on that
 * behaviour and `closedmesh models delete` would happily complete
 * regardless of whether the runtime had the GGUF loaded.
 *
 * Windows does NOT have unlink-while-open semantics for regular file
 * handles. If the runtime has the model mmap'd (which it does whenever
 * llama-server is serving it), `std::fs::remove_file` returns
 * ERROR_SHARING_VIOLATION (32) and the CLI exits with an opaque
 * `os error 32` chain. Worse: the dashboard surfaces that as a generic
 * "Delete failed" toast and the user has no idea what went wrong.
 *
 * Mitigation here: before we shell out to the CLI, ask the runtime to
 * unload the model via its admin API (`DELETE /api/runtime/models/{id}`).
 * That drops the llama-server child, which in turn drops the mmap
 * handle, after which `remove_file` succeeds on every platform. The
 * unload call is best-effort — if it fails (model wasn't loaded, runtime
 * is offline, network blip) we still proceed to the CLI delete because
 * the file might be deletable anyway (e.g. it was never loaded since the
 * last service restart).
 *
 * The proper fix lives in `closedmesh-llm` (`models/delete.rs` should
 * unload from the local runtime registry before calling `remove_file`)
 * and is tracked in the corresponding runtime issue. This controller
 * mitigation lets us ship the dashboard fix without waiting on a runtime
 * release.
 */

const ADMIN_URL = (
  process.env.CLOSEDMESH_ADMIN_URL ??
  process.env.MESH_CONSOLE_URL ??
  "http://127.0.0.1:3131"
).trim();
const RUNTIME_TOKEN = (process.env.CLOSEDMESH_RUNTIME_TOKEN ?? "").trim();

/**
 * Best-effort unload of `id` from the local runtime so the GGUF mmap
 * handle is released before we try to delete the file. Returns silently
 * on any failure — the caller treats unload as a hint, not a contract.
 */
async function unloadFromRuntime(id: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    await fetch(
      `${ADMIN_URL}/api/runtime/models/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        cache: "no-store",
        signal: ctrl.signal,
        headers: RUNTIME_TOKEN
          ? { Authorization: `Bearer ${RUNTIME_TOKEN}` }
          : undefined,
      },
    );
  } catch {
    // Runtime unreachable or refused — proceed to the CLI delete anyway.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Detects the Windows sharing-violation signature in the CLI's error
 * output so we can rewrite it into something the user can act on
 * ("close the loaded model first") instead of leaking `os error 32`.
 */
function looksLikeWindowsFileLock(text: string): boolean {
  const blob = text.toLowerCase();
  return (
    blob.includes("os error 32") ||
    blob.includes("being used by another process") ||
    blob.includes("sharing violation")
  );
}

const ALLOWED_ID = /^[A-Za-z0-9._\-]{1,128}$/;

type Body = { id?: string };

type DeleteJson = {
  deleted_paths: string[];
  reclaimed_bytes: number;
  reclaimed_bytes_human: string;
  removed_metadata_files: number;
  removed_usage_records: number;
};

export async function POST(req: Request) {
  if (isPublic) {
    return NextResponse.json(
      {
        ok: false,
        message: "Model management isn't exposed on the hosted public site.",
      },
      { status: 403 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Body must be JSON." },
      { status: 400 },
    );
  }
  const id = (body.id ?? "").trim();
  if (!ALLOWED_ID.test(id)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Invalid model id. Expected something like Qwen3-8B-Q4_K_M.",
      },
      { status: 400 },
    );
  }

  const bin = await findClosedmeshBin();
  if (!bin) {
    return NextResponse.json(
      { ok: false, message: "closedmesh binary not found on this machine." },
      { status: 404 },
    );
  }

  // Release any active mmap on the model file before touching disk.
  // See the file header for why this matters on Windows. macOS and
  // Linux don't need it, but the call is cheap and idempotent so we
  // always make it — keeps the code path the same on every platform
  // and prevents an unloaded-on-Mac / locked-on-Windows bug class.
  await unloadFromRuntime(id);

  // Big GGUFs (40 GB+) take a few seconds to unlink on a slow disk; the
  // default 8 s in `runClosedmesh` is too tight. 60 s is generous enough
  // to cover any realistic case while still failing loudly if the CLI
  // hangs.
  const result = await runClosedmesh(bin, ["models", "delete", id, "--yes", "--json"], 60_000);
  if (!result.ok) {
    const rawError =
      result.stderr || result.stdout || `closedmesh models delete exited ${result.code}`;
    const message =
      process.platform === "win32" && looksLikeWindowsFileLock(rawError)
        ? `${id} is still in use by the running mesh service. Stop it from the dashboard (or run \`closedmesh service stop\`) and try again.`
        : rawError;
    return NextResponse.json(
      { ok: false, message },
      { status: 500 },
    );
  }

  let parsed: DeleteJson | null = null;
  try {
    parsed = JSON.parse(result.stdout) as DeleteJson;
  } catch {
    // CLI succeeded but didn't emit JSON — surface what we got so the
    // dashboard can still tell the user something happened.
    return NextResponse.json({
      ok: true,
      reclaimedBytes: 0,
      reclaimedHuman: "unknown",
      deletedPaths: [],
      raw: result.stdout,
    });
  }

  return NextResponse.json({
    ok: true,
    reclaimedBytes: parsed.reclaimed_bytes,
    reclaimedHuman: parsed.reclaimed_bytes_human,
    deletedPaths: parsed.deleted_paths,
    removedMetadataFiles: parsed.removed_metadata_files,
    removedUsageRecords: parsed.removed_usage_records,
  });
}
