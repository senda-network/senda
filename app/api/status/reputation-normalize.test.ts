import { describe, expect, test } from "vitest";
import { normalizeReputationByModel } from "./route";

/**
 * Phase 3.2: the entry emits `reputation_by_model` (snake_case) on each peer;
 * the website normalizes it to camelCase `Reputation` for the status UI. These
 * tests pin the absent/empty -> undefined contract (so the chip renders nothing
 * for pre-v0.66.80 peers) and the field mapping.
 */
describe("normalizeReputationByModel", () => {
  test("returns undefined for missing input (legacy peer)", () => {
    expect(normalizeReputationByModel(undefined)).toBeUndefined();
    expect(normalizeReputationByModel(null)).toBeUndefined();
  });

  test("returns undefined when no entry has a grade", () => {
    expect(normalizeReputationByModel({})).toBeUndefined();
    // Malformed entry with no grade is dropped, leaving an empty map.
    expect(
      normalizeReputationByModel({ "qwen3-8b": { score: 0.9 } }),
    ).toBeUndefined();
  });

  test("maps snake_case fields to camelCase", () => {
    const out = normalizeReputationByModel({
      "qwen3-8b": {
        grade: "trusted",
        score: 0.97,
        samples: 12,
        matches: 12,
        mismatches: 0,
        last_verdict: "match",
        updated_at_unix_secs: 1700,
      },
    });
    expect(out).toEqual({
      "qwen3-8b": {
        grade: "trusted",
        score: 0.97,
        samples: 12,
        matches: 12,
        mismatches: 0,
        lastVerdict: "match",
        updatedAtUnixSecs: 1700,
      },
    });
  });

  test("fills missing numeric fields with safe defaults", () => {
    const out = normalizeReputationByModel({
      "llama-3.1-8b": { grade: "unproven" },
    });
    expect(out).toEqual({
      "llama-3.1-8b": {
        grade: "unproven",
        score: 0,
        samples: 0,
        matches: 0,
        mismatches: 0,
        lastVerdict: "",
        updatedAtUnixSecs: 0,
      },
    });
  });
});
