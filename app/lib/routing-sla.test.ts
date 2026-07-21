import { describe, expect, it } from "vitest";
import { evaluateSla, type SlaPeer } from "./routing-sla";

function peer(overrides: Partial<SlaPeer>): SlaPeer {
  return {
    id: "test-peer",
    hostname: "test",
    state: "serving",
    serving_models: [],
    hosted_models: [],
    measured_tps_p50_by_model: {},
    measured_ttft_ms_p50_by_model: {},
    capability: { loaded_models: [] },
    ...overrides,
  };
}

describe("evaluateSla — daily-driver tier (TTFT <= 3000 ms, TPS >= 8)", () => {
  const model = "Qwen3-8B-Q4_K_M";

  it("returns no-peer-with-model when nobody hosts the model", () => {
    const result = evaluateSla(model, [
      peer({ hosted_models: ["Llama-3.1-8B-Instruct-Q4_K_M"] }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("no-peer-with-model");
    expect(result.candidatePeerCount).toBe(0);
    expect(result.tier).toBe("daily_driver");
  });

  it("returns no-measurements when host exists but hasn't reported timings", () => {
    const result = evaluateSla(model, [
      peer({ hosted_models: [model] }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("no-measurements");
    expect(result.candidatePeerCount).toBe(1);
    expect(result.bestPeerTtftMs).toBeNull();
    expect(result.bestPeerTps).toBeNull();
  });

  it("passes when a single peer meets both thresholds", () => {
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 14 },
        measured_ttft_ms_p50_by_model: { [model]: 1_800 },
      }),
    ]);
    expect(result.meetsSla).toBe(true);
    expect(result.reason).toBe("meets-sla");
    expect(result.bestPeerTtftMs).toBe(1_800);
    expect(result.bestPeerTps).toBe(14);
  });

  it("flags ttft-too-high when TPS passes but TTFT fails", () => {
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 12 },
        measured_ttft_ms_p50_by_model: { [model]: 5_000 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("ttft-too-high");
    expect(result.bestPeerTtftMs).toBe(5_000);
    expect(result.bestPeerTps).toBe(12);
  });

  it("flags tps-too-low when TTFT passes but TPS fails", () => {
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 2.5 },
        measured_ttft_ms_p50_by_model: { [model]: 2_500 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("tps-too-low");
  });

  it("flags both-too-low when both thresholds fail", () => {
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 1.0 },
        measured_ttft_ms_p50_by_model: { [model]: 9_700 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("both-too-low");
  });

  it("passes when at least one of many peers meets SLA", () => {
    const result = evaluateSla(model, [
      peer({
        id: "slow",
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 3 },
        measured_ttft_ms_p50_by_model: { [model]: 4_000 },
      }),
      peer({
        id: "fast",
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 20 },
        measured_ttft_ms_p50_by_model: { [model]: 1_200 },
      }),
    ]);
    expect(result.meetsSla).toBe(true);
    expect(result.candidatePeerCount).toBe(2);
  });

  it("ignores peers in unusable states", () => {
    const result = evaluateSla(model, [
      peer({
        state: "loading",
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 30 },
        measured_ttft_ms_p50_by_model: { [model]: 1_000 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("no-peer-with-model");
  });

  it("treats capability.loaded_models as a host signal alongside hosted_models", () => {
    const result = evaluateSla(model, [
      peer({
        hosted_models: [],
        capability: { loaded_models: [model] },
        measured_tps_p50_by_model: { [model]: 10 },
        measured_ttft_ms_p50_by_model: { [model]: 2_500 },
      }),
    ]);
    expect(result.meetsSla).toBe(true);
  });
});

describe("evaluateSla — through-mesh / native ratio floor (daily-driver >= 0.6)", () => {
  const model = "Qwen3-8B-Q4_K_M";

  it("does NOT enforce the floor when the peer reports no native baseline", () => {
    // No native_tps_p50_by_model → ratio uncomputable. A peer must never
    // be demoted for data it can't report (pooled split / legacy peer).
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 14 },
        measured_ttft_ms_p50_by_model: { [model]: 1_800 },
      }),
    ]);
    expect(result.meetsSla).toBe(true);
    expect(result.reason).toBe("meets-sla");
    expect(result.bestPeerNativeRatio).toBeNull();
  });

  it("passes and reports the ratio when through-mesh tracks native", () => {
    // 14 through-mesh / 15 native = 0.93, well above the 0.6 floor — the
    // ~1.0 solo-serve case where through-mesh ≈ native by construction.
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 14 },
        measured_ttft_ms_p50_by_model: { [model]: 1_800 },
        native_tps_p50_by_model: { [model]: 15 },
      }),
    ]);
    expect(result.meetsSla).toBe(true);
    expect(result.reason).toBe("meets-sla");
    expect(result.bestPeerNativeRatio).toBeCloseTo(14 / 15, 5);
  });

  it("demotes an absolutely-fast peer that has degraded below its native floor", () => {
    // 9 through-mesh clears the absolute 8 tok/s bar, but the peer's own
    // native baseline is 30 tok/s → ratio 0.3 < 0.6. The decode has
    // collapsed relative to proven capability (saturation/throttling),
    // so the entry should route around it.
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 9 },
        measured_ttft_ms_p50_by_model: { [model]: 2_000 },
        native_tps_p50_by_model: { [model]: 30 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("below-native-ratio");
    expect(result.bestPeerNativeRatio).toBeCloseTo(0.3, 5);
  });

  it("prefers an absolute-threshold reason over the ratio reason", () => {
    // This peer fails the absolute TPS bar (2.5 < 8) AND the ratio
    // (2.5/30). The more fundamental absolute miss must win.
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 2.5 },
        measured_ttft_ms_p50_by_model: { [model]: 2_000 },
        native_tps_p50_by_model: { [model]: 30 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("tps-too-low");
  });

  it("routes to a healthy peer even when another has degraded below the floor", () => {
    const result = evaluateSla(model, [
      peer({
        id: "degraded",
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 9 },
        measured_ttft_ms_p50_by_model: { [model]: 2_000 },
        native_tps_p50_by_model: { [model]: 30 },
      }),
      peer({
        id: "healthy",
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 28 },
        measured_ttft_ms_p50_by_model: { [model]: 1_200 },
        native_tps_p50_by_model: { [model]: 30 },
      }),
    ]);
    expect(result.meetsSla).toBe(true);
    expect(result.reason).toBe("meets-sla");
    expect(result.creditPeerId).toBe("healthy");
    expect(result.bestPeerNativeRatio).toBeCloseTo(28 / 30, 5);
  });

  it("does not enforce the floor on the experimental tier (floor = 0)", () => {
    // Experimental tier sets min_native_ratio = 0, so even a heavily
    // degraded ratio passes as long as the (very lenient) absolute
    // thresholds are met.
    const experimental = "Qwen3-0.6B-Q4_K_M";
    const result = evaluateSla(experimental, [
      peer({
        hosted_models: [experimental],
        measured_tps_p50_by_model: { [experimental]: 1 },
        measured_ttft_ms_p50_by_model: { [experimental]: 5_000 },
        native_tps_p50_by_model: { [experimental]: 100 },
      }),
    ]);
    expect(result.meetsSla).toBe(true);
    expect(result.reason).toBe("meets-sla");
  });
});

describe("evaluateSla — capacity tier (TTFT <= 15000 ms, TPS >= 0.8)", () => {
  const model = "DeepSeek-R1-Distill-70B-Q4_K_M";

  it("classifies the model as capacity tier", () => {
    const result = evaluateSla(model, [
      peer({ hosted_models: [model] }),
    ]);
    expect(result.tier).toBe("capacity");
  });

  it("passes for the measured DeepSeek-70B run (TTFT 9.7 s, 1.0 tok/s)", () => {
    // Numbers come straight from the May 24 milestone capture.
    // Capacity tier is permissive enough that the actual measured
    // production behaviour clears the gate — we want this row routable
    // as a proof-of-capacity demo, not blackholed.
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 1.0 },
        measured_ttft_ms_p50_by_model: { [model]: 9_700 },
      }),
    ]);
    expect(result.meetsSla).toBe(true);
    expect(result.reason).toBe("meets-sla");
  });

  it("would fail the same measurements at daily-driver tier", () => {
    // Sanity: the same numbers under the daily-driver tier MUST miss.
    // This is the load-bearing test for the reframe — capacity tier
    // is the only tier under which a 1.0 tok/s response is acceptable.
    const dailyDriverModel = "Qwen3-8B-Q4_K_M";
    const result = evaluateSla(dailyDriverModel, [
      peer({
        hosted_models: [dailyDriverModel],
        measured_tps_p50_by_model: { [dailyDriverModel]: 1.0 },
        measured_ttft_ms_p50_by_model: { [dailyDriverModel]: 9_700 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("both-too-low");
  });

  it("fails capacity tier when decode collapses below 0.8 tok/s", () => {
    const result = evaluateSla(model, [
      peer({
        hosted_models: [model],
        measured_tps_p50_by_model: { [model]: 0.3 },
        measured_ttft_ms_p50_by_model: { [model]: 12_000 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("tps-too-low");
  });

  it("ignores hosts with null RTT (undialable from entry)", () => {
    const result = evaluateSla(model, [
      peer({
        hostname: "Elevens-MacBook-Air.local",
        hosted_models: [model],
        rtt_ms: null,
        measured_tps_p50_by_model: { [model]: 4 },
        measured_ttft_ms_p50_by_model: { [model]: 2_000 },
      }),
    ]);
    expect(result.meetsSla).toBe(false);
    expect(result.reason).toBe("no-peer-with-model");
    expect(result.candidatePeerCount).toBe(0);
  });
});
