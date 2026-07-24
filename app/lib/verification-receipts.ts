/**
 * Phase 5.B — observe-mode verification receipts for the credit ledger.
 *
 * The runtime verifier already audits peers with synthetic probes (never user
 * traffic). This module persists those verdicts into Redis next to session
 * receipts, and caches reputation grades for the (still-gated) credit
 * multiplier. Ingest is a site pull from entry `/api/status` — no runtime
 * webhook required for MVP.
 */

import { createHmac } from "node:crypto";
import { getRedis } from "./redis";

const RECEIPTS_RECENT_KEY = "senda:verify:recent";
const RECEIPTS_BY_PEER_PREFIX = "senda:verify:by-peer";
const SEEN_IDS_KEY = "senda:verify:seen";
const GRADE_PREFIX = "senda:verify:grade";
const RECEIPTS_TTL_SEC = 120 * 24 * 3600;
const RECENT_CAP = 500;
const PEER_CAP = 200;
const SEEN_CAP = 5000;

/** Credits / status both key peers by the first 10 chars of the node id. */
export function shortPeerId(id: string): string {
  const trimmed = id.trim();
  return trimmed.length <= 10 ? trimmed : trimmed.slice(0, 10);
}

export type VerificationVerdict =
  | "match"
  | "mismatch"
  | "inconclusive"
  | string;

export type VerificationReceipt = {
  id: string;
  peerId: string;
  modelId: string;
  verdict: VerificationVerdict;
  agreement: number;
  comparedTokens: number;
  mode: string;
  reason: string | null;
  /** Reputation grade at ingest time, when available. */
  grade: string | null;
  score: number | null;
  samples: number | null;
  checkedAtUnixSecs: number;
  ts: string;
  /** HMAC-SHA256 hex over the canonical payload; null when no secret. */
  sig: string | null;
};

export type VerificationReceiptInput = {
  peerId: string;
  modelId: string;
  verdict: VerificationVerdict;
  agreement: number;
  comparedTokens: number;
  mode: string;
  reason?: string | null;
  grade?: string | null;
  score?: number | null;
  samples?: number | null;
  checkedAtUnixSecs: number;
  now?: Date;
};

/** Raw snake_case verify payload from entry `/api/status`. */
export type RuntimeVerifyRaw = {
  verdict?: string;
  agreement?: number;
  compared_tokens?: number;
  mode?: string;
  reason?: string | null;
  checked_at_unix_secs?: number;
};

/** Raw snake_case reputation payload from entry `/api/status`. */
export type RuntimeReputationRaw = {
  grade?: string;
  score?: number;
  samples?: number;
  matches?: number;
  mismatches?: number;
  last_verdict?: string;
  updated_at_unix_secs?: number;
};

export type MeshPeerVerifySource = {
  id?: string;
  verify_by_model?: Record<string, RuntimeVerifyRaw> | null;
  reputation_by_model?: Record<string, RuntimeReputationRaw> | null;
};

function receiptSecret(): string | null {
  const raw =
    process.env.SENDA_RECEIPT_HMAC_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  return raw || null;
}

export function verificationReceiptId(
  peerId: string,
  modelId: string,
  checkedAtUnixSecs: number,
  verdict: string,
): string {
  return `${shortPeerId(peerId)}|${modelId}|${checkedAtUnixSecs}|${verdict}`;
}

export function canonicalVerificationPayload(
  receipt: Omit<VerificationReceipt, "sig">,
): string {
  return [
    receipt.id,
    receipt.peerId,
    receipt.modelId,
    receipt.verdict,
    String(receipt.agreement),
    String(receipt.comparedTokens),
    receipt.mode,
    receipt.reason ?? "",
    receipt.grade ?? "",
    receipt.score == null ? "" : String(receipt.score),
    receipt.samples == null ? "" : String(receipt.samples),
    String(receipt.checkedAtUnixSecs),
    receipt.ts,
  ].join("|");
}

export function signVerificationPayload(
  payload: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function buildVerificationReceipt(
  input: VerificationReceiptInput,
): VerificationReceipt {
  const peerId = shortPeerId(input.peerId);
  const checkedAt = Math.max(0, Math.floor(input.checkedAtUnixSecs));
  const base: Omit<VerificationReceipt, "sig"> = {
    id: verificationReceiptId(
      peerId,
      input.modelId,
      checkedAt,
      input.verdict,
    ),
    peerId,
    modelId: input.modelId,
    verdict: input.verdict,
    agreement: Number.isFinite(input.agreement) ? input.agreement : 0,
    comparedTokens: Math.max(0, Math.floor(input.comparedTokens || 0)),
    mode: input.mode ?? "",
    reason: input.reason ?? null,
    grade: input.grade ?? null,
    score:
      input.score == null || !Number.isFinite(input.score) ? null : input.score,
    samples:
      input.samples == null || !Number.isFinite(input.samples)
        ? null
        : Math.max(0, Math.floor(input.samples)),
    checkedAtUnixSecs: checkedAt,
    ts: (input.now ?? new Date()).toISOString(),
  };
  const secret = receiptSecret();
  const sig = secret
    ? signVerificationPayload(canonicalVerificationPayload(base), secret)
    : null;
  return { ...base, sig };
}

export type AppendVerificationResult = {
  receipt: VerificationReceipt;
  /** False when this audit id was already in the seen set. */
  isNew: boolean;
};

async function cacheGrade(
  peerId: string,
  modelId: string,
  grade: string | null | undefined,
): Promise<void> {
  const redis = getRedis();
  if (!redis || !peerId || !modelId || !grade) return;
  try {
    await redis.hset(`${GRADE_PREFIX}:${peerId}`, { [modelId]: grade });
    await redis.expire(`${GRADE_PREFIX}:${peerId}`, RECEIPTS_TTL_SEC);
  } catch {
    // ignore
  }
}

/**
 * Append one verification receipt. Dedupes by deterministic id so hourly
 * status pulls do not flood the recent list. Never throws.
 */
export async function appendVerificationReceipt(
  input: VerificationReceiptInput,
): Promise<AppendVerificationResult | null> {
  const peerId = shortPeerId(input.peerId);
  if (!peerId || !input.modelId || !input.verdict) return null;
  if (!input.checkedAtUnixSecs || input.checkedAtUnixSecs <= 0) return null;

  const receipt = buildVerificationReceipt({ ...input, peerId });
  const redis = getRedis();
  if (!redis) return { receipt, isNew: true };

  const json = JSON.stringify(receipt);
  const byPeer = `${RECEIPTS_BY_PEER_PREFIX}:${peerId}`;
  const score = receipt.checkedAtUnixSecs || Date.now() / 1000;
  try {
    const added = await redis.sadd(SEEN_IDS_KEY, receipt.id);
    await cacheGrade(peerId, receipt.modelId, receipt.grade);
    if (added === 0) return { receipt, isNew: false };

    await Promise.all([
      redis.lpush(RECEIPTS_RECENT_KEY, json),
      redis.ltrim(RECEIPTS_RECENT_KEY, 0, RECENT_CAP - 1),
      redis.zadd(byPeer, { score, member: json }),
    ]);
    await redis.zremrangebyrank(byPeer, 0, -(PEER_CAP + 1));
    // Bound the seen set (approximate: drop arbitrary members when oversized).
    const seenSize = await redis.scard(SEEN_IDS_KEY);
    if (typeof seenSize === "number" && seenSize > SEEN_CAP) {
      // SPOP is fine — worst case we re-append an old id once.
      await redis.spop(SEEN_IDS_KEY, Math.min(500, seenSize - SEEN_CAP));
    }
    await Promise.all([
      redis.expire(RECEIPTS_RECENT_KEY, RECEIPTS_TTL_SEC),
      redis.expire(byPeer, RECEIPTS_TTL_SEC),
      redis.expire(SEEN_IDS_KEY, RECEIPTS_TTL_SEC),
    ]);
    return { receipt, isNew: true };
  } catch {
    // Bookkeeping must not break cron / chat.
    return { receipt, isNew: false };
  }
}

/** Cached reputation grade for (peer, model), or null if unknown. */
export async function getCachedReputationGrade(
  peerId: string,
  modelId: string,
): Promise<string | null> {
  const redis = getRedis();
  const id = shortPeerId(peerId);
  if (!redis || !id || !modelId) return null;
  try {
    const grade = await redis.hget<string>(`${GRADE_PREFIX}:${id}`, modelId);
    return grade?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Ingest verify + reputation maps from entry status peers.
 * Returns how many *new* receipts were written (best-effort count).
 */
export async function ingestVerificationFromPeers(
  peers: MeshPeerVerifySource[] | null | undefined,
  now: Date = new Date(),
): Promise<{ written: number; seen: number }> {
  let written = 0;
  let seen = 0;
  for (const peer of peers ?? []) {
    const peerId = shortPeerId(peer.id ?? "");
    if (!peerId) continue;
    const repMap = peer.reputation_by_model ?? {};
    for (const [modelId, rep] of Object.entries(repMap)) {
      if (rep?.grade) await cacheGrade(peerId, modelId, rep.grade);
    }
    const verifyMap = peer.verify_by_model;
    if (!verifyMap) continue;
    for (const [modelId, raw] of Object.entries(verifyMap)) {
      if (!raw?.verdict) continue;
      const checkedAt = raw.checked_at_unix_secs ?? 0;
      if (checkedAt <= 0) continue;
      seen += 1;
      const rep = repMap[modelId];
      const result = await appendVerificationReceipt({
        peerId,
        modelId,
        verdict: raw.verdict,
        agreement: raw.agreement ?? 0,
        comparedTokens: raw.compared_tokens ?? 0,
        mode: raw.mode ?? "",
        reason: raw.reason ?? null,
        grade: rep?.grade ?? null,
        score: rep?.score ?? null,
        samples: rep?.samples ?? null,
        checkedAtUnixSecs: checkedAt,
        now,
      });
      if (result?.isNew) written += 1;
    }
  }
  return { written, seen };
}
