import { NextResponse } from "next/server";
import {
  creditsStoreReady,
  getCreditsLeaderboard,
  getPeerCredits,
} from "../../lib/credits-ledger";

/**
 * GET /api/credits — public credits ledger reads (early access).
 *
 *   ?limit=10        → top-N leaderboard (default 10, max 50)
 *   ?peer=<nodeId>   → that peer's balance + per-model served tokens
 *
 * Returns `storeReady: false` (not an error) when Upstash is not
 * configured, so local dev and the website degrade gracefully.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const peer = url.searchParams.get("peer")?.trim();

  if (peer) {
    if (!creditsStoreReady()) {
      return NextResponse.json({ storeReady: false, peer: null });
    }
    const data = await getPeerCredits(peer);
    return NextResponse.json({ storeReady: true, peer: data });
  }

  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(
    50,
    Math.max(1, limitRaw ? Number.parseInt(limitRaw, 10) || 10 : 10),
  );

  if (!creditsStoreReady()) {
    return NextResponse.json({
      storeReady: false,
      leaderboard: [],
      hint: "Link Upstash Redis on Vercel to enable the credits ledger",
    });
  }

  const leaderboard = await getCreditsLeaderboard(limit);
  return NextResponse.json({
    storeReady: true,
    leaderboard,
  });
}
