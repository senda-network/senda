/**
 * Phase 4.B — per-model routing SLA gate.
 *
 * Given a model id and the current mesh peer list, decide whether
 * the mesh can serve a request for that model at chat-viable
 * latency. The decision is purely a function of measurements the
 * mesh already gossips (Phase 1 `measured_tps_p50_by_model` +
 * Phase 3.0 `native_tps_p50_by_model`) and the per-tier targets in
 * `model-tiers.ts`.
 *
 * Outputs an `SlaEvaluation` so the call site can act on it without
 * re-deriving anything. The same gate runs on both supply paths
 * the product offers: a "meets SLA" verdict streams the request
 * from a mesh peer (the peer earns the peer-payout rate when
 * Phase 5 is on); a "misses SLA" verdict streams from the external
 * provider configured in `fallback-provider.ts` (cost-of-goods,
 * covered by the customer's payment under Phase 5's rate card).
 *
 * Pure, no I/O. Cached entry fetcher lives below as
 * `fetchMeshPeersCached` so the gate is cheap to call from the
 * chat hot path.
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
  | "both-too-low"
  | "below-native-ratio";

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
  /**
   * Best peer to attribute mesh-served completion tokens to for
   * credits accounting. The peer that met SLA when `meetsSla`, else
   * the highest-measured-tps candidate, else the first candidate id.
   * Null when no attributable peer exists.
   */
  creditPeerId: string | null;
  /**
   * Through-mesh / native throughput ratio of the selected peer
   * (mesh-measured tok/s ÷ that peer's own native-baseline tok/s).
   *
   * This is the "narrow the through-mesh vs native ratio" lever: a
   * solo serve runs the *same* llama-server on the through-mesh and
   * native paths, so a healthy peer sits at ~1.0 here. A peer that has
   * drifted below the tier's `min_native_ratio` floor (saturation,
   * thermal throttling, contention) is demoted by `evaluateSla` so the
   * entry routes around it and the *served* ratio stays tight.
   *
   * Null when the selected/best peer has no native baseline (pooled
   * split, or a legacy peer pre-v0.66.49) — in that case the floor is
   * NOT enforced, matching the missing-data convention used everywhere
   * else. On a miss, this is the best (highest) ratio observed across
   * measured candidates, or null if none reported a baseline.
   */
  bestPeerNativeRatio: number | null;
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

/** Peer id to attribute mesh credits to when the entry doesn't echo the host. */
function pickCreditPeerId(
  modelId: string,
  candidates: SlaPeer[],
  preferredId?: string,
): string | null {
  if (preferredId) return preferredId;
  let bestId: string | null = null;
  let bestTps = -1;
  for (const p of candidates) {
    const tps = p.measured_tps_p50_by_model?.[modelId];
    if (!p.id) continue;
    if (typeof tps === "number" && tps > bestTps) {
      bestTps = tps;
      bestId = p.id;
    }
  }
  if (bestId) return bestId;
  return candidates.find((p) => p.id)?.id ?? null;
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
 *  - Through-mesh / native throughput ratio must be >=
 *    `min_native_ratio` for the tier — BUT only when the peer reports a
 *    native baseline (`native_tps_p50_by_model[modelId]`). A solo serve
 *    runs the same llama-server on both paths so this is ~1.0 for a
 *    healthy peer; the floor only bites when a peer's through-mesh
 *    decode has genuinely degraded below its own proven native rate
 *    (saturation, throttling, contention). Peers without a baseline
 *    (pooled splits, legacy peers) are never penalized on this axis —
 *    same missing-data convention the rest of the gate uses.
 *  - If ANY one candidate peer satisfies all applicable thresholds,
 *    the gate passes — the entry node's existing router can hand the
 *    session to that peer.
 *
 * Reason precedence (most informative wins):
 *  1. `no-peer-with-model` — no peer claims to host the model.
 *  2. `no-measurements` — peers exist but none have measured both
 *     TPS and TTFT yet (typical for a freshly elected host before
 *     it has served its first request).
 *  3. `ttft-too-high` / `tps-too-low` / `both-too-low` — at least one
 *     measured peer fails an absolute threshold (these dominate the
 *     ratio reason; an absolute failure is the more fundamental one).
 *  4. `below-native-ratio` — every measured peer cleared the absolute
 *     thresholds but the only thing keeping the gate from passing is
 *     that the otherwise-fast peer(s) fell below the tier's
 *     through-mesh/native floor.
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
      creditPeerId: null,
      bestPeerNativeRatio: null,
    };
  }

  let bestTtft: number | null = null;
  let bestTps: number | null = null;
  let bestRatio: number | null = null;
  let anyTtftFail = false;
  let anyTpsFail = false;
  // A peer that cleared BOTH absolute thresholds but was held back only
  // by the through-mesh/native floor. Tracked separately so the miss
  // reason can distinguish "too slow in absolute terms" from "fast, but
  // degraded relative to its own native baseline".
  let anyRatioFail = false;
  let anyMeasured = false;

  for (const p of candidates) {
    const tps = p.measured_tps_p50_by_model?.[modelId];
    const ttft = p.measured_ttft_ms_p50_by_model?.[modelId];
    if (typeof tps !== "number" || tps <= 0) continue;
    if (typeof ttft !== "number" || ttft <= 0) continue;
    anyMeasured = true;
    if (bestTtft === null || ttft < bestTtft) bestTtft = ttft;
    if (bestTps === null || tps > bestTps) bestTps = tps;

    // Through-mesh / native ratio. Only computable when the peer has
    // gossiped a native baseline for this model (runtime v0.66.49+ and
    // a model that actually fits on one machine). When absent we leave
    // `ratio = null` and treat the floor as satisfied — a pooled-split
    // serve or a legacy peer must not be demoted for data it cannot
    // report.
    const native = p.native_tps_p50_by_model?.[modelId];
    const ratio =
      typeof native === "number" && native > 0 ? tps / native : null;
    if (ratio !== null && (bestRatio === null || ratio > bestRatio)) {
      bestRatio = ratio;
    }

    const ttftOk = ttft <= targets.target_ttft_ms_p50;
    const tpsOk = tps >= targets.target_tps_p50;
    const ratioOk = ratio === null || ratio >= targets.min_native_ratio;
    if (ttftOk && tpsOk && ratioOk) {
      return {
        meetsSla: true,
        tier,
        reason: "meets-sla",
        bestPeerTtftMs: bestTtft,
        bestPeerTps: bestTps,
        candidatePeerCount: candidates.length,
        creditPeerId: pickCreditPeerId(modelId, candidates, p.id),
        bestPeerNativeRatio: ratio,
      };
    }
    if (!ttftOk) anyTtftFail = true;
    if (!tpsOk) anyTpsFail = true;
    // Only count a ratio failure when it's the *sole* reason this
    // otherwise-passing peer was demoted; an absolute-threshold miss is
    // the more informative reason and takes precedence below.
    if (ttftOk && tpsOk && !ratioOk) anyRatioFail = true;
  }

  if (!anyMeasured) {
    return {
      meetsSla: false,
      tier,
      reason: "no-measurements",
      bestPeerTtftMs: null,
      bestPeerTps: null,
      candidatePeerCount: candidates.length,
      creditPeerId: pickCreditPeerId(modelId, candidates),
      bestPeerNativeRatio: null,
    };
  }

  // Absolute-threshold failures dominate; `below-native-ratio` is the
  // residual case where every measured peer was absolutely fine and the
  // floor was the only thing that demoted the otherwise-passing peer(s).
  const reason: SlaReason =
    anyTtftFail && anyTpsFail
      ? "both-too-low"
      : anyTtftFail
        ? "ttft-too-high"
        : anyTpsFail
          ? "tps-too-low"
          : anyRatioFail
            ? "below-native-ratio"
            : "tps-too-low";

  return {
    meetsSla: false,
    tier,
    reason,
    bestPeerTtftMs: bestTtft,
    bestPeerTps: bestTps,
    candidatePeerCount: candidates.length,
    creditPeerId: pickCreditPeerId(modelId, candidates),
    bestPeerNativeRatio: bestRatio,
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
