#!/usr/bin/env node
/**
 * One-off KPI capture → Upstash (KV_REST_* or UPSTASH_* from env).
 * Usage: set -a && source .env.production.local && set +a && node scripts/kpi-capture-once.mjs
 */
import { Redis } from "@upstash/redis";

const FLAGSHIP = process.env.CLOSEDMESH_KPI_FLAGSHIP_MODEL?.trim() || "Qwen3-32B-Q4_K_M";
const STATUS_URL =
  process.env.CLOSEDMESH_KPI_STATUS_URL?.trim() || "https://closedmesh.com/api/status";

function isoWeekLabel(d = new Date()) {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error("Missing KV_REST_API_URL / KV_REST_API_TOKEN");
  process.exit(1);
}

const res = await fetch(STATUS_URL, { cache: "no-store" });
if (!res.ok) throw new Error(`status fetch ${res.status}`);
const status = await res.json();
const nodes = status.nodes ?? [];
const isEntry = (h) => (h ?? "").startsWith("ip-");
const serves = (n) =>
  (n.servingModels ?? []).includes(FLAGSHIP) ||
  (n.capability?.loadedModels ?? []).includes(FLAGSHIP);
const tpsVals = nodes
  .map((n) => n.measuredTpsP50ByModel?.[FLAGSHIP])
  .filter((v) => typeof v === "number" && v > 0);
const ttftVals = nodes
  .map((n) => n.measuredTtftMsP50ByModel?.[FLAGSHIP])
  .filter((v) => typeof v === "number" && v > 0);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const snapshot = {
  captured_at: new Date().toISOString(),
  status_url: STATUS_URL,
  flagship_model: FLAGSHIP,
  online: !!status.online,
  node_count: status.nodeCount ?? 0,
  backends: [...new Set(nodes.map((n) => n.capability?.backend).filter(Boolean))].sort(),
  pooled_vram_gb:
    Math.round(
      nodes.filter((n) => !isEntry(n.hostname)).reduce(
        (sum, n) => sum + (n.capability?.vramGb ?? n.vramGb ?? 0),
        0,
      ) * 10,
    ) / 10,
  models_available: (status.models ?? []).length,
  flagship: {
    contributors: nodes.filter((n) => !isEntry(n.hostname) && serves(n)).length,
    tps_p50_median: median(tpsVals),
    ttft_ms_best: ttftVals.length ? Math.min(...ttftVals) : null,
    tps_sample_count: tpsVals.length,
    ttft_sample_count: ttftVals.length,
  },
};

const redis = new Redis({ url, token });
const hourKey = `kpi:snapshot:${new Date().toISOString().slice(0, 13)}`;
const weekKey = `kpi:week:${isoWeekLabel()}`;
await Promise.all([
  redis.set(hourKey, snapshot, { ex: 90 * 24 * 60 * 60 }),
  redis.set(weekKey, snapshot, { ex: 400 * 24 * 60 * 60 }),
]);

const weekRead = await redis.get(weekKey);
console.log(
  JSON.stringify(
    { ok: true, hourKey, weekKey, verified: !!weekRead, snapshot },
    null,
    2,
  ),
);
