import { NextResponse } from "next/server";
import { applyCors, preflightResponse } from "../_cors";
import { withSelectableFlags } from "../../lib/selectable-mesh-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy for the runtime's `/api/models` endpoint, which returns
// `{ mesh_models: [...] }` with rich per-model topology data
// (`split_kind`, `mesh_fit`, `node_count`, etc.) — the data the chat
// product needs to render mesh-aware fit and topology.
//
// Distinct from `/v1/models` (the OpenAI-compatible model id list) and
// from `/api/models` proxied directly: we want a stable, app-layer
// endpoint name that signals "this is the rich mesh inventory, not the
// thin OpenAI list."
//
// Each row is annotated with `selectable` — true only when the chat
// composer may offer the model (warm + dialable host). Cold inventory
// stays in the payload for /models and dashboard surfaces.
function trimmedEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value) return value;
  }
  return undefined;
}

const ADMIN_URL =
  trimmedEnv("SENDA_ADMIN_URL", "MESH_CONSOLE_URL") ??
  "http://127.0.0.1:3131";

const RUNTIME_TOKEN = trimmedEnv("SENDA_RUNTIME_TOKEN") ?? "";

const runtimeHeaders: Record<string, string> = RUNTIME_TOKEN
  ? { Authorization: `Bearer ${RUNTIME_TOKEN}` }
  : {};

type RuntimeMeshModel = {
  name: string;
  status?: string;
  node_count?: number;
  active_nodes?: string[] | null;
  [key: string]: unknown;
};

type AdminStatus = {
  my_hostname?: string | null;
  peers?: Array<{ hostname?: string | null; rtt_ms?: number | null }>;
};

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

export async function GET(req: Request) {
  try {
    const [modelsRes, statusRes] = await Promise.all([
      fetch(`${ADMIN_URL}/api/models`, {
        cache: "no-store",
        headers: runtimeHeaders,
      }),
      fetch(`${ADMIN_URL}/api/status`, {
        cache: "no-store",
        headers: runtimeHeaders,
      }),
    ]);
    if (!modelsRes.ok) {
      return applyCors(
        req,
        NextResponse.json({ mesh_models: [] }, { status: modelsRes.status }),
      );
    }
    const data = (await modelsRes.json()) as { mesh_models?: RuntimeMeshModel[] };
    const models = data.mesh_models ?? [];

    let peers: AdminStatus["peers"] = [];
    let selfHostname: string | null = null;
    if (statusRes.ok) {
      const status = (await statusRes.json()) as AdminStatus;
      peers = status.peers ?? [];
      selfHostname = status.my_hostname ?? null;
    }

    const mesh_models = withSelectableFlags(models, peers ?? [], selfHostname);
    return applyCors(req, NextResponse.json({ mesh_models }));
  } catch {
    // Best-effort — desktop app's local runtime might be paused, the
    // entry node might be flaky. The hook treats this as "no data yet"
    // and re-polls; surfacing 503 here would only confuse the UI.
    return applyCors(req, NextResponse.json({ mesh_models: [] }));
  }
}
