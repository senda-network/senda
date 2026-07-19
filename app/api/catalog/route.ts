import { NextResponse } from "next/server";
import { resolveCatalog } from "../../lib/resolve-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical model catalog.
 *
 * Source of truth for *which* models are offered is the runtime's
 * `GET /api/catalog` (the `listed` entries in its bundled `catalog.json`), so
 * a model can be added or retired in one place — the runtime — without a
 * website deploy. This route fetches that list and enriches each entry with
 * the site's curated display copy when it has a match; runtime-listed models
 * the site doesn't have copy for yet are rendered from the runtime's own
 * fields. If the runtime is unreachable or too old to expose the endpoint, we
 * fall back to the bundled snapshot so the dashboard is never empty.
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
