/**
 * In-memory store for peer audit reports.
 *
 * ## Why this exists
 *
 * Slice 4 of the mesh-visibility rollout closes the last remaining
 * dishonesty in the system: the public status page renders what
 * `mesh.closedmesh.com/api/status` returns, which is *only* the peers
 * that currently maintain an iroh connection to the entry. A peer
 * whose connection has silently died (the May 2026 MSI failure mode)
 * is by construction missing from that list — so the public page can
 * silently underreport mesh health and the operator never knows.
 *
 * The fix is a side channel: each peer's runtime POSTs its own audit
 * snapshot to `https://closedmesh.com/api/peer-report` every minute.
 * We retain the report for a few minutes and the `/api/status` route
 * merges it into the response. A peer that's in our reports but NOT
 * in the entry's peer list is a "claimed-but-invisible" peer — exactly
 * the silently-broken state we want to surface.
 *
 * ## Why module-level Map instead of Vercel KV
 *
 * For ClosedMesh's current scale (≤ ~10 active peers) a globalThis Map
 * is sufficient. Vercel's Node lambdas are reused across requests on a
 * warm container — typically minutes to hours of lifetime — so within
 * a single instance, peer reports persist through many polling cycles.
 * Cross-instance staleness is bounded by the POST cadence (60 s): even
 * if a write hit instance A and a read hit instance B, the next status
 * poll typically resolves the discrepancy.
 *
 * If we outgrow this, swap the backing map for Vercel KV / Upstash by
 * editing only this file — the route + status-merge layers consume
 * the [`PeerReportStore`] interface and are agnostic to the backend.
 *
 * ## globalThis vs module scope
 *
 * Next.js + Webpack hot-reload re-evaluates module code on each change
 * in dev, which would wipe a plain module-level Map every save. Keying
 * via `globalThis` survives module reloads because the global object is
 * preserved across re-evals. Same trick the @vercel/postgres SDK uses
 * to cache its connection pool.
 */

/** What each peer POSTs after each successful audit cycle. */
export type PeerReportInput = {
  nodeId: string;
  hostname: string | null;
  version: string | null;
  servingModels: string[];
  meshVisibility: {
    state: "unknown" | "visible" | "invisible" | "entry_unreachable";
    lastCheckUnix: number | null;
    lastVisibleUnix: number | null;
    consecutiveInvisibleCount: number;
    lastError: string | null;
    entryUrl: string;
    softReconnectTriggered: boolean;
    hardResetTriggered: boolean;
  };
};

/** A stored report = what the peer sent + when we received it. */
export type StoredPeerReport = PeerReportInput & {
  /** Unix seconds when this report was received by the Vercel route. */
  receivedAtUnix: number;
};

/**
 * Reports older than this are dropped on read. Five minutes is long
 * enough to survive a peer's runtime restart cycle (process exit →
 * supervisor respawn → audit warm-up ≈ 30 s) without ghosting the UI,
 * but short enough that an actually-offline peer disappears from the
 * "claimed-but-invisible" list before the operator wastes time on it.
 */
const REPORT_TTL_SEC = 5 * 60;

/**
 * Hard cap on stored reports. Defends against an adversarial peer
 * spamming reports with rotating node IDs. At our scale (≤ ~50 real
 * peers in the optimistic medium-term) this is a safety belt, not a
 * functional limit.
 */
const MAX_REPORTS = 1024;

/**
 * Hard cap on the size of a single report body. Reports are tiny in
 * normal operation (~500 bytes); a body larger than this is either a
 * runtime bug or an adversary stuffing junk into `lastError`.
 */
export const MAX_REPORT_BYTES = 8 * 1024;

type GlobalWithStore = typeof globalThis & {
  __closedmeshPeerReportStore?: Map<string, StoredPeerReport>;
};

function backingMap(): Map<string, StoredPeerReport> {
  const g = globalThis as GlobalWithStore;
  if (!g.__closedmeshPeerReportStore) {
    g.__closedmeshPeerReportStore = new Map();
  }
  return g.__closedmeshPeerReportStore;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function expireOld(map: Map<string, StoredPeerReport>): void {
  const cutoff = nowUnix() - REPORT_TTL_SEC;
  for (const [k, v] of map.entries()) {
    if (v.receivedAtUnix < cutoff) map.delete(k);
  }
}

function trimToCap(map: Map<string, StoredPeerReport>): void {
  if (map.size <= MAX_REPORTS) return;
  // Drop the oldest entries first. Map iterates insertion order; reports
  // are reinserted on every update via `.set()` which moves them to the
  // end, so the oldest receivedAtUnix is at the front of the iterator.
  const overflow = map.size - MAX_REPORTS;
  let dropped = 0;
  for (const k of map.keys()) {
    if (dropped >= overflow) break;
    map.delete(k);
    dropped += 1;
  }
}

/**
 * Insert / replace a peer's most recent report. We key by `nodeId`
 * which is the iroh `EndpointId.fmt_short()` — the same key the entry
 * uses in `peers[].id`, so the status-merge layer can join cleanly.
 */
export function putReport(report: PeerReportInput): StoredPeerReport {
  const map = backingMap();
  expireOld(map);
  const stored: StoredPeerReport = { ...report, receivedAtUnix: nowUnix() };
  // Delete-then-set so the entry moves to the end of insertion order,
  // which keeps `trimToCap` correctly dropping the staler entries.
  map.delete(report.nodeId);
  map.set(report.nodeId, stored);
  trimToCap(map);
  return stored;
}

/**
 * Return all non-expired reports, newest first. The caller usually
 * doesn't care about ordering, but newest-first reduces eyeball noise
 * in debug surfaces.
 */
export function listReports(): StoredPeerReport[] {
  const map = backingMap();
  expireOld(map);
  return [...map.values()].sort(
    (a, b) => b.receivedAtUnix - a.receivedAtUnix,
  );
}

/**
 * Look up a single peer's most recent report, if any.
 */
export function getReport(nodeId: string): StoredPeerReport | null {
  const map = backingMap();
  expireOld(map);
  return map.get(nodeId) ?? null;
}

/**
 * Test-only knob to reset the store between cases. The route + merge
 * layer don't call this in production; expose it so unit tests can
 * exercise the store deterministically.
 */
export function __resetForTest(): void {
  const g = globalThis as GlobalWithStore;
  g.__closedmeshPeerReportStore = new Map();
}
