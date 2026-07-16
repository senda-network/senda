/**
 * Diagnostic report store — in-memory fallback + Upstash Redis in
 * production. Mirrors the peer-report store pattern
 * (`app/api/peer-report/store.ts`), with a longer TTL because these are
 * low-volume, opt-in "something looked stuck" reports we want to keep
 * around long enough to triage across a few days, not a few minutes.
 *
 * Reports are keyed by a server-assigned random id (not the install id)
 * so one machine can send many reports over time without clobbering its
 * own history.
 */

import { getRedis, kvConfigured } from "../../lib/redis";

/** Scrubbed context the local controller assembles about a stuck state. */
export type DiagnosticReportInput = {
  /** Stable, non-identifying per-install id (see controller-settings). */
  installId: string;
  /** Why the report was sent. */
  trigger: "auto" | "manual";
  /** darwin | win32 | linux */
  os: string;
  /** arm64 | x64 | … */
  arch: string;
  runtimeVersion: string | null;
  desktopVersion: string | null;
  backend: string | null;
  vramGb: number | null;
  /** Size (GB) of the model being loaded; with `vramGb` yields the fit
   * verdict without needing to inspect the machine. */
  modelSizeGb: number | null;
  startupModel: string | null;
  loadedModels: string[];
  /** running | stopped | unknown | unreachable | null */
  serviceState: string | null;
  runtimeReachable: boolean;
  /** The dashboard phase label at send time (client-supplied). */
  phase: string | null;
  /** Runtime auto-upgrade state, when the controller could read it. */
  upgrade: {
    installed: string | null;
    latest: string | null;
    lastOutcome: string | null;
    lastError: string | null;
  } | null;
  /** Scrubbed tail of the runtime stderr log. */
  stderrTail: string;
  /** Optional free-text note (reserved; currently always null). */
  note: string | null;
};

export type StoredDiagnosticReport = DiagnosticReportInput & {
  id: string;
  receivedAtUnix: number;
};

// 30 days — long enough to triage across a work week or two without
// growing unbounded.
export const REPORT_TTL_SEC = 30 * 24 * 60 * 60;
export const MAX_REPORTS = 5000;
export const MAX_REPORT_BYTES = 32 * 1024;

const INDEX_KEY = "diag:index";

function reportKey(id: string): string {
  return `diag:report:${id}`;
}

type GlobalWithStore = typeof globalThis & {
  __sendaDiagnosticStore?: Map<string, StoredDiagnosticReport>;
};

function backingMap(): Map<string, StoredDiagnosticReport> {
  const g = globalThis as GlobalWithStore;
  if (!g.__sendaDiagnosticStore) {
    g.__sendaDiagnosticStore = new Map();
  }
  return g.__sendaDiagnosticStore;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function expireOldMemory(map: Map<string, StoredDiagnosticReport>): void {
  const cutoff = nowUnix() - REPORT_TTL_SEC;
  for (const [k, v] of map.entries()) {
    if (v.receivedAtUnix < cutoff) map.delete(k);
  }
}

function trimToCapMemory(map: Map<string, StoredDiagnosticReport>): void {
  if (map.size <= MAX_REPORTS) return;
  const overflow = map.size - MAX_REPORTS;
  let dropped = 0;
  for (const k of map.keys()) {
    if (dropped >= overflow) break;
    map.delete(k);
    dropped += 1;
  }
}

function putReportMemory(
  report: DiagnosticReportInput,
  id: string,
): StoredDiagnosticReport {
  const map = backingMap();
  expireOldMemory(map);
  const stored: StoredDiagnosticReport = {
    ...report,
    id,
    receivedAtUnix: nowUnix(),
  };
  map.set(id, stored);
  trimToCapMemory(map);
  return stored;
}

function listReportsMemory(): StoredDiagnosticReport[] {
  const map = backingMap();
  expireOldMemory(map);
  return [...map.values()].sort((a, b) => b.receivedAtUnix - a.receivedAtUnix);
}

async function putReportRedis(
  report: DiagnosticReportInput,
  id: string,
): Promise<StoredDiagnosticReport> {
  const redis = getRedis()!;
  const stored: StoredDiagnosticReport = {
    ...report,
    id,
    receivedAtUnix: nowUnix(),
  };
  await redis.set(reportKey(id), stored, { ex: REPORT_TTL_SEC });
  await redis.zadd(INDEX_KEY, { score: stored.receivedAtUnix, member: id });
  const count = await redis.zcard(INDEX_KEY);
  if (count > MAX_REPORTS) {
    await redis.zremrangebyrank(INDEX_KEY, 0, count - MAX_REPORTS - 1);
  }
  const cutoff = nowUnix() - REPORT_TTL_SEC;
  await redis.zremrangebyscore(INDEX_KEY, 0, cutoff);
  return stored;
}

async function listReportsRedis(limit: number): Promise<StoredDiagnosticReport[]> {
  const redis = getRedis()!;
  const cutoff = nowUnix() - REPORT_TTL_SEC;
  await redis.zremrangebyscore(INDEX_KEY, 0, cutoff);
  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, limit - 1, {
    rev: true,
  });
  const out: StoredDiagnosticReport[] = [];
  for (const id of ids ?? []) {
    const row = await redis.get<StoredDiagnosticReport>(reportKey(id));
    if (row) {
      out.push(row);
    } else {
      await redis.zrem(INDEX_KEY, id);
    }
  }
  return out.sort((a, b) => b.receivedAtUnix - a.receivedAtUnix);
}

export function storeBackend(): "redis" | "memory" {
  return kvConfigured() ? "redis" : "memory";
}

export async function putReport(
  report: DiagnosticReportInput,
  id: string,
): Promise<StoredDiagnosticReport> {
  if (kvConfigured()) return putReportRedis(report, id);
  return putReportMemory(report, id);
}

export async function listReports(
  limit = MAX_REPORTS,
): Promise<StoredDiagnosticReport[]> {
  const capped = Math.min(Math.max(1, limit), MAX_REPORTS);
  if (kvConfigured()) return listReportsRedis(capped);
  return listReportsMemory().slice(0, capped);
}

/** Test-only: reset in-memory store. */
export function __resetForTest(): void {
  const g = globalThis as GlobalWithStore;
  g.__sendaDiagnosticStore = new Map();
}
