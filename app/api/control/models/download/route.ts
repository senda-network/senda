import { spawn } from "node:child_process";
import { statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { findClosedmeshBin, isPublic } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads a model onto this node by shelling out to
 * `closedmesh models download <id>` and forwarding stdout/stderr to the
 * client as newline-delimited JSON.
 *
 * Why NDJSON over SSE: same reasoning as /api/control/install — the AI
 * SDK monopolises EventSource semantics for /api/chat, so a plain
 * `text/x-ndjson` body keeps the client wiring simple.
 *
 * Each line is one of:
 *   {"kind":"stdout","text":"…"}
 *   {"kind":"stderr","text":"…"}
 *   {"kind":"progress","percent":12.5,"bytes":15728640,"total":134217728}
 *   {"kind":"done","ok":true,"code":0}
 *   {"kind":"error","message":"…"}
 *
 * The `progress` event is parsed out of the CLI's progress bar lines on
 * a best-effort basis so the dashboard can render a real bar instead of
 * a stream of unintelligible carriage returns.
 *
 * ── Disk-space pre-flight ──
 *
 * The runtime CLI doesn't fail fast when the target volume can't fit
 * the model — `hf_hub` keeps writing to its temp file until the kernel
 * returns ENOSPC mid-stream, by which point the user has watched the
 * progress bar slowly stall to ~0 KB/s with no surfaced error. Pre-0.1.x
 * we'd just see "Download failed (exit 1)" buried under hundreds of
 * lines of resumed-download chatter.
 *
 * The dashboard knows the model's expected size from the catalog before
 * it even opens this socket, so it POSTs `sizeBytes` along with `id`.
 * We `statfs` the home directory (which is where `~/.cache/huggingface/`
 * lives on every supported platform; XDG override edge cases fall back
 * to whatever space the CLI itself sees) and bail with a 507 + actionable
 * message if free space < `sizeBytes * 1.1` (the 10% headroom covers
 * resumed-download temp files, .incomplete sidecars, GGUF index updates,
 * and the brief window where llama.cpp's split tool may keep both the
 * source and a derived shard on disk simultaneously).
 *
 * Mid-stream we ALSO grep for the kernel-level ENOSPC signature in
 * stderr so a user who manages to start a download with just-enough
 * space and then runs out partway through gets the same clear error
 * message instead of a generic "exit 1".
 */
type Body = { id?: string; sizeBytes?: number };

const ALLOWED_ID = /^[A-Za-z0-9._\-]{1,128}$/;

/** Tolerance multiplier on top of the model's nominal GGUF size. */
const DISK_HEADROOM = 1.1;

function formatBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${b} B`;
}

/**
 * Best-effort free-space query against the volume containing `path`.
 * Returns null when `statfs` isn't available (older Node versions, some
 * Windows configurations) — the caller treats that as "skip pre-flight"
 * rather than blocking the download.
 */
async function freeBytesAt(path: string): Promise<number | null> {
  try {
    const s = await statfs(path);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

const NO_SPACE_PATTERNS = [
  /no space left on device/i,
  /os error 28\b/i, // POSIX ENOSPC
  /error 112\b/i, // Win32 ERROR_DISK_FULL
  /there is not enough space on the disk/i,
  /enospc/i,
];

function looksLikeNoSpace(text: string): boolean {
  return NO_SPACE_PATTERNS.some((re) => re.test(text));
}

export async function POST(req: Request) {
  if (isPublic) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: "Model downloads aren't available on the hosted public site.",
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonErr(400, "Body must be JSON.");
  }
  const id = (body.id ?? "").trim();
  if (!ALLOWED_ID.test(id)) {
    return jsonErr(
      400,
      "Invalid model id. Expected something like Qwen3-8B-Q4_K_M.",
    );
  }

  // Pre-flight disk-space check. Only runs when the client passes a
  // hint (catalog rows always do; the orphan / custom-model path may
  // not). Skipping is safe: the worst case is we fall back to the
  // pre-existing mid-stream ENOSPC detection below.
  if (
    typeof body.sizeBytes === "number" &&
    Number.isFinite(body.sizeBytes) &&
    body.sizeBytes > 0
  ) {
    const free = await freeBytesAt(homedir());
    if (free !== null) {
      const needed = Math.ceil(body.sizeBytes * DISK_HEADROOM);
      if (free < needed) {
        return jsonErr(
          507,
          `Not enough disk space to download ${id}. Need about ${formatBytes(needed)} but only ${formatBytes(free)} is free on this volume. Free up some space (or pick a smaller model) and try again.`,
        );
      }
    }
  }

  const bin = await findClosedmeshBin();
  if (!bin) {
    return jsonErr(404, "closedmesh binary not found on this machine.");
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      };

      send({ kind: "stdout", text: `closedmesh models download ${id}` });

      const child = spawn(bin, ["models", "download", id], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        // See _lib.ts — without this every model download flashes a
        // closedmesh.exe console window on Windows for the duration of
        // the (potentially multi-minute) download.
        windowsHide: true,
      });

      // Track the most recent ENOSPC signature so we can rewrite the
      // final `done` event with a meaningful message instead of letting
      // the dashboard show a generic "Download failed (exit 1)".
      let noSpaceLine: string | null = null;

      const handle = (chunk: string, kind: "stdout" | "stderr") => {
        // The CLI's progress bar uses \r to redraw a single line; split
        // on either CR or LF so we capture each redraw as its own event.
        for (const raw of chunk.split(/\r|\n/)) {
          const line = raw.trim();
          if (!line) continue;
          if (looksLikeNoSpace(line)) noSpaceLine = line;
          send({ kind, text: line });
          const progress = parseProgress(line);
          if (progress) send({ kind: "progress", ...progress });
        }
      };

      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");
      child.stdout.on("data", (c: string) => handle(c, "stdout"));
      child.stderr.on("data", (c: string) => handle(c, "stderr"));
      child.on("error", (err) => {
        send({ kind: "error", message: err.message });
        controller.close();
      });
      child.on("close", (code) => {
        if (noSpaceLine && code !== 0) {
          send({
            kind: "error",
            message: `Ran out of disk space while downloading ${id}. Free up space on the volume holding ~/.cache/huggingface and try again. (CLI: ${noSpaceLine})`,
          });
        }
        send({ kind: "done", ok: code === 0, code: code ?? -1 });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
};

/**
 * Tries to extract a (bytes, total) pair from a progress line. Two
 * common shapes from llama.cpp / huggingface_hub style downloaders:
 *
 *   "Downloading model.gguf:  37%  1.86G/5.00G"
 *   "[#####     ] 50%  2.5GB / 5.0GB"
 *   "1234/4096 MB"
 */
function parseProgress(
  line: string,
): { percent: number; bytes: number; total: number } | null {
  const m =
    line.match(
      /([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?)B?\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?)B?/i,
    ) ?? null;
  if (!m) {
    const pct = line.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct) {
      const percent = Math.min(100, Math.max(0, Number(pct[1])));
      return { percent, bytes: 0, total: 0 };
    }
    return null;
  }
  const a = Number(m[1]);
  const b = Number(m[3]);
  const aUnit = (m[2] || "B").toUpperCase();
  const bUnit = (m[4] || "B").toUpperCase();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  const bytes = Math.round(a * (SIZE_UNITS[aUnit] ?? 1));
  const total = Math.round(b * (SIZE_UNITS[bUnit] ?? 1));
  return {
    percent: Math.min(100, Math.max(0, (bytes / total) * 100)),
    bytes,
    total,
  };
}
