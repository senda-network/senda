/**
 * Early-access credits ledger — mesh completion tokens → credit balance.
 *
 * Records attributable mesh serves from `/api/chat` into Upstash Redis.
 * Credits are illustrative USD micro-units (1 credit = $0.000001) derived
 * from {@link PEER_PAYOUT_USD_PER_MTOKEN_BY_TIER}; not cash, not on-chain.
 *
 * Attribution uses `SlaEvaluation.creditPeerId` until the runtime echoes
 * the serving host on the response path.
 */

import {
  getModelTier,
  PEER_PAYOUT_USD_PER_MTOKEN_BY_TIER,
  type ModelTier,
} from "./model-tiers";
import { getRedis } from "./redis";

const BALANCE_PREFIX = "closedmesh:credits:balance";
const TOKENS_PREFIX = "closedmesh:credits:tokens";
const LEADERBOARD_KEY = "closedmesh:credits:leaderboard";
const LEDGER_TTL_SEC = 120 * 24 * 3600; // ~120 days

/** 1 credit = one micro-dollar ($0.000001). */
export function tokensToCredits(tokens: number, tier: ModelTier): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  const rate = PEER_PAYOUT_USD_PER_MTOKEN_BY_TIER[tier];
  const usd = (tokens / 1_000_000) * rate;
  return Math.round(usd * 1_000_000);
}

export function creditsToUsdDisplay(credits: number): number {
  return credits / 1_000_000;
}

export type CreditRecordInput = {
  peerId: string;
  modelId: string;
  completionTokens: number;
  tier?: ModelTier;
};

/**
 * Fire-and-forget credit increment. Never throws to callers on the chat
 * hot path — same contract as {@link recordServedByDecision}.
 */
export async function recordMeshCredits(
  input: CreditRecordInput,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const peerId = input.peerId.trim();
  if (!peerId) return;
  const tier = input.tier ?? getModelTier(input.modelId);
  const credits = tokensToCredits(input.completionTokens, tier);
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
  usd: number;
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
    out.push({ peerId, credits, usd: creditsToUsdDisplay(credits) });
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
  usd: number;
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
      usd: creditsToUsdDisplay(credits),
      tokensByModel: normalizeTokenMap(tokensRaw),
    };
  } catch {
    return null;
  }
}

export function creditsStoreReady(): boolean {
  return getRedis() != null;
}
