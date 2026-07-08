import { describe, expect, test } from "vitest";
import {
  buildKpiSnapshot,
  mergeWeekSnapshots,
  meshRuntimeToKpiInput,
  pickFlagshipModel,
  snapshotFromMilestone,
  snapshotQuality,
  KNOWN_MILESTONES,
} from "./kpi-snapshot";

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
      "https://entry.senda.network/api/status",
      new Date("2026-05-19T12:00:00Z"),
      ["Qwen3-32B-Q4_K_M"],
    );

    expect(snap.flagship.contributors).toBe(2);
    expect(snap.flagship.tps_p50_median).toBe(18);
    expect(snap.flagship.ttft_ms_best).toBe(900);
    expect(snap.backends).toEqual(["cuda", "metal"]);
    expect(snap.pooled_vram_gb).toBe(60);
    expect(snap.routable_models).toEqual(["Qwen3-32B-Q4_K_M"]);
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
      "https://entry.senda.network/api/status",
    );
    expect(snap.flagship.contributors).toBe(0);
  });
});

describe("meshRuntimeToKpiInput", () => {
  test("maps mesh peers including requested models for split workers", () => {
    const input = meshRuntimeToKpiInput({
      peers: [
        {
          hostname: "LYU",
          role: "Host",
          state: "serving",
          vram_gb: 17.2,
          hosted_models: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
          serving_models: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
          capability: { backend: "cuda", loaded_models: ["DeepSeek-R1-Distill-70B-Q4_K_M"] },
        },
        {
          hostname: "f5aa2ca5aad2",
          role: "Worker",
          state: "loading",
          vram_gb: 12,
          requested_models: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
          capability: { backend: "cuda" },
        },
      ],
    });
    expect(input.nodeCount).toBe(2);
    const snap = buildKpiSnapshot(
      input,
      "DeepSeek-R1-Distill-70B-Q4_K_M",
      "https://entry.senda.network/api/status",
      new Date(),
      ["DeepSeek-R1-Distill-70B-Q4_K_M"],
    );
    expect(snap.flagship.contributors).toBe(2);
    expect(snap.pooled_vram_gb).toBeCloseTo(29.2, 1);
  });
});

describe("mergeWeekSnapshots", () => {
  test("empty offline capture does not erase a peak week", () => {
    const peak = buildKpiSnapshot(
      {
        online: true,
        nodeCount: 5,
        models: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
        nodes: [
          {
            hostname: "LYU",
            servingModels: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
            vramGb: 66,
            capability: { backend: "cuda", vramGb: 66 },
          },
        ],
      },
      "DeepSeek-R1-Distill-70B-Q4_K_M",
      "https://entry.senda.network/api/status",
      new Date("2026-05-23T23:49:00Z"),
      ["DeepSeek-R1-Distill-70B-Q4_K_M"],
    );
    const empty = buildKpiSnapshot(
      { online: false, nodeCount: 0, models: [], nodes: [] },
      "DeepSeek-R1-Distill-70B-Q4_K_M",
      "https://entry.senda.network/api/status",
      new Date("2026-05-24T06:00:00Z"),
    );
    const merged = mergeWeekSnapshots(peak, empty);
    expect(merged.node_count).toBe(5);
    expect(merged.models_available).toBe(1);
  });
});

describe("pickFlagshipModel", () => {
  test("prefers routable models over default", () => {
    expect(
      pickFlagshipModel([], ["DeepSeek-R1-Distill-70B-Q4_K_M"], null, null),
    ).toBe("DeepSeek-R1-Distill-70B-Q4_K_M");
  });
});

describe("snapshotFromMilestone", () => {
  test("backfills DeepSeek serve peak from known milestone", () => {
    const snap = snapshotFromMilestone(KNOWN_MILESTONES[0]!);
    expect(snap.node_count).toBe(5);
    expect(snap.pooled_vram_gb).toBe(66);
    expect(snap.routable_models).toContain("DeepSeek-R1-Distill-70B-Q4_K_M");
    expect(snapshotQuality(snap)).toBeGreaterThan(5_000);
  });
});
