import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decideFallback,
  fallbackAvailableFor,
  fallbackKeyConfigured,
  mapModelIdForFallback,
} from "./fallback-provider";
import type { SlaEvaluation } from "./routing-sla";

function sla(overrides: Partial<SlaEvaluation>): SlaEvaluation {
  return {
    meetsSla: false,
    tier: "daily_driver",
    reason: "no-measurements",
    bestPeerTtftMs: null,
    bestPeerTps: null,
    candidatePeerCount: 0,
    creditPeerId: null,
    bestPeerNativeRatio: null,
    ...overrides,
  };
}

const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  // Tests assume the key is provisioned unless they say otherwise;
  // the "no key" path has its own test below that re-sets this.
  process.env.OPENROUTER_API_KEY = "test-key";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = ORIGINAL_KEY;
  }
});

describe("mapModelIdForFallback", () => {
  it("maps known daily-driver models to OpenRouter slugs", () => {
    expect(mapModelIdForFallback("Qwen3-8B-Q4_K_M")).toBe("qwen/qwen3-8b");
    expect(mapModelIdForFallback("Llama-3.1-8B-Instruct-Q4_K_M")).toBe(
      "meta-llama/llama-3.1-8b-instruct",
    );
  });

  it("normalises runtime-shaped ids", () => {
    expect(mapModelIdForFallback("qwen3-8b-q4_k_m.gguf")).toBe(
      "qwen/qwen3-8b",
    );
  });

  it("returns null for unknown models", () => {
    expect(mapModelIdForFallback("some-future-model-Q4_K_M")).toBeNull();
  });

  it("maps Gemma capacity models used for no-host demo fallback", () => {
    expect(mapModelIdForFallback("Gemma-3-27B-it-Q4_K_M")).toBe(
      "google/gemma-3-27b-it",
    );
    expect(mapModelIdForFallback("google_gemma-3-27b-it-Q4_K_M")).toBe(
      "google/gemma-3-27b-it",
    );
  });

  it("returns null for unmapped capacity models", () => {
    expect(mapModelIdForFallback("DeepSeek-R1-Distill-70B-Q4_K_M")).toBeNull();
    expect(mapModelIdForFallback("Qwen3-32B-Q4_K_M")).toBeNull();
  });
});

describe("fallbackKeyConfigured / fallbackAvailableFor", () => {
  it("requires both a key AND a model mapping", () => {
    expect(fallbackKeyConfigured()).toBe(true);
    expect(fallbackAvailableFor("Qwen3-8B-Q4_K_M")).toBe(true);
    expect(fallbackAvailableFor("Gemma-3-27B-it-Q4_K_M")).toBe(true);
    expect(fallbackAvailableFor("DeepSeek-R1-Distill-70B-Q4_K_M")).toBe(false);
  });

  it("reports unavailable when the key is unset", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(fallbackKeyConfigured()).toBe(false);
    expect(fallbackAvailableFor("Qwen3-8B-Q4_K_M")).toBe(false);
  });
});

describe("decideFallback", () => {
  it("stays on mesh when SLA passes, regardless of tier", () => {
    const d = decideFallback("Qwen3-8B-Q4_K_M", sla({ meetsSla: true }));
    expect(d.useFallback).toBe(false);
    expect(d.verdict).toBe("mesh-meets-sla");
    expect(d.fallbackModelSlug).toBeNull();
  });

  it("fires fallback when SLA misses for a mapped daily-driver model", () => {
    const d = decideFallback(
      "Qwen3-8B-Q4_K_M",
      sla({ meetsSla: false, reason: "tps-too-low" }),
    );
    expect(d.useFallback).toBe(true);
    expect(d.verdict).toBe("fallback-fired");
    expect(d.fallbackModelSlug).toBe("qwen/qwen3-8b");
  });

  it("stays on mesh for capacity SLA misses when a dialable host exists", () => {
    const d = decideFallback(
      "DeepSeek-R1-Distill-70B-Q4_K_M",
      sla({
        meetsSla: false,
        tier: "capacity",
        reason: "tps-too-low",
        candidatePeerCount: 1,
      }),
    );
    expect(d.useFallback).toBe(false);
    expect(d.verdict).toBe("fallback-wrong-tier");
  });

  it("falls back for capacity when no dialable host exists (demo safety net)", () => {
    const d = decideFallback(
      "Gemma-3-27B-it-Q4_K_M",
      sla({
        meetsSla: false,
        tier: "capacity",
        reason: "no-peer-with-model",
        candidatePeerCount: 0,
      }),
    );
    expect(d.useFallback).toBe(true);
    expect(d.verdict).toBe("fallback-capacity-no-host");
    expect(d.fallbackModelSlug).toBe("google/gemma-3-27b-it");
  });

  it("stays on mesh for unmapped capacity even with zero hosts", () => {
    const d = decideFallback(
      "DeepSeek-R1-Distill-70B-Q4_K_M",
      sla({
        meetsSla: false,
        tier: "capacity",
        reason: "no-peer-with-model",
        candidatePeerCount: 0,
      }),
    );
    expect(d.useFallback).toBe(false);
    expect(d.verdict).toBe("fallback-no-mapping");
  });

  it("stays on mesh when the OpenRouter key is not configured", () => {
    delete process.env.OPENROUTER_API_KEY;
    const d = decideFallback(
      "Qwen3-8B-Q4_K_M",
      sla({ meetsSla: false, reason: "no-peer-with-model" }),
    );
    expect(d.useFallback).toBe(false);
    expect(d.verdict).toBe("fallback-disabled");
    expect(d.fallbackModelSlug).toBeNull();
  });

  it("fires fallback when no mesh peer hosts the model at all", () => {
    const d = decideFallback(
      "Qwen3-8B-Q4_K_M",
      sla({
        meetsSla: false,
        reason: "no-peer-with-model",
        candidatePeerCount: 0,
      }),
    );
    expect(d.useFallback).toBe(true);
    expect(d.verdict).toBe("fallback-fired");
  });
});
