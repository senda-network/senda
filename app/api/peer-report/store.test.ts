import { afterEach, describe, expect, test, vi } from "vitest";
import {
  __resetForTest,
  getReport,
  listReports,
  putReport,
  type PeerReportInput,
} from "./store";

/**
 * Tests for the in-memory peer-report store.
 *
 * These cover the exact failure modes that would silently degrade
 * operator visibility:
 *  - reports lost on subsequent writes (key collision)
 *  - reports outliving their TTL (stale data masquerading as live)
 *  - unbounded growth from rotating node-ids
 *  - newest-first ordering invariant the API depends on
 */

function makeReport(nodeId: string, overrides: Partial<PeerReportInput> = {}): PeerReportInput {
  return {
    nodeId,
    hostname: `host-${nodeId}`,
    version: "0.66.18",
    servingModels: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
    meshVisibility: {
      state: "visible",
      lastCheckUnix: 1_700_000_000,
      lastVisibleUnix: 1_700_000_000,
      consecutiveInvisibleCount: 0,
      lastError: null,
      entryUrl: "https://mesh.closedmesh.com",
      softReconnectTriggered: false,
      hardResetTriggered: false,
    },
    ...overrides,
  };
}

afterEach(() => {
  __resetForTest();
  vi.useRealTimers();
});

describe("putReport / getReport", () => {
  test("roundtrips a single report", async () => {
    await putReport(makeReport("MSI_id_full_string_xxx"));
    const got = await getReport("MSI_id_full_string_xxx");
    expect(got).not.toBeNull();
    expect(got?.nodeId).toBe("MSI_id_full_string_xxx");
    expect(got?.meshVisibility.state).toBe("visible");
    expect(typeof got?.receivedAtUnix).toBe("number");
  });

  test("replaces previous report for the same nodeId (no leak across writes)", async () => {
    await putReport(makeReport("MSI_id", { servingModels: ["model-a"] }));
    await putReport(makeReport("MSI_id", { servingModels: ["model-b"] }));
    const got = await getReport("MSI_id");
    expect(got?.servingModels).toEqual(["model-b"]);
    // Replacement: still only one report total.
    expect((await listReports()).length).toBe(1);
  });

  test("getReport returns null for unknown nodeId", async () => {
    await putReport(makeReport("MSI_id"));
    expect(await getReport("nope")).toBeNull();
  });

  test("getReport returns null after store reset", async () => {
    await putReport(makeReport("MSI_id"));
    __resetForTest();
    expect(await getReport("MSI_id")).toBeNull();
    expect(await listReports()).toEqual([]);
  });
});

describe("listReports", () => {
  test("returns reports newest first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T10:00:00Z"));
    await putReport(makeReport("first_id"));
    vi.setSystemTime(new Date("2026-05-13T10:01:00Z"));
    await putReport(makeReport("second_id"));
    vi.setSystemTime(new Date("2026-05-13T10:02:00Z"));
    await putReport(makeReport("third_id"));

    const ids = (await listReports()).map((r) => r.nodeId);
    expect(ids).toEqual(["third_id", "second_id", "first_id"]);
  });

  test("expires reports older than 5 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T10:00:00Z"));
    await putReport(makeReport("stale_id"));

    // 4 minutes later — still live.
    vi.setSystemTime(new Date("2026-05-13T10:04:00Z"));
    expect((await listReports()).length).toBe(1);

    // 5 minutes 1 second after the write — expired.
    vi.setSystemTime(new Date("2026-05-13T10:05:01Z"));
    expect((await listReports()).length).toBe(0);
    expect(await getReport("stale_id")).toBeNull();
  });

  test("write of a new report refreshes its TTL without affecting others", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T10:00:00Z"));
    await putReport(makeReport("A_id"));
    await putReport(makeReport("B_id"));

    // 4 minutes later, refresh A.
    vi.setSystemTime(new Date("2026-05-13T10:04:00Z"));
    await putReport(makeReport("A_id"));

    // 5 minutes 1 second after start — B is expired, A is not.
    vi.setSystemTime(new Date("2026-05-13T10:05:01Z"));
    const ids = (await listReports()).map((r) => r.nodeId);
    expect(ids).toEqual(["A_id"]);
  });
});

describe("rate-limiting", () => {
  test("enforces MAX_REPORTS cap by dropping the oldest entry", async () => {
    // The cap is 1024; we only need to prove the eviction logic with
    // a smaller-but-deterministic insert pattern. Use real time so
    // that every insert lands within the TTL window.
    for (let i = 0; i < 1100; i++) {
      await putReport(makeReport(`peer_${i.toString().padStart(4, "0")}`));
    }
    const all = await listReports();
    expect(all.length).toBeLessThanOrEqual(1024);
    // Oldest entries (peer_0000..) should have been evicted.
    const surviving = new Set(all.map((r) => r.nodeId));
    expect(surviving.has("peer_0000")).toBe(false);
    // Newest entries should all be present.
    expect(surviving.has("peer_1099")).toBe(true);
  });
});
