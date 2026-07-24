import { afterEach, describe, expect, it } from "vitest";
import {
  buildVerificationReceipt,
  canonicalVerificationPayload,
  shortPeerId,
  signVerificationPayload,
  verificationReceiptId,
} from "./verification-receipts";

describe("shortPeerId", () => {
  it("truncates to 10 chars", () => {
    expect(shortPeerId("227fd568e9abcdef")).toBe("227fd568e9");
    expect(shortPeerId("227fd568e9")).toBe("227fd568e9");
  });
});

describe("verification receipts", () => {
  const prevHmac = process.env.SENDA_RECEIPT_HMAC_SECRET;
  const prevCron = process.env.CRON_SECRET;

  afterEach(() => {
    if (prevHmac === undefined) delete process.env.SENDA_RECEIPT_HMAC_SECRET;
    else process.env.SENDA_RECEIPT_HMAC_SECRET = prevHmac;
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
  });

  it("uses a deterministic id from peer/model/checkedAt/verdict", () => {
    expect(
      verificationReceiptId("227fd568e9", "Qwen3-8B-Q4_K_M", 1700000000, "match"),
    ).toBe("227fd568e9|Qwen3-8B-Q4_K_M|1700000000|match");
  });

  it("builds an unsigned receipt when no secret is set", () => {
    delete process.env.SENDA_RECEIPT_HMAC_SECRET;
    delete process.env.CRON_SECRET;
    const receipt = buildVerificationReceipt({
      peerId: "227fd568e9abcdef",
      modelId: "Qwen3-8B-Q4_K_M",
      verdict: "match",
      agreement: 1,
      comparedTokens: 16,
      mode: "battery",
      grade: "trusted",
      score: 0.95,
      samples: 12,
      checkedAtUnixSecs: 1700000000,
      now: new Date("2026-07-24T00:00:00.000Z"),
    });
    expect(receipt.peerId).toBe("227fd568e9");
    expect(receipt.sig).toBeNull();
    expect(receipt.grade).toBe("trusted");
    expect(receipt.id).toContain("match");
  });

  it("signs when SENDA_RECEIPT_HMAC_SECRET is set", () => {
    process.env.SENDA_RECEIPT_HMAC_SECRET = "test-secret";
    delete process.env.CRON_SECRET;
    const receipt = buildVerificationReceipt({
      peerId: "abc",
      modelId: "Qwen3-8B-Q4_K_M",
      verdict: "mismatch",
      agreement: 0.2,
      comparedTokens: 10,
      mode: "battery",
      reason: "gross",
      checkedAtUnixSecs: 1700000001,
      now: new Date("2026-07-24T00:00:00.000Z"),
    });
    expect(receipt.sig).toBeTruthy();
    const expected = signVerificationPayload(
      canonicalVerificationPayload(receipt),
      "test-secret",
    );
    expect(receipt.sig).toBe(expected);
  });
});
