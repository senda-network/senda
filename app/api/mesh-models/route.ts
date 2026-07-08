import { NextResponse } from "next/server";
import { applyCors, preflightResponse } from "../_cors";

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

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

export async function GET(req: Request) {
  try {
    const res = await fetch(`${ADMIN_URL}/api/models`, {
      cache: "no-store",
      headers: runtimeHeaders,
    });
    if (!res.ok) {
      return applyCors(
        req,
        NextResponse.json({ mesh_models: [] }, { status: res.status }),
      );
    }
    const data = (await res.json()) as { mesh_models?: unknown };
    return applyCors(
      req,
      NextResponse.json({ mesh_models: data.mesh_models ?? [] }),
    );
  } catch {
    // Best-effort — desktop app's local runtime might be paused, the
    // entry node might be flaky. The hook treats this as "no data yet"
    // and re-polls; surfacing 503 here would only confuse the UI.
    return applyCors(req, NextResponse.json({ mesh_models: [] }));
  }
}
