/**
 * Mesh KPI snapshot — aggregates for weekly reports and historical trends.
 * Built from the public `/api/status` shape (NodeSummary list).
 */

export type KpiSnapshot = {
  captured_at: string;
  status_url: string;
  flagship_model: string;
  online: boolean;
  node_count: number;
  backends: string[];
  pooled_vram_gb: number;
  models_available: number;
  flagship: {
    contributors: number;
    tps_p50_median: number | null;
    ttft_ms_best: number | null;
    tps_sample_count: number;
    ttft_sample_count: number;
  };
};

export type KpiStatusNode = {
  hostname?: string | null;
  servingModels: string[];
  vramGb?: number;
  capability?: {
    backend?: string;
    vramGb?: number;
    loadedModels?: string[];
  };
  measuredTpsP50ByModel?: Record<string, number>;
  measuredTtftMsP50ByModel?: Record<string, number>;
};

export type KpiStatusInput = {
  online: boolean;
  nodeCount: number;
  models: string[];
  nodes: KpiStatusNode[];
};

const ENTRY_HOST_PREFIX = "ip-";

function isEntryHostname(hostname: string | null | undefined): boolean {
  return (hostname ?? "").startsWith(ENTRY_HOST_PREFIX);
}

function servesModel(node: KpiStatusNode, model: string): boolean {
  const loaded = node.capability?.loadedModels ?? [];
  return node.servingModels.includes(model) || loaded.includes(model);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function isoWeekLabel(d = new Date()): string {
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** ISO week label for seven days before `d` (week-over-week compare). */
export function previousIsoWeekLabel(d = new Date()): string {
  const prior = new Date(d.getTime() - 7 * 86_400_000);
  return isoWeekLabel(prior);
}

export function hourKey(d = new Date()): string {
  return d.toISOString().slice(0, 13);
}

export function buildKpiSnapshot(
  status: KpiStatusInput,
  flagshipModel: string,
  statusUrl: string,
  capturedAt = new Date(),
): KpiSnapshot {
  const contributors = status.nodes.filter(
    (n) => !isEntryHostname(n.hostname) && servesModel(n, flagshipModel),
  );

  const tpsVals = status.nodes
    .map((n) => n.measuredTpsP50ByModel?.[flagshipModel])
    .filter((v): v is number => typeof v === "number" && v > 0);

  const ttftVals = status.nodes
    .map((n) => n.measuredTtftMsP50ByModel?.[flagshipModel])
    .filter((v): v is number => typeof v === "number" && v > 0);

  const backends = [
    ...new Set(
      status.nodes
        .map((n) => n.capability?.backend)
        .filter((b): b is string => !!b),
    ),
  ].sort();

  const pooledVramGb = status.nodes
    .filter((n) => !isEntryHostname(n.hostname))
    .reduce(
      (sum, n) => sum + (n.capability?.vramGb ?? n.vramGb ?? 0),
      0,
    );

  return {
    captured_at: capturedAt.toISOString(),
    status_url: statusUrl,
    flagship_model: flagshipModel,
    online: status.online,
    node_count: status.nodeCount,
    backends,
    pooled_vram_gb: Math.round(pooledVramGb * 10) / 10,
    models_available: status.models.length,
    flagship: {
      contributors: contributors.length,
      tps_p50_median: median(tpsVals),
      ttft_ms_best: ttftVals.length > 0 ? Math.min(...ttftVals) : null,
      tps_sample_count: tpsVals.length,
      ttft_sample_count: ttftVals.length,
    },
  };
}

/** Redis keys for KPI history. */
export const KPI_HOUR_PREFIX = "kpi:snapshot:";
export const KPI_WEEK_PREFIX = "kpi:week:";

export const KPI_HOUR_TTL_SEC = 90 * 24 * 60 * 60;
export const KPI_WEEK_TTL_SEC = 400 * 24 * 60 * 60;

export function kpiHourKey(at = new Date()): string {
  return `${KPI_HOUR_PREFIX}${hourKey(at)}`;
}

export function kpiWeekKey(at = new Date()): string {
  return `${KPI_WEEK_PREFIX}${isoWeekLabel(at)}`;
}
