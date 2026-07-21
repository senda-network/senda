import { describe, expect, it } from "vitest";
import { bestPeerMetrics } from "./model-picker-fitness";
import type { NodeSummary } from "./use-mesh-status";

function node( partial: Partial<NodeSummary> & { hostname: string } ): NodeSummary {
  return {
    id: partial.id ?? partial.hostname,
    hostname: partial.hostname,
    isSelf: partial.isSelf ?? false,
    role: partial.role ?? "host",
    state: partial.state ?? "serving",
    vramGb: partial.vramGb ?? 24,
    servingModels: partial.servingModels ?? [],
    capability: partial.capability ?? {
      backend: "metal",
      vendor: "apple",
      computeClass: "gpu",
      vramGb: 24,
      loadedModels: partial.servingModels ?? [],
    },
    version: null,
    splitRole: null,
    splitGroup: null,
    moeShard: null,
    meshVisibility: null,
    measuredTpsP50ByModel: partial.measuredTpsP50ByModel,
    measuredTtftMsP50ByModel: partial.measuredTtftMsP50ByModel,
    rttMs: partial.rttMs,
  };
}

describe("bestPeerMetrics", () => {
  it("picks best TPS / TTFT across dialable serving peers", () => {
    const nodes = [
      node({
        hostname: "slow",
        rttMs: 140,
        servingModels: ["google_gemma-3-27b-it-Q4_K_M"],
        measuredTpsP50ByModel: { "google_gemma-3-27b-it-Q4_K_M": 3.2 },
        measuredTtftMsP50ByModel: { "google_gemma-3-27b-it-Q4_K_M": 3700 },
      }),
      node({
        hostname: "fast",
        rttMs: 120,
        servingModels: ["Qwen3-8B-Q4_K_M"],
        measuredTpsP50ByModel: { "Qwen3-8B-Q4_K_M": 22 },
        measuredTtftMsP50ByModel: { "Qwen3-8B-Q4_K_M": 900 },
      }),
    ];

    const gemma = bestPeerMetrics("Gemma-3-27B-it-Q4_K_M", nodes);
    expect(gemma.bestTps).toBeCloseTo(3.2);
    expect(gemma.bestTtftMs).toBe(3700);
    expect(gemma.belowInteractiveBar).toBe(true);

    const qwen = bestPeerMetrics("Qwen3-8B-Q4_K_M", nodes);
    expect(qwen.bestTps).toBe(22);
    expect(qwen.belowInteractiveBar).toBe(false);
  });

  it("ignores undialable and non-serving peers", () => {
    const nodes = [
      node({
        hostname: "ghost",
        rttMs: null,
        servingModels: ["Qwen3-8B-Q4_K_M"],
        measuredTpsP50ByModel: { "Qwen3-8B-Q4_K_M": 50 },
        measuredTtftMsP50ByModel: { "Qwen3-8B-Q4_K_M": 200 },
      }),
      node({
        hostname: "loading",
        rttMs: 100,
        state: "loading",
        servingModels: ["Qwen3-8B-Q4_K_M"],
        measuredTpsP50ByModel: { "Qwen3-8B-Q4_K_M": 40 },
        measuredTtftMsP50ByModel: { "Qwen3-8B-Q4_K_M": 300 },
      }),
    ];
    const m = bestPeerMetrics("Qwen3-8B-Q4_K_M", nodes);
    expect(m.hasSamples).toBe(false);
    expect(m.belowInteractiveBar).toBe(false);
  });
});
