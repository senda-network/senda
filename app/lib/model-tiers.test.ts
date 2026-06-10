import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_DRIVER_MODEL,
  estimatePeerPayout,
  getModelTier,
  PEER_PAYOUT_USD_PER_MTOKEN_BY_TIER,
  pickDefaultModelByTier,
  tierRank,
} from "./model-tiers";

describe("getModelTier", () => {
  it("classifies the 8B / 14B daily-driver cohort", () => {
    expect(getModelTier("Qwen3-8B-Q4_K_M")).toBe("daily_driver");
    expect(getModelTier("Llama-3.1-8B-Instruct-Q4_K_M")).toBe("daily_driver");
    expect(getModelTier("DeepSeek-R1-Distill-Qwen-14B-Q4_K_M")).toBe(
      "daily_driver",
    );
  });

  it("classifies 32B–70B as capacity", () => {
    expect(getModelTier("Qwen3-32B-Q4_K_M")).toBe("capacity");
    expect(getModelTier("Llama-3.3-70B-Instruct-Q4_K_M")).toBe("capacity");
    expect(getModelTier("DeepSeek-R1-Distill-70B-Q4_K_M")).toBe("capacity");
  });

  it("normalises runtime-shaped ids (gguf suffix, casing) before lookup", () => {
    expect(getModelTier("qwen3-8b-q4_k_m.gguf")).toBe("daily_driver");
    expect(getModelTier("DEEPSEEK-R1-DISTILL-70B-Q4_K_M")).toBe("capacity");
  });

  it("falls back to experimental for unknown ids", () => {
    expect(getModelTier("some-future-model-Q4_K_M")).toBe("experimental");
    expect(getModelTier("")).toBe("experimental");
  });
});

describe("tierRank", () => {
  it("orders daily_driver < capacity < experimental", () => {
    expect(tierRank("daily_driver")).toBeLessThan(tierRank("capacity"));
    expect(tierRank("capacity")).toBeLessThan(tierRank("experimental"));
  });
});

describe("pickDefaultModelByTier", () => {
  it("returns undefined for empty input", () => {
    expect(pickDefaultModelByTier([])).toBeUndefined();
  });

  it("prefers daily-driver over capacity even when capacity is listed first", () => {
    const routable = [
      "DeepSeek-R1-Distill-70B-Q4_K_M",
      "Qwen3-32B-Q4_K_M",
      "Qwen3-8B-Q4_K_M",
    ];
    expect(pickDefaultModelByTier(routable)).toBe("Qwen3-8B-Q4_K_M");
  });

  it("prefers the canonical daily-driver when several are routable", () => {
    const routable = [
      "Llama-3.1-8B-Instruct-Q4_K_M",
      "Qwen3-8B-Q4_K_M",
    ];
    expect(pickDefaultModelByTier(routable)).toBe(DEFAULT_DAILY_DRIVER_MODEL);
  });

  it("returns the first daily-driver when the canonical one isn't routable", () => {
    const routable = [
      "Llama-3.1-8B-Instruct-Q4_K_M",
      "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M",
    ];
    expect(pickDefaultModelByTier(routable)).toBe(
      "Llama-3.1-8B-Instruct-Q4_K_M",
    );
  });

  it("never auto-defaults to a capacity model — falls to the canonical daily-driver when only capacity is routable", () => {
    const routable = [
      "DeepSeek-R1-Distill-70B-Q4_K_M",
      "Qwen3-32B-Q4_K_M",
    ];
    // Deliberately NOT one of the routable ids: a capacity-only mesh
    // yields an honest "no peer serving this model" error downstream
    // rather than a surprise ~1 tok/s stream.
    expect(pickDefaultModelByTier(routable)).toBe(DEFAULT_DAILY_DRIVER_MODEL);
    expect(routable).not.toContain(pickDefaultModelByTier(routable));
  });

  it("honours an explicit `preferred` even when it is a capacity model", () => {
    const routable = [
      "Qwen3-8B-Q4_K_M",
      "DeepSeek-R1-Distill-70B-Q4_K_M",
    ];
    // Operator's explicit CLOSEDMESH_MODEL pin wins over the tier gate.
    expect(
      pickDefaultModelByTier(routable, "DeepSeek-R1-Distill-70B-Q4_K_M"),
    ).toBe("DeepSeek-R1-Distill-70B-Q4_K_M");
  });

  it("honours `preferred` when it is routable", () => {
    const routable = [
      "Qwen3-8B-Q4_K_M",
      "Llama-3.1-8B-Instruct-Q4_K_M",
    ];
    expect(
      pickDefaultModelByTier(routable, "Llama-3.1-8B-Instruct-Q4_K_M"),
    ).toBe("Llama-3.1-8B-Instruct-Q4_K_M");
  });

  it("ignores a `preferred` that isn't currently routable", () => {
    const routable = ["Qwen3-8B-Q4_K_M"];
    expect(pickDefaultModelByTier(routable, "Llama-3.3-70B-Instruct-Q4_K_M")).toBe(
      "Qwen3-8B-Q4_K_M",
    );
  });
});

describe("estimatePeerPayout", () => {
  it("returns an empty estimate for missing / empty / all-zero input", () => {
    const inputs: Array<Record<string, number> | null | undefined> = [
      undefined,
      null,
      {},
      { "Qwen3-8B-Q4_K_M": 0 },
    ];
    for (const input of inputs) {
      const e = estimatePeerPayout(input);
      expect(e.totalTokens).toBe(0);
      expect(e.totalUsd).toBe(0);
      expect(e.perModel).toEqual([]);
    }
  });

  it("multiplies tokens by the tier rate (per million tokens)", () => {
    // 2M daily-driver tokens at $0.05/Mtok = $0.10.
    const e = estimatePeerPayout({ "Qwen3-8B-Q4_K_M": 2_000_000 });
    expect(e.totalTokens).toBe(2_000_000);
    expect(e.perModel).toHaveLength(1);
    expect(e.perModel[0].tier).toBe("daily_driver");
    expect(e.totalUsd).toBeCloseTo(
      2 * PEER_PAYOUT_USD_PER_MTOKEN_BY_TIER.daily_driver,
      10,
    );
  });

  it("uses the higher capacity rate for capacity-tier models", () => {
    const daily = estimatePeerPayout({ "Qwen3-8B-Q4_K_M": 1_000_000 }).totalUsd;
    const cap = estimatePeerPayout({
      "Llama-3.3-70B-Instruct-Q4_K_M": 1_000_000,
    }).totalUsd;
    expect(cap).toBeGreaterThan(daily);
  });

  it("sums across models and the per-model rows total exactly to totalUsd", () => {
    const e = estimatePeerPayout({
      "Qwen3-8B-Q4_K_M": 3_000_000,
      "Llama-3.3-70B-Instruct-Q4_K_M": 1_000_000,
    });
    expect(e.totalTokens).toBe(4_000_000);
    const summed = e.perModel.reduce((acc, r) => acc + r.usd, 0);
    expect(summed).toBeCloseTo(e.totalUsd, 10);
  });

  it("sorts per-model rows by USD descending", () => {
    const e = estimatePeerPayout({
      // More daily-driver tokens, but capacity earns more per token —
      // capacity should still rank by its USD contribution.
      "Qwen3-8B-Q4_K_M": 10_000_000, // 10 * 0.05 = $0.50
      "Llama-3.3-70B-Instruct-Q4_K_M": 5_000_000, // 5 * 0.25 = $1.25
    });
    expect(e.perModel[0].model).toBe("Llama-3.3-70B-Instruct-Q4_K_M");
    expect(e.perModel[0].usd).toBeGreaterThan(e.perModel[1].usd);
  });

  it("drops zero-token models but keeps non-zero ones", () => {
    const e = estimatePeerPayout({
      "Qwen3-8B-Q4_K_M": 0,
      "Llama-3.1-8B-Instruct-Q4_K_M": 500_000,
    });
    expect(e.perModel).toHaveLength(1);
    expect(e.perModel[0].model).toBe("Llama-3.1-8B-Instruct-Q4_K_M");
  });

  it("ignores negative / non-finite token counts defensively", () => {
    const e = estimatePeerPayout({
      "Qwen3-8B-Q4_K_M": -100,
      "Llama-3.1-8B-Instruct-Q4_K_M": Number.NaN,
    });
    expect(e.totalTokens).toBe(0);
    expect(e.perModel).toEqual([]);
  });
});
