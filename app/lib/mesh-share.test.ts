import { describe, expect, it } from "vitest";
import { computeMeshShareFromCounters } from "./mesh-share";

const now = new Date("2026-05-24T12:00:00Z");

function key(servedBy: "mesh" | "fallback", hour: string): string {
  return `senda:mesh-share:${servedBy}:${hour}`;
}

describe("computeMeshShareFromCounters", () => {
  it("returns pct=null when no requests are recorded", () => {
    const window = computeMeshShareFromCounters({}, 24, now);
    expect(window).toEqual({ hours: 24, mesh: 0, fallback: 0, pct: null });
  });

  it("computes 100% when only mesh requests are recorded", () => {
    const counters = {
      [key("mesh", "20260524T12")]: 10,
      [key("mesh", "20260524T11")]: 5,
    };
    const window = computeMeshShareFromCounters(counters, 24, now);
    expect(window.mesh).toBe(15);
    expect(window.fallback).toBe(0);
    expect(window.pct).toBe(100);
  });

  it("computes 0% when only fallback requests are recorded", () => {
    const counters = {
      [key("fallback", "20260524T11")]: 8,
    };
    const window = computeMeshShareFromCounters(counters, 24, now);
    expect(window.mesh).toBe(0);
    expect(window.fallback).toBe(8);
    expect(window.pct).toBe(0);
  });

  it("computes a mixed ratio over the rolling window", () => {
    const counters = {
      [key("mesh", "20260524T12")]: 30,
      [key("mesh", "20260524T11")]: 20,
      [key("fallback", "20260524T11")]: 50,
    };
    const window = computeMeshShareFromCounters(counters, 24, now);
    expect(window.mesh).toBe(50);
    expect(window.fallback).toBe(50);
    expect(window.pct).toBe(50);
  });

  it("respects the window size — buckets outside the window are not summed", () => {
    // 25h ago is outside a 24h window.
    const counters = {
      [key("mesh", "20260524T12")]: 10,
      [key("fallback", "20260523T11")]: 100, // 25h ago
    };
    const window = computeMeshShareFromCounters(counters, 24, now);
    expect(window.mesh).toBe(10);
    expect(window.fallback).toBe(0);
    expect(window.pct).toBe(100);
  });

  it("aggregates a full 168-hour window correctly", () => {
    const counters: Record<string, number> = {};
    for (let i = 0; i < 168; i++) {
      const at = new Date(now.getTime() - i * 3600_000);
      const hour =
        String(at.getUTCFullYear()) +
        String(at.getUTCMonth() + 1).padStart(2, "0") +
        String(at.getUTCDate()).padStart(2, "0") +
        "T" +
        String(at.getUTCHours()).padStart(2, "0");
      counters[key("mesh", hour)] = 1;
      counters[key("fallback", hour)] = 1;
    }
    const window = computeMeshShareFromCounters(counters, 168, now);
    expect(window.mesh).toBe(168);
    expect(window.fallback).toBe(168);
    expect(window.pct).toBe(50);
  });
});
