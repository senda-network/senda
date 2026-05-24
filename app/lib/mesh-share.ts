/**
 * Phase 4 — `mesh_share_pct` accounting.
 *
 * The headline KPI for the inference API: what fraction of requests
 * are served by community hardware (the mesh) vs the external
 * provider configured in `fallback-provider.ts`. In Phase 4 this
 * is the routing-primitive health metric on the free `/chat`
 * testbed. In Phase 5 the same counter — read off the same Redis
 * buckets — becomes the margin-mix lever on the paid API:
 * mesh-served requests carry the (typically larger) mesh margin
 * and pay out to peers, fallback-served requests cover
 * external-provider COGS out of the customer's payment. Every
 * percentage point of `mesh_share_pct` is a percentage point of
 * revenue that flows to a peer instead of out to an external
 * provider.
 *
 * Storage shape (Upstash Redis):
 *
 *   closedmesh:mesh-share:mesh:<YYYYMMDDTHH>      -> integer counter
 *   closedmesh:mesh-share:fallback:<YYYYMMDDTHH>  -> integer counter
 *
 * One key per hour per `served_by` value. Each chat request fires
 * one `INCR` on its bucket; the metrics dashboard reads the last N
 * hourly buckets and sums.
 *
 * Buckets carry a long TTL (~30 days) so we can plot 7-day rolling
 * windows without writing additional aggregates. The numbers per
 * bucket are tiny (a few bytes), so storage cost is negligible
 * even with hundreds of thousands of requests.
 *
 * No I/O when Redis isn't configured (local dev, tests).
 */

import { getRedis } from "./redis";

export type ServedBy = "mesh" | "fallback";

const MESH_SHARE_PREFIX = "closedmesh:mesh-share";
const BUCKET_TTL_SEC = 35 * 24 * 3600; // ~5 weeks; rolling window comfortably covers 7 d

function hourBucketLabel(at: Date): string {
  return (
    String(at.getUTCFullYear()) +
    String(at.getUTCMonth() + 1).padStart(2, "0") +
    String(at.getUTCDate()).padStart(2, "0") +
    "T" +
    String(at.getUTCHours()).padStart(2, "0")
  );
}

function bucketKey(servedBy: ServedBy, hour: string): string {
  return `${MESH_SHARE_PREFIX}:${servedBy}:${hour}`;
}

/**
 * Fire-and-forget counter increment. Resolves once Redis confirms
 * but callers should NOT await this — the chat hot path returns
 * the stream as soon as `streamText` resolves, and the counter
 * write should not gate that.
 *
 * Safe to call when Redis isn't configured; returns silently.
 */
export async function recordServedByDecision(
  servedBy: ServedBy,
  at: Date = new Date(),
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const hour = hourBucketLabel(at);
  const key = bucketKey(servedBy, hour);
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, BUCKET_TTL_SEC);
    }
  } catch {
    // Silently swallow Redis errors in this counter only: the
    // streamed response is what the customer paid for (or what the
    // testbed promises today); the KPI counter is bookkeeping that
    // must never be allowed to 500 the request.
  }
}

export type MeshShareWindow = {
  /** Number of hours summed into this window. */
  hours: number;
  mesh: number;
  fallback: number;
  /**
   * Mesh share percentage = mesh / (mesh + fallback). Null when no
   * requests have been recorded in the window — distinguishes
   * "metric not collected yet" from "no requests served at all,
   * report 0%".
   */
  pct: number | null;
};

/**
 * Sum the last `hours` hourly buckets and return the mesh-share
 * window. Returns zeros (and `pct: null`) when Redis is unavailable,
 * so callers can render the panel uniformly without branching on
 * store-readiness.
 *
 * For perf: this issues one `MGET` per category (2 round-trips
 * total) regardless of `hours`. 168 hours (1 week) → 2 round-trips,
 * each ~20 ms over Upstash REST.
 */
export async function getMeshShareRolling(
  hours: number,
  now: Date = new Date(),
): Promise<MeshShareWindow> {
  const redis = getRedis();
  if (!redis || hours <= 0) {
    return { hours, mesh: 0, fallback: 0, pct: null };
  }
  const meshKeys: string[] = [];
  const fallbackKeys: string[] = [];
  for (let i = 0; i < hours; i++) {
    const at = new Date(now.getTime() - i * 3600_000);
    const hour = hourBucketLabel(at);
    meshKeys.push(bucketKey("mesh", hour));
    fallbackKeys.push(bucketKey("fallback", hour));
  }
  try {
    const [meshVals, fallbackVals] = await Promise.all([
      redis.mget<(string | number | null)[]>(...meshKeys),
      redis.mget<(string | number | null)[]>(...fallbackKeys),
    ]);
    const mesh = sumCounters(meshVals);
    const fallback = sumCounters(fallbackVals);
    const total = mesh + fallback;
    return {
      hours,
      mesh,
      fallback,
      pct: total > 0 ? (mesh / total) * 100 : null,
    };
  } catch {
    return { hours, mesh: 0, fallback: 0, pct: null };
  }
}

/**
 * Upstash returns counter values as either numbers or stringified
 * numbers depending on client version; coerce uniformly and treat
 * missing buckets as zero.
 */
function sumCounters(vals: (string | number | null)[] | null): number {
  if (!vals) return 0;
  let sum = 0;
  for (const v of vals) {
    if (v == null) continue;
    const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
    if (!Number.isNaN(n)) sum += n;
  }
  return sum;
}

/**
 * Test-only: lets unit tests assemble a fake counter set and run
 * `getMeshShareRolling` against an injected redis-like shim. Kept
 * minimal — the production path doesn't need this seam.
 */
export type MeshShareCounters = Record<string, number>;

export function computeMeshShareFromCounters(
  counters: MeshShareCounters,
  hours: number,
  now: Date,
): MeshShareWindow {
  let mesh = 0;
  let fallback = 0;
  for (let i = 0; i < hours; i++) {
    const at = new Date(now.getTime() - i * 3600_000);
    const hour = hourBucketLabel(at);
    mesh += counters[bucketKey("mesh", hour)] ?? 0;
    fallback += counters[bucketKey("fallback", hour)] ?? 0;
  }
  const total = mesh + fallback;
  return {
    hours,
    mesh,
    fallback,
    pct: total > 0 ? (mesh / total) * 100 : null,
  };
}
