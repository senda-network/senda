/**
 * Hourly mesh KPI snapshots (Upstash Redis) + read API for weekly reports.
 *
 * Cron: vercel.json → GET /api/kpi-snapshot (secured with CRON_SECRET).
 * Manual: same endpoint with Authorization: Bearer $CRON_SECRET
 *
 * Read (no auth): GET /api/kpi-snapshot?week=2026-W21
 *                 GET /api/kpi-snapshot?latest=1
 */

import { NextResponse } from "next/server";
import { buildKpiSnapshot, type KpiStatusInput } from "../../lib/kpi-snapshot";
import {
  getKpiDashboard,
  getKpiLatestWeek,
  getKpiWeek,
  kpiStoreReady,
  saveKpiSnapshot,
} from "../../lib/kpi-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_FLAGSHIP =
  process.env.CLOSEDMESH_KPI_FLAGSHIP_MODEL?.trim() ||
  "Qwen3-32B-Q4_K_M";

function trimmedEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value) return value;
  }
  return undefined;
}

function statusBaseUrl(): string {
  const explicit = trimmedEnv("CLOSEDMESH_KPI_STATUS_URL");
  if (explicit) return explicit.replace(/\/api\/status\/?$/, "");
  // Always use the public site for status — VERCEL_URL points at a
  // deployment hostname that may be SSO/deployment-protection gated (401).
  return "https://closedmesh.com";
}

function cronAuthorized(req: Request): boolean {
  const secret = trimmedEnv("CRON_SECRET");
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

async function fetchStatusJson(): Promise<{
  status: KpiStatusInput;
  statusUrl: string;
}> {
  const base = statusBaseUrl();
  const statusUrl = `${base}/api/status`;
  const res = await fetch(statusUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`status fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as KpiStatusInput & { nodes?: KpiStatusInput["nodes"] };
  return {
    status: {
      online: !!body.online,
      nodeCount: body.nodeCount ?? 0,
      models: body.models ?? [],
      nodes: body.nodes ?? [],
    },
    statusUrl,
  };
}

async function captureSnapshot(flagship: string) {
  const { status, statusUrl } = await fetchStatusJson();
  const snapshot = buildKpiSnapshot(status, flagship, statusUrl);
  const saved = await saveKpiSnapshot(snapshot);
  return { snapshot, saved, storeReady: kpiStoreReady() };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const week = url.searchParams.get("week");
  const latest = url.searchParams.get("latest");
  const dashboard = url.searchParams.get("dashboard");

  if (cronAuthorized(req) || url.searchParams.get("capture") === "1") {
    if (!cronAuthorized(req)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    try {
      const flagship =
        url.searchParams.get("model")?.trim() || DEFAULT_FLAGSHIP;
      const result = await captureSnapshot(flagship);
      return NextResponse.json({
        ok: true,
        action: "capture",
        ...result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: message },
        { status: 502 },
      );
    }
  }

  if (dashboard === "1" || dashboard === "true") {
    const data = await getKpiDashboard();
    return NextResponse.json({
      ...data,
      flagship_default: DEFAULT_FLAGSHIP,
    });
  }

  if (!week && !latest) {
    return NextResponse.json({
      usage: {
        capture: "Vercel Cron or GET with Authorization: Bearer $CRON_SECRET",
        read_week: "?week=2026-W21",
        read_latest: "?latest=1",
        dashboard: "?dashboard=1",
      },
      storeReady: kpiStoreReady(),
      flagship_default: DEFAULT_FLAGSHIP,
    });
  }

  if (!kpiStoreReady()) {
    return NextResponse.json(
      {
        error: "kpi store not configured",
        hint: "Link Upstash Redis on Vercel and set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN",
      },
      { status: 503 },
    );
  }

  if (week) {
    const snapshot = await getKpiWeek(week);
    if (!snapshot) {
      return NextResponse.json({ error: "not found", week }, { status: 404 });
    }
    return NextResponse.json({ week, snapshot });
  }

  if (latest === "1" || latest === "true") {
    const snapshot = await getKpiLatestWeek();
    if (!snapshot) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ snapshot });
  }

  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function POST(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let flagship = DEFAULT_FLAGSHIP;
  try {
    const body = (await req.json()) as { model?: string };
    if (body.model?.trim()) flagship = body.model.trim();
  } catch {
    /* empty body is fine */
  }
  try {
    const result = await captureSnapshot(flagship);
    return NextResponse.json({ ok: true, action: "capture", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
