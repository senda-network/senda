import { NextResponse } from "next/server";
import { MODEL_CATALOG, type CatalogModel } from "../../lib/model-catalog";
import {
  mapRuntimeCatalog,
  type RuntimeCatalogEntry,
} from "../../lib/catalog-merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical model catalog.
 *
 * Source of truth for *which* models are offered is the runtime's
 * `GET /api/catalog` (the `listed` entries in its bundled `catalog.json`), so
 * a model can be added or retired in one place — the runtime — without a
 * website deploy. This route fetches that list and enriches each entry with
 * the site's curated display copy ({@link MODEL_CATALOG}) when it has a match;
 * runtime-listed models the site doesn't have copy for yet are rendered from
 * the runtime's own fields. If the runtime is unreachable or too old to expose
 * the endpoint, we fall back to the bundled snapshot so the dashboard is never
 * empty.
 *
 * The desktop app's bundled controller fetches this URL **directly** from the
 * browser (see `use-catalog.ts`), so CORS is wide open on purpose: the catalog
 * is public, non-sensitive data and the desktop sidecar binds to a
 * kernel-assigned port we can't allow-list.
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "access-control-max-age": "86400",
};

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
  trimmedEnv("SENDA_ADMIN_URL", "MESH_CONSOLE_URL") ?? "http://127.0.0.1:3131";
const RUNTIME_TOKEN = trimmedEnv("SENDA_RUNTIME_TOKEN") ?? "";
const runtimeHeaders: Record<string, string> = RUNTIME_TOKEN
  ? { Authorization: `Bearer ${RUNTIME_TOKEN}` }
  : {};

async function resolveCatalog(): Promise<CatalogModel[]> {
  try {
    const res = await fetch(`${ADMIN_URL}/api/catalog`, {
      cache: "no-store",
      headers: runtimeHeaders,
    });
    if (!res.ok) return MODEL_CATALOG;
    const data = (await res.json()) as { catalog?: RuntimeCatalogEntry[] };
    if (!Array.isArray(data.catalog) || data.catalog.length === 0) {
      return MODEL_CATALOG;
    }
    const mapped = mapRuntimeCatalog(data.catalog, MODEL_CATALOG);
    return mapped.length > 0 ? mapped : MODEL_CATALOG;
  } catch {
    // Runtime paused / entry node flaky / older runtime without the endpoint.
    // The bundled snapshot is the safety net.
    return MODEL_CATALOG;
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const catalog = await resolveCatalog();
  return NextResponse.json(
    {
      ok: true,
      catalog,
      fetchedAt: new Date().toISOString(),
    },
    {
      headers: {
        ...CORS_HEADERS,
        // Vercel's edge caches for 5 min and serves stale for an hour while it
        // revalidates, so we don't hit the entry node on every dashboard load.
        "cache-control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
