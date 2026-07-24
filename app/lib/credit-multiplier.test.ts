import { afterEach, describe, expect, it } from "vitest";
import {
  applyCreditMultiplier,
  creditMultiplierForAttribution,
  creditMultiplierForGrade,
  creditSlashEnabled,
} from "./credit-multiplier";

describe("creditSlashEnabled", () => {
  it("is off by default", () => {
    expect(creditSlashEnabled({})).toBe(false);
    expect(creditSlashEnabled({ SENDA_CREDIT_SLASH: "" })).toBe(false);
    expect(creditSlashEnabled({ SENDA_CREDIT_SLASH: "0" })).toBe(false);
  });

  it("accepts truthy values", () => {
    expect(creditSlashEnabled({ SENDA_CREDIT_SLASH: "1" })).toBe(true);
    expect(creditSlashEnabled({ SENDA_CREDIT_SLASH: "true" })).toBe(true);
    expect(creditSlashEnabled({ SENDA_CREDIT_SLASH: "ON" })).toBe(true);
  });
});

describe("creditMultiplierForGrade", () => {
  it("always returns 1 when slash is disabled", () => {
    const env = { SENDA_CREDIT_SLASH: "" };
    expect(creditMultiplierForGrade("watch", env)).toBe(1);
    expect(creditMultiplierForGrade("trusted", env)).toBe(1);
  });

  it("scales watch when slash is enabled", () => {
    const env = { SENDA_CREDIT_SLASH: "1" };
    expect(creditMultiplierForGrade("trusted", env)).toBe(1);
    expect(creditMultiplierForGrade("unproven", env)).toBe(1);
    expect(creditMultiplierForGrade("watch", env)).toBe(0.5);
  });
});

describe("creditMultiplierForAttribution", () => {
  it("never scales sla-heuristic credits", () => {
    const env = { SENDA_CREDIT_SLASH: "1" };
    expect(
      creditMultiplierForAttribution("watch", "sla-heuristic", env),
    ).toBe(1);
  });

  it("scales serving-peer watch when slash is on", () => {
    const env = { SENDA_CREDIT_SLASH: "1" };
    expect(
      creditMultiplierForAttribution("watch", "serving-peer", env),
    ).toBe(0.5);
  });
});

describe("applyCreditMultiplier", () => {
  it("rounds scaled credits", () => {
    expect(applyCreditMultiplier(100, 0.5)).toBe(50);
    expect(applyCreditMultiplier(101, 0.5)).toBe(51);
  });

  it("zeros non-positive inputs", () => {
    expect(applyCreditMultiplier(0, 1)).toBe(0);
    expect(applyCreditMultiplier(100, 0)).toBe(0);
  });
});

describe("env isolation", () => {
  const prev = process.env.SENDA_CREDIT_SLASH;
  afterEach(() => {
    if (prev === undefined) delete process.env.SENDA_CREDIT_SLASH;
    else process.env.SENDA_CREDIT_SLASH = prev;
  });

  it("reads process.env when no override is passed", () => {
    delete process.env.SENDA_CREDIT_SLASH;
    expect(creditMultiplierForGrade("watch")).toBe(1);
    process.env.SENDA_CREDIT_SLASH = "1";
    expect(creditMultiplierForGrade("watch")).toBe(0.5);
  });
});
