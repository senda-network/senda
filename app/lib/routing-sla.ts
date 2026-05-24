/**
 * Phase 4.B — per-model routing SLA gate.
 *
 * Given a model id and the current mesh peer list, decide whether the
 * mesh can serve a request for that model at chat-viable latency. The
 * decision is purely a function of measurements the mesh already
 * gossips (Phase 1 `measured_tps_p50_by_model` + Phase 3.0
 * `native_tps_p50_by_model`) and the per-tier targets in
 * `model-tiers.ts`.
 *
 * Outputs an `SlaEvaluation` so the call site can act on it without
 * re-deriving anything: today (Day 2) `/api/chat` emits the result as
 * a response header and still forwards to the mesh. Day 3 flips the
 * routing branch — `meetsSla=false` will dispatch to a fallback
 * provider instead.
 *
 * Pure, no I/O. Cached entry fetcher lives below as
 * `fetchMeshPeersCached` so the gate is cheap to call from the chat
 * hot path.
 */

import { getModelTier, SLA_TARGETS_BY_TIER, type ModelTier } from "./model-tiers";

/**
 * Minimal peer shape the gate consumes.
 *
 * Maps to the runtime's raw `/api/status` shape (snake_case fields)
 * so callers can pass the entry-node response directly without going
 * through the website's normalised view. Each field is optional
 * because older runtimes + workers in a pipeline split don't emit
 * the marketplace metrics — those peers are correctly treated as
 * "no measurement" by `evaluateSla`.
 */
export type SlaPeer = {
  /** Runtime node id (or short id from the entry). For logging only. */
  id?: string;
  /** Peer hostname; for logging only. */
  hostname?: string | null;
  /** Peer state from `/api/status` — only `serving` peers are SLA candidates. */
  state?: string;
  /** Models the peer claims to be currently serving. */
  serving_models?: string[];
  /** Models the peer reports `llama-server` ready for. Some runtimes only fill this. */
  hosted_models?: string[];
  /** Phase 1: per-model rolling 1h median tok/s the peer measured locally. */
  measured_tps_p50_by_model?: Record<string, number>;
  /** Phase 1: per-model rolling 1h median TTFT (ms) the peer measured locally. */
  measured_ttft_ms_p50_by_model?: Record<string, number>;
  /** Phase 3.0: per-model native-baseline tok/s (no mesh in the path). */
  native_tps_p50_by_model?: Record<string, number>;
  /** Phase 3.0: per-model native-baseline TTFT (ms). */
  native_ttft_ms_p50_by_model?: Record<string, number>;
  capability?: {
    loaded_models?: string[];
  };
};

/**
 * Why a model failed (or passed) the gate. Logged + emitted as a
 * response header for observability before the Day 3 routing flip.
 */
export type SlaReason =
  | "meets-sla"
  | "no-peer-with-model"
  | "no-measurements"
  | "ttft-too-high"
  | "tps-too-low"
  | "both-too-low";

export type SlaEvaluation = {
  /** Whether the mesh has at least one peer that meets the tier's SLA for this model. */
  meetsSla: boolean;
  /** Tier of the requested model, captured here so the call site doesn't re-lookup. */
  tier: ModelTier;
  reason: SlaReason;
  /**
   * Best (lowest) measured TTFT across SLA-candidate peers for this
   * model, in ms. Null when no peer has a measurement yet.
   */
  bestPeerTtftMs: number | null;
  /**
   * Best (highest) measured tok/s across SLA-candidate peers for
   * this model. Null when no peer has a measurement yet.
   */
  bestPeerTps: number | null;
  /**
   * Number of peers that have this model loaded and are in a
   * serving state. Lets the call site distinguish "no host elected
   * yet" from "host elected but below SLA".
   */
  candidatePeerCount: number;
};

/**
 * Snake-case field name candidates the runtime uses across versions.
 * `loaded_models` lives on `capability` on most runtimes but a small
 * number of older ones report it at the top level via `hosted_models`.
 * `loadedModelsFor` collapses both into a single helper.
 */
function loadedModelsFor(peer: SlaPeer): string[] {
  const out = new Set<string>();
  for (const m of peer.capability?.loaded_models ?? []) out.add(m);
  for (const m of peer.hosted_models ?? []) out.add(m);
  for (const m of peer.serving_models ?? []) out.add(m);
  return [...out];
}

function isUsableState(state: string | undefined): boolean {
  return (
    state === "serving" ||
    // Pipeline workers + standby hosts that have the model on disk
    // are NOT usable for SLA purposes — only the elected host serves
    // requests. We exclude `loading`, `client`, `unreachable`,
    // `offline`, and `standby` explicitly.
    state === undefined // treat missing as serving for older runtimes that don't emit state on the local entry
  );
}

/**
 * Evaluate whether the mesh meets the SLA for `modelId`.
 *
 * Determinism: same inputs → same output. Tested as a pure function.
 *
 * Peer selection:
 *  - Must list `modelId` in `loaded_models` / `hosted_models` /
 *    `serving_models` (via `loadedModelsFor`).
 *  - Must be in a usable state per `isUsableState` (or have no
 *    `state` field, which matches some older runtime shapes).
 *
 * SLA semantics:
 *  - Peer must have BOTH `measured_tps_p50_by_model[modelId]` and
 *    `measured_ttft_ms_p50_by_model[modelId]` present.
 *  - TPS must be >= `target_tps_p50` for the tier.
 *  - TTFT must be <= `target_ttft_ms_p50` for the tier.
 *  - If ANY one candidate peer satisfies both, the gate passes —
 *    the entry node's existing router can hand the session to that
 *    peer.
 *
 * Reason precedence (most informative wins):
 *  1. `no-peer-with-model` — no peer claims to host the model.
 *  2. `no-measurements` — peers exist but none have measured both
 *     TPS and TTFT yet (typical for a freshly elected host before
 *     it has served its first request).
 *  3. `ttft-too-high` / `tps-too-low` / `both-too-low` — every
 *     measured peer fails at least one threshold.
 */
export function evaluateSla(
  modelId: string,
  peers: SlaPeer[],
): SlaEvaluation {
  const tier = getModelTier(modelId);
  const targets = SLA_TARGETS_BY_TIER[tier];

  const candidates = peers.filter((p) => {
    if (!isUsableState(p.state)) return false;
    return loadedModelsFor(p).includes(modelId);
  });

  if (candidates.length === 0) {
    return {
      meetsSla: false,
      tier,
      reason: "no-peer-with-model",
      bestPeerTtftMs: null,
      bestPeerTps: null,
      candidatePeerCount: 0,
    };
  }

  let bestTtft: number | null = null;
  let bestTps: number | null = null;
  let anyTtftFail = false;
  let anyTpsFail = false;
  let anyMeasured = false;

  for (const p of candidates) {
    const tps = p.measured_tps_p50_by_model?.[modelId];
    const ttft = p.measured_ttft_ms_p50_by_model?.[modelId];
    if (typeof tps !== "number" || tps <= 0) continue;
    if (typeof ttft !== "number" || ttft <= 0) continue;
    anyMeasured = true;
    if (bestTtft === null || ttft < bestTtft) bestTtft = ttft;
    if (bestTps === null || tps > bestTps) bestTps = tps;
    const ttftOk = ttft <= targets.target_ttft_ms_p50;
    const tpsOk = tps >= targets.target_tps_p50;
    if (ttftOk && tpsOk) {
      return {
        meetsSla: true,
        tier,
        reason: "meets-sla",
        bestPeerTtftMs: bestTtft,
        bestPeerTps: bestTps,
        candidatePeerCount: candidates.length,
      };
    }
    if (!ttftOk) anyTtftFail = true;
    if (!tpsOk) anyTpsFail = true;
  }

  if (!anyMeasured) {
    return {
      meetsSla: false,
      tier,
      reason: "no-measurements",
      bestPeerTtftMs: null,
      bestPeerTps: null,
      candidatePeerCount: candidates.length,
    };
  }

  const reason: SlaReason =
    anyTtftFail && anyTpsFail
      ? "both-too-low"
      : anyTtftFail
        ? "ttft-too-high"
        : "tps-too-low";

  return {
    meetsSla: false,
    tier,
    reason,
    bestPeerTtftMs: bestTtft,
    bestPeerTps: bestTps,
    candidatePeerCount: candidates.length,
  };
}

// ---------------------------------------------------------------------------
// Cached mesh-entry fetcher
// ---------------------------------------------------------------------------
//
// The gate needs the current peer list on every chat request, but we
// don't want to add a 200–500 ms round-trip to `mesh.closedmesh.com`
// in front of every stream. A small in-memory cache with a short TTL
// is enough — peer marketplace metrics gossip slowly (samples roll up
// over an hour) so a 5-second TTL is essentially free correctness-wise
// and ~free latency-wise.
//
// Module-level state is safe inside a Next.js route handler instance;
// when Vercel cold-starts a new lambda the cache starts empty, which
// is fine — the first request after a cold start eats the round trip.

type MeshStatusResponse = {
  peers?: SlaPeer[];
};

const CACHE_TTL_MS = 5_000;

let cached: { at: number; peers: SlaPeer[] } | null = null;
let inflight: Promise<SlaPeer[]> | null = null;

function meshStatusUrl(): string {
  const raw =
    process.env.CLOSEDMESH_KPI_STATUS_URL?.trim() ||
    process.env.CLOSEDMESH_MESH_DISCOVERY_URL?.trim() ||
    "https://mesh.closedmesh.com";
  // Accept either base or full /api/status; coerce to the full path.
  if (/\/api\/status$/.test(raw)) return raw;
  return raw.replace(/\/+$/, "") + "/api/status";
}

async function fetchMeshPeersOnce(): Promise<SlaPeer[]> {
  try {
    const res = await fetch(meshStatusUrl(), { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as MeshStatusResponse;
    return json.peers ?? [];
  } catch {
    return [];
  }
}

/**
 * Returns the most-recent mesh peer list, cached for `CACHE_TTL_MS`.
 * Concurrent callers within the same lambda share one in-flight
 * fetch; nothing fancy beyond that.
 */
export async function fetchMeshPeersCached(): Promise<SlaPeer[]> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.peers;
  if (inflight) return inflight;
  inflight = fetchMeshPeersOnce().then((peers) => {
    cached = { at: Date.now(), peers };
    inflight = null;
    return peers;
  });
  return inflight;
}

/**
 * Test-only escape hatch so unit tests can reset the cache between
 * cases. Not exported from a barrel; not part of the public API.
 */
export function __resetMeshPeersCacheForTests(): void {
  cached = null;
  inflight = null;
}
