import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Desktop sidecar proxy for the public credits ledger.
 *
 * The control UI runs on localhost without Upstash; the production ledger
 * lives on senda.network. Same-origin fetch here avoids CORS and keeps the
 * dashboard reading the real Phase 5.A balances.
 */
const PUBLIC_BASE = (
  process.env.SENDA_PUBLIC_ORIGIN ?? "https://senda.network"
).trim();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const peer = url.searchParams.get("peer")?.trim();
  const limit = url.searchParams.get("limit")?.trim();
  const target = new URL(`${PUBLIC_BASE}/api/credits`);
  if (peer) target.searchParams.set("peer", peer);
  if (limit) target.searchParams.set("limit", limit);

  try {
    const res = await fetch(target.toString(), { cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        storeReady: false,
        peer: null,
        hint: "Could not reach the public credits ledger",
      },
      { status: 502 },
    );
  }
}
