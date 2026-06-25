import { describe, expect, it } from "vitest";
import {
  tokensToCredits,
  creditsToUsdDisplay,
  parseLeaderboardFlat,
  normalizeTokenMap,
} from "./credits-ledger";

describe("tokensToCredits", () => {
  it("converts daily-driver tokens using the tier rate", () => {
    // 1M tokens @ $0.05/M = $0.05 = 50_000 micro-dollars
    expect(tokensToCredits(1_000_000, "daily_driver")).toBe(50_000);
  });

  it("returns 0 for non-positive tokens", () => {
    expect(tokensToCredits(0, "daily_driver")).toBe(0);
    expect(tokensToCredits(-1, "capacity")).toBe(0);
  });

  it("rounds to integer micro-dollars", () => {
    const credits = tokensToCredits(1000, "daily_driver");
    expect(credits).toBe(Math.round((1000 / 1_000_000) * 0.05 * 1_000_000));
  });
});

describe("creditsToUsdDisplay", () => {
  it("converts micro-dollars back to USD", () => {
    expect(creditsToUsdDisplay(50_000)).toBe(0.05);
  });
});

describe("parseLeaderboardFlat", () => {
  it("parses Upstash flat [member, score, ...] reply into rows", () => {
    const rows = parseLeaderboardFlat(["peerA", 50_000, "peerB", 10_000]);
    expect(rows).toEqual([
      { peerId: "peerA", credits: 50_000, usd: 0.05 },
      { peerId: "peerB", credits: 10_000, usd: 0.01 },
    ]);
  });

  it("handles stringified scores from the REST client", () => {
    const rows = parseLeaderboardFlat(["peerA", "50000"]);
    expect(rows[0]).toEqual({ peerId: "peerA", credits: 50_000, usd: 0.05 });
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
