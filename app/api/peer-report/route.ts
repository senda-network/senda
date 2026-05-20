/**
 * Ingest endpoint for peer audit reports (Slice 4 of the
 * mesh-visibility rollout).
 *
 * Each desktop runtime POSTs its own [`MeshVisibilitySnapshot`] here
 * after every audit cycle. We retain reports for a few minutes (see
 * `store.ts`) so the public `/api/status` route can surface peers
 * that are claiming-to-be-serving but invisible to the mesh entry —
 * a state the entry's own peer list cannot, by construction,
 * advertise.
 *
 * ## Auth / abuse
 *
 * Reports are deliberately *unauthenticated*. The peer is reporting
 * about itself with metadata the entry could already obtain via
 * gossip if the iroh connection were healthy; there's no privilege
 * to gain by lying except confusing the operator briefly. We rely
 * on:
 *
 *   - A small request size cap (`MAX_REPORT_BYTES`) so a flood costs
 *     bandwidth, not memory.
 *   - A capped store (`MAX_REPORTS`) so a peer with rotating node IDs
 *     can't grow the dataset without bound.
 *   - The TTL (5 min) bounding how long stale claims persist.
 *
 * A later slice can add Nostr-signed reports once peer identity is
 * actually plumbed through — for now, honesty in the common case is
 * worth more than belt-and-suspenders auth.
 *
 * ## CORS
 *
 * This endpoint is called server-to-server from the Rust runtime
 * (not from a browser), so we explicitly skip the `applyCors`
 * pipeline that the rest of the API uses — its allowlist is for the
 * dashboard's browser-side calls back to localhost, which doesn't
 * apply here. POSTs from the runtime carry no `Origin` header and
 * succeed unconditionally; browser POSTs would, but there's nothing
 * sensitive to gate.
 */

import { NextResponse } from "next/server";
import {
  MAX_REPORT_BYTES,
  putReport,
  listReports,
  type PeerReportInput,
} from "./store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuntimeMeshVisibilityWire = {
  state?: string;
  last_check_unix?: number | null;
  last_visible_unix?: number | null;
  consecutive_invisible_count?: number;
  last_error?: string | null;
  entry_url?: string;
  soft_reconnect_triggered?: boolean;
  hard_reset_triggered?: boolean;
};

type RuntimeReportWire = {
  node_id?: string;
  hostname?: string | null;
  version?: string | null;
  serving_models?: string[];
  mesh_visibility?: RuntimeMeshVisibilityWire;
};

function clampString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  return value.length <= max ? value : value.slice(0, max);
}

function parseReport(raw: RuntimeReportWire): PeerReportInput | null {
  const nodeId = clampString(raw.node_id, 128);
  if (!nodeId) return null;
  const v = raw.mesh_visibility ?? {};
  const state =
    v.state === "visible" ||
    v.state === "invisible" ||
    v.state === "entry_unreachable" ||
    v.state === "unknown"
      ? v.state
      : "unknown";
  const entryUrl = clampString(v.entry_url, 512) ?? "";
  return {
    nodeId,
    hostname: clampString(raw.hostname, 256),
    version: clampString(raw.version, 64),
    servingModels: Array.isArray(raw.serving_models)
      ? raw.serving_models
          .map((s) => clampString(s, 256))
          .filter((s): s is string => !!s)
          .slice(0, 32)
      : [],
    meshVisibility: {
      state,
      lastCheckUnix:
        typeof v.last_check_unix === "number" ? v.last_check_unix : null,
      lastVisibleUnix:
        typeof v.last_visible_unix === "number" ? v.last_visible_unix : null,
      consecutiveInvisibleCount:
        typeof v.consecutive_invisible_count === "number"
          ? Math.max(0, Math.floor(v.consecutive_invisible_count))
          : 0,
      lastError: clampString(v.last_error, 1024),
      entryUrl,
      softReconnectTriggered: !!v.soft_reconnect_triggered,
      hardResetTriggered: !!v.hard_reset_triggered,
    },
  };
}

export async function POST(req: Request) {
  // Size cap before parsing to defend against multi-MB bodies.
  const lenHeader = req.headers.get("content-length");
  if (lenHeader) {
    const len = Number.parseInt(lenHeader, 10);
    if (Number.isFinite(len) && len > MAX_REPORT_BYTES) {
      return NextResponse.json(
        { error: "report too large" },
        { status: 413 },
      );
    }
  }

  let body: RuntimeReportWire;
  try {
    const text = await req.text();
    if (text.length > MAX_REPORT_BYTES) {
      return NextResponse.json(
        { error: "report too large" },
        { status: 413 },
      );
    }
    body = JSON.parse(text) as RuntimeReportWire;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const report = parseReport(body);
  if (!report) {
    return NextResponse.json(
      { error: "missing node_id" },
      { status: 400 },
    );
  }
  const stored = await putReport(report);
  return NextResponse.json({
    ok: true,
    receivedAtUnix: stored.receivedAtUnix,
  });
}

/**
 * Read-side endpoint. Returns all currently-retained reports.
 *
 * Consumed by:
 *   - `app/api/status/route.ts` to enrich the unified node list with
 *     claimed-but-invisible peers
 *   - debug surfaces / curl during development
 *
 * Note: this is also unauthenticated. The data is by definition
 * already designed to be displayed on the public status page; there's
 * no incremental disclosure from exposing it directly.
 */
export async function GET() {
  return NextResponse.json({ reports: await listReports() });
}
