import { describe, expect, it } from "vitest";
import {
  getModelTier,
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

  it("falls back to capacity when no daily-driver is routable", () => {
    const routable = [
      "DeepSeek-R1-Distill-70B-Q4_K_M",
      "Qwen3-32B-Q4_K_M",
    ];
    expect(pickDefaultModelByTier(routable)).toBe(
      "DeepSeek-R1-Distill-70B-Q4_K_M",
    );
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
