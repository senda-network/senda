/**
 * Chat-picker fitness: best-peer TTFT/tok-s from /api/status nodes, plus
 * whether that sits below the interactive (daily-driver) bar.
 *
 * Dialable ≠ pleasant — the picker uses this so capacity hosts at ~1–3 tok/s
 * are labeled and confirmed, not shown as peer equals to a 20 tok/s 8B.
 */

import { modelIdsMatch } from "./model-id";
import { SLA_TARGETS_BY_TIER } from "./model-tiers";
import type { NodeSummary } from "./use-mesh-status";

export type ModelPickerMetrics = {
  bestTps: number | null;
  bestTtftMs: number | null;
  /** True when we have at least one positive TPS or TTFT sample. */
  hasSamples: boolean;
  /**
   * True when samples exist and fail the daily-driver interactive bar
   * (8 tok/s, 3s TTFT). Capacity models often land here on purpose.
   */
  belowInteractiveBar: boolean;
};

const INTERACTIVE = SLA_TARGETS_BY_TIER.daily_driver;

function lookupMetric(
  map: Record<string, number> | undefined,
  modelId: string,
): number | null {
  if (!map) return null;
  const direct = map[modelId];
  if (typeof direct === "number" && direct > 0) return direct;
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "number" && value > 0 && modelIdsMatch(key, modelId)) {
      return value;
    }
  }
  return null;
}

function peerListsModel(node: NodeSummary, modelId: string): boolean {
  const ids = [
    ...(node.servingModels ?? []),
    ...(node.capability?.loadedModels ?? []),
  ];
  return ids.some((id) => modelIdsMatch(id, modelId));
}

/** Entry can proxy to this peer (self or finite RTT). */
function peerIsDialable(node: NodeSummary): boolean {
  if (node.isSelf) return true;
  return typeof node.rttMs === "number" && Number.isFinite(node.rttMs);
}

/**
 * Best (highest TPS, lowest TTFT) across dialable peers that list the model.
 */
export function bestPeerMetrics(
  modelId: string,
  nodes: NodeSummary[],
): ModelPickerMetrics {
  let bestTps: number | null = null;
  let bestTtftMs: number | null = null;

  for (const node of nodes) {
    if (!peerIsDialable(node)) continue;
    if (!peerListsModel(node, modelId)) continue;
    // Skip peers that aren't actually serving yet (loading / standby).
    if (node.state && node.state !== "serving" && !node.isSelf) continue;

    const tps = lookupMetric(node.measuredTpsP50ByModel, modelId);
    const ttft = lookupMetric(node.measuredTtftMsP50ByModel, modelId);
    if (tps != null && (bestTps === null || tps > bestTps)) bestTps = tps;
    if (ttft != null && (bestTtftMs === null || ttft < bestTtftMs)) {
      bestTtftMs = ttft;
    }
  }

  const hasSamples = bestTps != null || bestTtftMs != null;
  const tpsFail = bestTps != null && bestTps < INTERACTIVE.target_tps_p50;
  const ttftFail =
    bestTtftMs != null && bestTtftMs > INTERACTIVE.target_ttft_ms_p50;
  const belowInteractiveBar = hasSamples && (tpsFail || ttftFail);

  return { bestTps, bestTtftMs, hasSamples, belowInteractiveBar };
}

export function formatPickerTps(tps: number | null): string {
  if (tps == null) return "— tok/s";
  if (tps < 10) return `${tps.toFixed(1)} tok/s`;
  return `${Math.round(tps)} tok/s`;
}

export function formatPickerTtft(ms: number | null): string {
  if (ms == null) return "— TTFT";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s TTFT`;
  return `${Math.round(ms)}ms TTFT`;
}
