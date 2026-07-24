/**
 * Early-access credits ledger — mesh completion tokens → credit balance.
 *
 * Phase 5.A Sprint 1: Upstash Redis (already production) is the ledger.
 * A credit is a tier-weighted token (see {@link TIER_WEIGHT}): the tokens a
 * peer served, scaled by how hard the model is to serve. Not cash, not
 * on-chain — instrumented contribution until payout rails ship.
 *
 * Prefer runtime `x-senda-serving-peer`; fall back to SLA `creditPeerId`.
 *
 * Phase 5.B: optional reputation multiplier on *future* accruals only
 * (see {@link credit-multiplier}). Default multiplier is 1.0 until
 * `SENDA_CREDIT_SLASH` is enabled after the L1 oracle gate.
 */

import {
  applyCreditMultiplier,
  creditMultiplierForAttribution,
  type CreditAttribution,
} from "./credit-multiplier";
import {
  getModelTier,
  TIER_WEIGHT,
  type ModelTier,
} from "./model-tiers";
import { getRedis } from "./redis";
import { getCachedReputationGrade, shortPeerId } from "./verification-receipts";

const BALANCE_PREFIX = "senda:credits:balance";
const TOKENS_PREFIX = "senda:credits:tokens";
const LEADERBOARD_KEY = "senda:credits:leaderboard";
const LEDGER_TTL_SEC = 120 * 24 * 3600; // ~120 days

/** 1 credit = one tier-weighted token served (`tokens * TIER_WEIGHT[tier]`). */
export function tokensToCredits(tokens: number, tier: ModelTier): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.round(tokens * TIER_WEIGHT[tier]);
}

export type CreditRecordInput = {
  peerId: string;
  modelId: string;
  completionTokens: number;
  tier?: ModelTier;
  /** When set, may scale credits via reputation (serving-peer only). */
  attribution?: CreditAttribution;
  /**
   * Precomputed multiplier (0–1). When omitted, resolved from Redis grade
   * cache + `SENDA_CREDIT_SLASH` (defaults to 1).
   */
  multiplier?: number;
};

/**
 * Resolve the credit multiplier for a mesh serve. Pure policy + Redis grade
 * lookup; safe to call from the chat hot path (failures → 1.0).
 */
export async function resolveCreditMultiplier(
  peerId: string,
  modelId: string,
  attribution: CreditAttribution | null | undefined,
): Promise<number> {
  if (attribution !== "serving-peer") return 1;
  const grade = await getCachedReputationGrade(peerId, modelId);
  return creditMultiplierForAttribution(grade, attribution);
}

/**
 * Fire-and-forget credit increment. Never throws to callers on the chat
 * hot path — same contract as {@link recordServedByDecision}.
 */
export async function recordMeshCredits(
  input: CreditRecordInput,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const peerId = shortPeerId(input.peerId);
  if (!peerId) return;
  const tier = input.tier ?? getModelTier(input.modelId);
  const base = tokensToCredits(input.completionTokens, tier);
  const multiplier =
    typeof input.multiplier === "number"
      ? input.multiplier
      : await resolveCreditMultiplier(peerId, input.modelId, input.attribution);
  const credits = applyCreditMultiplier(base, multiplier);
  if (credits <= 0) return;

  const balanceKey = `${BALANCE_PREFIX}:${peerId}`;
  const tokensKey = `${TOKENS_PREFIX}:${peerId}`;
  try {
    await Promise.all([
      redis.incrby(balanceKey, credits),
      redis.hincrby(tokensKey, input.modelId, input.completionTokens),
      redis.zincrby(LEADERBOARD_KEY, credits, peerId),
    ]);
    await Promise.all([
      redis.expire(balanceKey, LEDGER_TTL_SEC),
      redis.expire(tokensKey, LEDGER_TTL_SEC),
      redis.expire(LEADERBOARD_KEY, LEDGER_TTL_SEC),
    ]);
  } catch {
    // Bookkeeping must not break chat.
  }
}

export type CreditLeaderboardRow = {
  peerId: string;
  credits: number;
};

/**
 * Parse Upstash's `ZRANGE ... WITHSCORES` reply, which is a FLAT array
 * `[member, score, member, score, ...]` — NOT an array of tuples. Pure so
 * the flat-vs-tuple bug class is pinned by a unit test.
 */
export function parseLeaderboardFlat(
  flat: (string | number)[] | null | undefined,
): CreditLeaderboardRow[] {
  if (!flat?.length) return [];
  const out: CreditLeaderboardRow[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const peerId = String(flat[i]);
    const credits = Number(flat[i + 1]);
    if (!peerId || Number.isNaN(credits)) continue;
    out.push({ peerId, credits });
  }
  return out;
}

/**
 * Top peers by accumulated credits. Returns empty when Redis is unset.
 */
export async function getCreditsLeaderboard(
  limit = 10,
): Promise<CreditLeaderboardRow[]> {
  const redis = getRedis();
  if (!redis || limit <= 0) return [];
  try {
    const flat = await redis.zrange<(string | number)[]>(
      LEADERBOARD_KEY,
      0,
      limit - 1,
      { rev: true, withScores: true },
    );
    return parseLeaderboardFlat(flat);
  } catch {
    return [];
  }
}

export type PeerCredits = {
  peerId: string;
  credits: number;
  tokensByModel: Record<string, number>;
};

/**
 * Coerce a Redis hash reply (`{ model: tokens }`, values string or number)
 * into a numeric map. Pure so the string-vs-number coercion is tested.
 */
export function normalizeTokenMap(
  raw: Record<string, string | number> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const [model, value] of Object.entries(raw)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isNaN(n) && n > 0) out[model] = n;
  }
  return out;
}

/**
 * Look up one peer's accumulated credits + per-model served tokens. Returns
 * a zeroed record (not null) for a known-empty peer so the caller can render
 * "0 credits" distinctly from "store unavailable" (null).
 */
export async function getPeerCredits(
  peerId: string,
): Promise<PeerCredits | null> {
  const redis = getRedis();
  const id = peerId.trim();
  if (!redis || !id) return null;
  try {
    const [balanceRaw, tokensRaw] = await Promise.all([
      redis.get<number | string | null>(`${BALANCE_PREFIX}:${id}`),
      redis.hgetall<Record<string, string | number>>(`${TOKENS_PREFIX}:${id}`),
    ]);
    const creditsNum = balanceRaw == null ? 0 : Number(balanceRaw);
    const credits = Number.isNaN(creditsNum) ? 0 : creditsNum;
    return {
      peerId: id,
      credits,
      tokensByModel: normalizeTokenMap(tokensRaw),
    };
  } catch {
    return null;
  }
}

export function creditsStoreReady(): boolean {
  return getRedis() != null;
}
