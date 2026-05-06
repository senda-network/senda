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
 * If the model is currently in memory (loaded by the runtime) the file
 * deletion still succeeds — the running process keeps serving from its
 * mmap'd handle until restart. That's the expected POSIX behaviour and
 * matches what `closedmesh models cleanup` does for batch removals, so
 * we don't try to be cleverer than the CLI here.
 */

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

  // Big GGUFs (40 GB+) take a few seconds to unlink on a slow disk; the
  // default 8 s in `runClosedmesh` is too tight. 60 s is generous enough
  // to cover any realistic case while still failing loudly if the CLI
  // hangs.
  const result = await runClosedmesh(bin, ["models", "delete", id, "--yes", "--json"], 60_000);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message:
          result.stderr || result.stdout || `closedmesh models delete exited ${result.code}`,
      },
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
