/**
 * Phase 5.A — append-only session receipts for mesh-served completions.
 *
 * Strategy calls for Postgres + entry-signed receipts. Sprint 1 keeps the
 * existing Upstash Redis ledger (already production for credits) and writes
 * the same receipt shape there, HMAC-signed when `SENDA_RECEIPT_HMAC_SECRET`
 * (or `CRON_SECRET`) is set. Instrument earnings first; settle later.
 */

import { createHmac, randomUUID } from "node:crypto";
import { getModelTier, type ModelTier } from "./model-tiers";
import { tokensToCredits } from "./credits-ledger";
import { getRedis } from "./redis";

const RECEIPTS_RECENT_KEY = "senda:receipts:recent";
const RECEIPTS_BY_PEER_PREFIX = "senda:receipts:by-peer";
const RECEIPTS_TTL_SEC = 120 * 24 * 3600;
const RECENT_CAP = 500;
const PEER_CAP = 200;

export type CreditAttribution = "serving-peer" | "sla-heuristic";

export type SessionReceipt = {
  id: string;
  peerId: string;
  modelId: string;
  completionTokens: number;
  promptTokens: number | null;
  credits: number;
  tier: ModelTier;
  attribution: CreditAttribution;
  ts: string;
  /** HMAC-SHA256 hex over the canonical payload; omitted when no secret. */
  sig: string | null;
};

export type SessionReceiptInput = {
  peerId: string;
  modelId: string;
  completionTokens: number;
  promptTokens?: number | null;
  tier?: ModelTier;
  attribution: CreditAttribution;
  /** Override clock in tests. */
  now?: Date;
  /** Override id in tests. */
  id?: string;
};

function receiptSecret(): string | null {
  const raw =
    process.env.SENDA_RECEIPT_HMAC_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  return raw || null;
}

/**
 * Canonical bytes signed for a receipt (excludes `sig`). Stable field order
 * so verifiers don't depend on JSON key insertion order.
 */
export function canonicalReceiptPayload(
  receipt: Omit<SessionReceipt, "sig">,
): string {
  return [
    receipt.id,
    receipt.peerId,
    receipt.modelId,
    String(receipt.completionTokens),
    receipt.promptTokens == null ? "" : String(receipt.promptTokens),
    String(receipt.credits),
    receipt.tier,
    receipt.attribution,
    receipt.ts,
  ].join("|");
}

export function signReceiptPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyReceiptSignature(receipt: SessionReceipt): boolean {
  const secret = receiptSecret();
  if (!secret || !receipt.sig) return false;
  const expected = signReceiptPayload(
    canonicalReceiptPayload(receipt),
    secret,
  );
  return expected === receipt.sig;
}

/**
 * Build a receipt object (pure). Does not write to Redis.
 */
export function buildSessionReceipt(input: SessionReceiptInput): SessionReceipt {
  const tier = input.tier ?? getModelTier(input.modelId);
  const credits = tokensToCredits(input.completionTokens, tier);
  const base: Omit<SessionReceipt, "sig"> = {
    id: input.id ?? randomUUID(),
    peerId: input.peerId.trim(),
    modelId: input.modelId,
    completionTokens: input.completionTokens,
    promptTokens:
      input.promptTokens == null || !Number.isFinite(input.promptTokens)
        ? null
        : Math.max(0, Math.floor(input.promptTokens)),
    credits,
    tier,
    attribution: input.attribution,
    ts: (input.now ?? new Date()).toISOString(),
  };
  const secret = receiptSecret();
  const sig = secret
    ? signReceiptPayload(canonicalReceiptPayload(base), secret)
    : null;
  return { ...base, sig };
}

/**
 * Append a receipt to Redis. Fire-and-forget safe — never throws to callers.
 * Returns the receipt when stored (or built even if Redis is unset, for tests).
 */
export async function appendSessionReceipt(
  input: SessionReceiptInput,
): Promise<SessionReceipt | null> {
  const peerId = input.peerId.trim();
  if (!peerId || input.completionTokens <= 0) return null;
  const receipt = buildSessionReceipt({ ...input, peerId });
  if (receipt.credits <= 0) return null;

  const redis = getRedis();
  if (!redis) return receipt;

  const json = JSON.stringify(receipt);
  const byPeer = `${RECEIPTS_BY_PEER_PREFIX}:${peerId}`;
  const score = Date.parse(receipt.ts) || Date.now();
  try {
    await Promise.all([
      redis.lpush(RECEIPTS_RECENT_KEY, json),
      redis.ltrim(RECEIPTS_RECENT_KEY, 0, RECENT_CAP - 1),
      redis.zadd(byPeer, { score, member: json }),
    ]);
    // Cap peer zset by removing oldest beyond PEER_CAP.
    await redis.zremrangebyrank(byPeer, 0, -(PEER_CAP + 1));
    await Promise.all([
      redis.expire(RECEIPTS_RECENT_KEY, RECEIPTS_TTL_SEC),
      redis.expire(byPeer, RECEIPTS_TTL_SEC),
    ]);
  } catch {
    // Bookkeeping must not break chat.
  }
  return receipt;
}
