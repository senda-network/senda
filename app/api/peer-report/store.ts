/**
 * Peer audit report store — in-memory fallback + Upstash Redis in production.
 *
 * See original docblock in git history; Redis backing fixes multi-instance
 * Vercel lambdas and survives cold starts (reports still TTL at 5 min).
 */

import { getRedis, kvConfigured } from "../../lib/redis";

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
  receivedAtUnix: number;
};

export const REPORT_TTL_SEC = 5 * 60;
export const MAX_REPORTS = 1024;
export const MAX_REPORT_BYTES = 8 * 1024;

const INDEX_KEY = "peer-report:index";

function reportKey(nodeId: string): string {
  return `peer-report:${nodeId}`;
}

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

function expireOldMemory(map: Map<string, StoredPeerReport>): void {
  const cutoff = nowUnix() - REPORT_TTL_SEC;
  for (const [k, v] of map.entries()) {
    if (v.receivedAtUnix < cutoff) map.delete(k);
  }
}

function trimToCapMemory(map: Map<string, StoredPeerReport>): void {
  if (map.size <= MAX_REPORTS) return;
  const overflow = map.size - MAX_REPORTS;
  let dropped = 0;
  for (const k of map.keys()) {
    if (dropped >= overflow) break;
    map.delete(k);
    dropped += 1;
  }
}

function putReportMemory(report: PeerReportInput): StoredPeerReport {
  const map = backingMap();
  expireOldMemory(map);
  const stored: StoredPeerReport = { ...report, receivedAtUnix: nowUnix() };
  map.delete(report.nodeId);
  map.set(report.nodeId, stored);
  trimToCapMemory(map);
  return stored;
}

function listReportsMemory(): StoredPeerReport[] {
  const map = backingMap();
  expireOldMemory(map);
  return [...map.values()].sort(
    (a, b) => b.receivedAtUnix - a.receivedAtUnix,
  );
}

function getReportMemory(nodeId: string): StoredPeerReport | null {
  const map = backingMap();
  expireOldMemory(map);
  return map.get(nodeId) ?? null;
}

async function putReportRedis(
  report: PeerReportInput,
): Promise<StoredPeerReport> {
  const redis = getRedis()!;
  const stored: StoredPeerReport = { ...report, receivedAtUnix: nowUnix() };
  await redis.set(reportKey(report.nodeId), stored, { ex: REPORT_TTL_SEC });
  await redis.zadd(INDEX_KEY, {
    score: stored.receivedAtUnix,
    member: report.nodeId,
  });
  const count = await redis.zcard(INDEX_KEY);
  if (count > MAX_REPORTS) {
    await redis.zremrangebyrank(INDEX_KEY, 0, count - MAX_REPORTS - 1);
  }
  const cutoff = nowUnix() - REPORT_TTL_SEC;
  await redis.zremrangebyscore(INDEX_KEY, 0, cutoff);
  return stored;
}

async function listReportsRedis(): Promise<StoredPeerReport[]> {
  const redis = getRedis()!;
  const cutoff = nowUnix() - REPORT_TTL_SEC;
  await redis.zremrangebyscore(INDEX_KEY, 0, cutoff);
  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, MAX_REPORTS - 1, {
    rev: true,
  });
  const out: StoredPeerReport[] = [];
  for (const id of ids ?? []) {
    const row = await redis.get<StoredPeerReport>(reportKey(id));
    if (row) {
      out.push(row);
    } else {
      await redis.zrem(INDEX_KEY, id);
    }
  }
  return out.sort((a, b) => b.receivedAtUnix - a.receivedAtUnix);
}

async function getReportRedis(nodeId: string): Promise<StoredPeerReport | null> {
  const redis = getRedis()!;
  const row = await redis.get<StoredPeerReport>(reportKey(nodeId));
  if (!row) return null;
  if (row.receivedAtUnix < nowUnix() - REPORT_TTL_SEC) {
    await redis.del(reportKey(nodeId));
    await redis.zrem(INDEX_KEY, nodeId);
    return null;
  }
  return row;
}

export function storeBackend(): "redis" | "memory" {
  return kvConfigured() ? "redis" : "memory";
}

export async function putReport(
  report: PeerReportInput,
): Promise<StoredPeerReport> {
  if (kvConfigured()) return putReportRedis(report);
  return putReportMemory(report);
}

export async function listReports(): Promise<StoredPeerReport[]> {
  if (kvConfigured()) return listReportsRedis();
  return listReportsMemory();
}

export async function getReport(
  nodeId: string,
): Promise<StoredPeerReport | null> {
  if (kvConfigured()) return getReportRedis(nodeId);
  return getReportMemory(nodeId);
}

/** Test-only: reset in-memory store (Redis tests are not run in CI). */
export function __resetForTest(): void {
  const g = globalThis as GlobalWithStore;
  g.__closedmeshPeerReportStore = new Map();
}
