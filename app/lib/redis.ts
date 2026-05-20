import { Redis } from "@upstash/redis";

type GlobalRedis = typeof globalThis & {
  __closedmeshRedis?: Redis | null;
};

/**
 * Upstash Redis client for production persistence (peer reports, KPI snapshots).
 *
 * Supports Vercel's Upstash integration env vars and legacy KV_* names.
 * When unset, callers fall back to in-memory stores (local dev + unit tests).
 */
export function kvConfigured(): boolean {
  // Unit tests must stay in-memory — dev .env.local often has KV_* set.
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return false;
  }
  return !!(restUrl() && restToken());
}

function restUrl(): string | undefined {
  const raw =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  return raw || undefined;
}

function restToken(): string | undefined {
  const raw =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();
  return raw || undefined;
}

export function getRedis(): Redis | null {
  if (!kvConfigured()) return null;
  const g = globalThis as GlobalRedis;
  if (g.__closedmeshRedis === undefined) {
    g.__closedmeshRedis = new Redis({
      url: restUrl()!,
      token: restToken()!,
    });
  }
  return g.__closedmeshRedis;
}
