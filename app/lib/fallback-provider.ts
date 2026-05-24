/**
 * Phase 4.C — protocol-subsidized fallback provider.
 *
 * When the per-model SLA gate (`routing-sla.ts`) reports that the
 * mesh cannot meet the daily-driver tier's latency budget for the
 * requested model, the chat route delegates to an external,
 * OpenAI-compatible provider so the user always gets a working
 * answer. Today the only concrete provider is OpenRouter; the
 * factory pattern leaves room to swap or chain providers later.
 *
 * Three guards constrain when fallback fires — together they
 * implement the "fallback exists, but it cannot become a free
 * OpenRouter proxy" guarantee from the strategy doc:
 *
 *   1. **Tier allowlist.** Only daily-driver tier models route to
 *      fallback. Requesting a capacity-tier model that misses SLA
 *      stays on the mesh (the user opted into "slow but mesh-served"
 *      by picking that model).
 *   2. **Mapping required.** Fallback fires only when the requested
 *      mesh model has a concrete external equivalent in
 *      `FALLBACK_MODEL_MAP`. Unknown models stay on the mesh.
 *   3. **Per-IP per-hour budget.** Hard cap on fallback requests per
 *      client IP (default 20/hour, override via env). Enforced
 *      separately in `consumeFallbackBudget` against Redis.
 *
 * The provider activates only when `OPENROUTER_API_KEY` is set in
 * the environment. Without it, `fallbackProviderReady` returns
 * false and the chat route stays on its current mesh-only path,
 * which means we can ship the code path before provisioning the
 * key and flip it on by setting the env var.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getModelTier } from "./model-tiers";
import { getRedis } from "./redis";
import { normalizeModelId } from "./model-id";
import type { SlaEvaluation } from "./routing-sla";

/**
 * Hand-maintained map from our canonical mesh model ids to OpenRouter
 * model slugs. Daily-driver tier only.
 *
 * The matching uses `normalizeModelId` so quant suffixes and casing
 * are tolerated — `qwen3-8b-q4_k_m.gguf` resolves to the same key
 * as `Qwen3-8B-Q4_K_M`.
 *
 * Slugs targeted at 2026-05-24; if OpenRouter renames them this
 * table is the only place we need to update.
 */
const FALLBACK_MODEL_MAP: Record<string, string> = {
  "Qwen3-8B-Q4_K_M": "qwen/qwen3-8b",
  "Llama-3.1-8B-Instruct-Q4_K_M": "meta-llama/llama-3.1-8b-instruct",
  "Qwen2.5-Coder-7B-Instruct-Q4_K_M": "qwen/qwen-2.5-coder-7b-instruct",
  "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M": "deepseek/deepseek-r1-distill-qwen-14b",
  "Llama-3.2-3B-Instruct-Q4_K_M": "meta-llama/llama-3.2-3b-instruct",
};

const NORMALIZED_FALLBACK_MAP: Map<string, string> = new Map(
  Object.entries(FALLBACK_MODEL_MAP).map(([id, slug]) => [
    normalizeModelId(id),
    slug,
  ]),
);

/** Resolve a mesh model id to its OpenRouter slug, or null. */
export function mapModelIdForFallback(modelId: string): string | null {
  return NORMALIZED_FALLBACK_MAP.get(normalizeModelId(modelId)) ?? null;
}

export function fallbackKeyConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY?.trim();
}

/**
 * True when both the key is configured AND we have an external
 * mapping for the requested model. Distinguishes "fallback not
 * provisioned" from "fallback exists but doesn't cover this model".
 */
export function fallbackAvailableFor(modelId: string): boolean {
  if (!fallbackKeyConfigured()) return false;
  return mapModelIdForFallback(modelId) !== null;
}

/**
 * Why a request did (or did not) get routed to fallback. Surfaced
 * as the value of the `x-closedmesh-fallback-status` response
 * header so we can debug routing decisions without server logs.
 */
export type FallbackVerdict =
  | "mesh-meets-sla"
  | "fallback-disabled"
  | "fallback-no-mapping"
  | "fallback-wrong-tier"
  | "fallback-rate-limited"
  | "fallback-fired";

export type FallbackDecision = {
  /** True iff the chat route should send the request to the fallback provider. */
  useFallback: boolean;
  verdict: FallbackVerdict;
  /** Resolved OpenRouter slug when `useFallback`; null otherwise. */
  fallbackModelSlug: string | null;
};

/**
 * Pure decision function. Does NOT consume the rate-limit budget —
 * that's a separate Redis-touching call. This lets us test the
 * decision matrix without mocking Redis.
 *
 * Decision precedence:
 *  1. If the SLA gate passes, mesh wins. No fallback.
 *  2. If the requested model is not daily-driver tier, mesh wins
 *     (capacity tier opts into "slow but mesh-served"; we don't
 *     burn fallback dollars on 70B-class).
 *  3. If we have no fallback key or no model mapping, mesh wins.
 *  4. Otherwise fallback wins (subject to the budget check the
 *     route makes against `consumeFallbackBudget`).
 */
export function decideFallback(
  modelId: string,
  sla: SlaEvaluation,
): FallbackDecision {
  if (sla.meetsSla) {
    return {
      useFallback: false,
      verdict: "mesh-meets-sla",
      fallbackModelSlug: null,
    };
  }
  if (getModelTier(modelId) !== "daily_driver") {
    return {
      useFallback: false,
      verdict: "fallback-wrong-tier",
      fallbackModelSlug: null,
    };
  }
  const slug = mapModelIdForFallback(modelId);
  if (!slug) {
    return {
      useFallback: false,
      verdict: "fallback-no-mapping",
      fallbackModelSlug: null,
    };
  }
  if (!fallbackKeyConfigured()) {
    return {
      useFallback: false,
      verdict: "fallback-disabled",
      fallbackModelSlug: null,
    };
  }
  return {
    useFallback: true,
    verdict: "fallback-fired",
    fallbackModelSlug: slug,
  };
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

type OpenRouterProvider = ReturnType<typeof createOpenAICompatible>;

let cachedProvider: OpenRouterProvider | null = null;

export function getOpenRouterProvider(): OpenRouterProvider | null {
  if (!fallbackKeyConfigured()) return null;
  if (cachedProvider) return cachedProvider;
  cachedProvider = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY!.trim(),
    includeUsage: true,
    headers: {
      "HTTP-Referer": "https://closedmesh.com",
      "X-Title": "ClosedMesh",
    },
  });
  return cachedProvider;
}

// ---------------------------------------------------------------------------
// Per-IP per-hour budget
// ---------------------------------------------------------------------------

function fallbackHourlyBudget(): number {
  const raw = process.env.CLOSEDMESH_FALLBACK_HOURLY_BUDGET?.trim();
  if (!raw) return 20;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 20;
  return parsed;
}

function currentHourBucket(at = new Date()): string {
  return `${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, "0")}${String(at.getUTCDate()).padStart(2, "0")}T${String(at.getUTCHours()).padStart(2, "0")}`;
}

function budgetKey(clientIp: string, hour = currentHourBucket()): string {
  return `closedmesh:fallback:budget:${clientIp}:${hour}`;
}

export type BudgetResult =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: "rate-limited"; remaining: 0 };

/**
 * Atomically increment the per-IP per-hour counter and return
 * whether the call is within budget. When Redis isn't configured
 * (local dev, tests) the call is always allowed — production sets
 * `kvConfigured()`, dev doesn't.
 *
 * Hard cap defaults to 20/hour/IP; override via
 * `CLOSEDMESH_FALLBACK_HOURLY_BUDGET`.
 */
export async function consumeFallbackBudget(
  clientIp: string,
): Promise<BudgetResult> {
  const redis = getRedis();
  const budget = fallbackHourlyBudget();
  if (!redis) {
    return { allowed: true, remaining: budget };
  }
  const key = budgetKey(clientIp);
  const count = await redis.incr(key);
  if (count === 1) {
    // Bucket expires at the end of the hour + a small buffer so the
    // counter doesn't survive into the next clock hour.
    await redis.expire(key, 3700);
  }
  if (count > budget) {
    return { allowed: false, reason: "rate-limited", remaining: 0 };
  }
  return { allowed: true, remaining: Math.max(0, budget - count) };
}

/** Test-only escape hatch so unit tests can reset the provider cache. */
export function __resetFallbackProviderCacheForTests(): void {
  cachedProvider = null;
}
