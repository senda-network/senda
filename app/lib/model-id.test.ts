import { describe, expect, it } from "vitest";
import { modelIdsMatch, normalizeModelId } from "./model-id";

describe("normalizeModelId", () => {
  it("folds case and separator variants", () => {
    expect(normalizeModelId("Gemma-3-27B-it-Q4_K_M")).toBe(
      "gemma-3-27b-it-q4-k-m",
    );
    expect(normalizeModelId("gemma-3-27b-it.Q4_K_M.gguf")).toBe(
      "gemma-3-27b-it-q4-k-m",
    );
  });
});

describe("modelIdsMatch", () => {
  it("equates exact normalized ids", () => {
    expect(modelIdsMatch("Gemma-3-27B-it-Q4_K_M", "gemma-3-27b-it-Q4_K_M")).toBe(
      true,
    );
  });

  it("equates HF publisher-prefixed stems to catalog ids", () => {
    expect(
      modelIdsMatch("google_gemma-3-27b-it-Q4_K_M", "Gemma-3-27B-it-Q4_K_M"),
    ).toBe(true);
  });

  it("does not match unrelated models", () => {
    expect(modelIdsMatch("Qwen3-8B-Q4_K_M", "Gemma-3-27B-it-Q4_K_M")).toBe(
      false,
    );
  });
});
