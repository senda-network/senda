import { describe, expect, it } from "vitest";
import {
  tokensToCredits,
  parseLeaderboardFlat,
  normalizeTokenMap,
  resolveCreditMultiplier,
} from "./credits-ledger";
import { TIER_WEIGHT } from "./model-tiers";

describe("tokensToCredits", () => {
  it("weights daily-driver tokens by the tier weight (base unit)", () => {
    // 1M daily-driver tokens @ weight 1 = 1_000_000 credits.
    expect(tokensToCredits(1_000_000, "daily_driver")).toBe(1_000_000);
  });

  it("weights capacity tokens more heavily", () => {
    expect(tokensToCredits(1_000_000, "capacity")).toBe(
      1_000_000 * TIER_WEIGHT.capacity,
    );
  });

  it("returns 0 for non-positive tokens", () => {
    expect(tokensToCredits(0, "daily_driver")).toBe(0);
    expect(tokensToCredits(-1, "capacity")).toBe(0);
  });

  it("rounds to an integer credit count", () => {
    const credits = tokensToCredits(1001, "experimental");
    expect(credits).toBe(Math.round(1001 * TIER_WEIGHT.experimental));
  });
});

describe("parseLeaderboardFlat", () => {
  it("parses Upstash flat [member, score, ...] reply into rows", () => {
    const rows = parseLeaderboardFlat(["peerA", 50_000, "peerB", 10_000]);
    expect(rows).toEqual([
      { peerId: "peerA", credits: 50_000 },
      { peerId: "peerB", credits: 10_000 },
    ]);
  });

  it("handles stringified scores from the REST client", () => {
    const rows = parseLeaderboardFlat(["peerA", "50000"]);
    expect(rows[0]).toEqual({ peerId: "peerA", credits: 50_000 });
  });

  it("returns empty for null/empty/odd-length input", () => {
    expect(parseLeaderboardFlat(null)).toEqual([]);
    expect(parseLeaderboardFlat([])).toEqual([]);
    expect(parseLeaderboardFlat(["dangling"])).toEqual([]);
  });
});

describe("normalizeTokenMap", () => {
  it("coerces string and number hash values to positive numbers", () => {
    expect(
      normalizeTokenMap({ "Qwen3-8B-Q4_K_M": "1200", "Llama-3.2-3B": 50 }),
    ).toEqual({ "Qwen3-8B-Q4_K_M": 1200, "Llama-3.2-3B": 50 });
  });

  it("drops non-numeric and non-positive values", () => {
    expect(normalizeTokenMap({ a: "x", b: 0, c: -5, d: 10 })).toEqual({ d: 10 });
  });

  it("returns empty for null/undefined", () => {
    expect(normalizeTokenMap(null)).toEqual({});
    expect(normalizeTokenMap(undefined)).toEqual({});
  });
});

describe("resolveCreditMultiplier", () => {
  it("returns 1 for sla-heuristic without touching Redis", async () => {
    await expect(
      resolveCreditMultiplier("abc", "Qwen3-8B-Q4_K_M", "sla-heuristic"),
    ).resolves.toBe(1);
  });
});
