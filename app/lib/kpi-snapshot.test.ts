import { describe, expect, test } from "vitest";
import { buildKpiSnapshot } from "./kpi-snapshot";

describe("buildKpiSnapshot", () => {
  test("aggregates flagship metrics across nodes", () => {
    const snap = buildKpiSnapshot(
      {
        online: true,
        nodeCount: 2,
        models: ["Qwen3-32B-Q4_K_M"],
        nodes: [
          {
            hostname: "mac-a",
            servingModels: ["Qwen3-32B-Q4_K_M"],
            vramGb: 36,
            capability: { backend: "metal", vramGb: 36, loadedModels: [] },
            measuredTpsP50ByModel: { "Qwen3-32B-Q4_K_M": 20 },
            measuredTtftMsP50ByModel: { "Qwen3-32B-Q4_K_M": 900 },
          },
          {
            hostname: "cuda-b",
            servingModels: ["Qwen3-32B-Q4_K_M"],
            vramGb: 24,
            capability: { backend: "cuda", vramGb: 24 },
            measuredTpsP50ByModel: { "Qwen3-32B-Q4_K_M": 16 },
            measuredTtftMsP50ByModel: { "Qwen3-32B-Q4_K_M": 1200 },
          },
        ],
      },
      "Qwen3-32B-Q4_K_M",
      "https://closedmesh.com/api/status",
      new Date("2026-05-19T12:00:00Z"),
    );

    expect(snap.flagship.contributors).toBe(2);
    expect(snap.flagship.tps_p50_median).toBe(18);
    expect(snap.flagship.ttft_ms_best).toBe(900);
    expect(snap.backends).toEqual(["cuda", "metal"]);
    expect(snap.pooled_vram_gb).toBe(60);
  });

  test("excludes entry nodes from contributor count", () => {
    const snap = buildKpiSnapshot(
      {
        online: true,
        nodeCount: 1,
        models: [],
        nodes: [
          {
            hostname: "ip-10-0-0-1",
            servingModels: ["Qwen3-32B-Q4_K_M"],
            capability: { backend: "cpu" },
          },
        ],
      },
      "Qwen3-32B-Q4_K_M",
      "https://mesh.closedmesh.com/api/status",
    );
    expect(snap.flagship.contributors).toBe(0);
  });
});
