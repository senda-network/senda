import { afterEach, describe, expect, it } from "vitest";
import {
  buildSessionReceipt,
  canonicalReceiptPayload,
  signReceiptPayload,
  verifyReceiptSignature,
} from "./session-receipts";

describe("session receipts", () => {
  const prevHmac = process.env.SENDA_RECEIPT_HMAC_SECRET;
  const prevCron = process.env.CRON_SECRET;

  afterEach(() => {
    if (prevHmac === undefined) delete process.env.SENDA_RECEIPT_HMAC_SECRET;
    else process.env.SENDA_RECEIPT_HMAC_SECRET = prevHmac;
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
  });

  it("builds a receipt with tier-weighted credits", () => {
    delete process.env.SENDA_RECEIPT_HMAC_SECRET;
    delete process.env.CRON_SECRET;
    const receipt = buildSessionReceipt({
      peerId: "227fd568e9",
      modelId: "Qwen3-8B-Q4_K_M",
      completionTokens: 100,
      attribution: "serving-peer",
      id: "test-id",
      now: new Date("2026-07-22T12:00:00.000Z"),
    });
    expect(receipt.credits).toBe(100);
    expect(receipt.attribution).toBe("serving-peer");
    expect(receipt.sig).toBeNull();
    expect(receipt.ts).toBe("2026-07-22T12:00:00.000Z");
  });

  it("signs when SENDA_RECEIPT_HMAC_SECRET is set", () => {
    process.env.SENDA_RECEIPT_HMAC_SECRET = "test-secret";
    delete process.env.CRON_SECRET;
    const receipt = buildSessionReceipt({
      peerId: "abc",
      modelId: "Qwen3-8B-Q4_K_M",
      completionTokens: 10,
      attribution: "sla-heuristic",
      id: "id-1",
      now: new Date("2026-07-22T12:00:00.000Z"),
    });
    expect(receipt.sig).toBeTruthy();
    const expected = signReceiptPayload(
      canonicalReceiptPayload(receipt),
      "test-secret",
    );
    expect(receipt.sig).toBe(expected);
    expect(verifyReceiptSignature(receipt)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    process.env.SENDA_RECEIPT_HMAC_SECRET = "test-secret";
    const receipt = buildSessionReceipt({
      peerId: "abc",
      modelId: "Qwen3-8B-Q4_K_M",
      completionTokens: 10,
      attribution: "serving-peer",
      id: "id-2",
      now: new Date("2026-07-22T12:00:00.000Z"),
    });
    expect(
      verifyReceiptSignature({ ...receipt, completionTokens: 999 }),
    ).toBe(false);
  });
});
