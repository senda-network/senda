import { NextResponse } from "next/server";
import { MODEL_CATALOG } from "../../lib/model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical model catalog.
 *
 * Lives on the public site (closedmesh.com). The desktop app's bundled
 * controller fetches this URL **directly** from the browser — no local
 * proxy in between. Editing `model-catalog.ts` and shipping the website
 * is the one-step "ship a new model to all users" path; existing desktop
 * installs pick up the change on their next dashboard load.
 *
 * CORS is wide open here on purpose:
 *   - the catalog is public, non-sensitive data
 *   - the desktop sidecar binds to a kernel-assigned port we can't predict
 *     (see `desktop/src/sidecar.rs`), so allow-listing specific origins
 *     would mean perpetually chasing them
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
  return NextResponse.json(
    {
      ok: true,
      catalog: MODEL_CATALOG,
      fetchedAt: new Date().toISOString(),
    },
    {
      headers: {
        ...CORS_HEADERS,
        // Vercel's edge caches for 5 min and serves stale for an hour
        // while it revalidates. The client also caches in localStorage,
        // so this header is mostly defensive against bursts.
        "cache-control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
