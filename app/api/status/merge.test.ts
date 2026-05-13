import { describe, expect, test } from "vitest";
import type { StoredPeerReport } from "../peer-report/store";
import {
  mergePeerReports,
  normalizeMeshVisibility,
  reportToInvisibleNode,
  type NodeSummary,
} from "./route";

/**
 * Tests for the peer-report merge layer.
 *
 * These are the only public-facing surface that turns "the entry node
 * cannot see this peer" into "the public status page shows the peer
 * as claimed-but-invisible". A silent regression here is the entire
 * Slice-4 promise reverted. Cover every meaningful branch.
 */

function makeNode(overrides: Partial<NodeSummary> = {}): NodeSummary {
  return {
    id: "LYU_id_full_string_xx",
    hostname: "LYU",
    isSelf: false,
    role: "Worker",
    state: "standby",
    vramGb: 24,
    servingModels: [],
    capability: {
      backend: "cuda",
      vendor: "nvidia",
      computeClass: "hi",
      vramGb: 24,
      loadedModels: [],
    },
    version: "0.66.18",
    splitRole: null,
    splitGroup: null,
    moeShard: null,
    meshVisibility: null,
    ...overrides,
  };
}

function makeReport(overrides: Partial<StoredPeerReport> = {}): StoredPeerReport {
  return {
    nodeId: "MSI_id_full_string_xx",
    hostname: "MSI",
    version: "0.66.18",
    servingModels: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
    meshVisibility: {
      state: "invisible",
      lastCheckUnix: 1_700_000_010,
      lastVisibleUnix: 1_700_000_000,
      consecutiveInvisibleCount: 3,
      lastError: "not in peers",
      entryUrl: "https://mesh.closedmesh.com",
      softReconnectTriggered: true,
      hardResetTriggered: false,
    },
    receivedAtUnix: 1_700_000_020,
    ...overrides,
  };
}

describe("normalizeMeshVisibility", () => {
  test("returns null for null/undefined", () => {
    expect(normalizeMeshVisibility(null)).toBeNull();
    expect(normalizeMeshVisibility(undefined)).toBeNull();
  });

  test("preserves known states", () => {
    for (const state of ["unknown", "visible", "invisible", "entry_unreachable"] as const) {
      const out = normalizeMeshVisibility({
        state,
        consecutive_invisible_count: 0,
        entry_url: "x",
        soft_reconnect_triggered: false,
        hard_reset_triggered: false,
      });
      expect(out?.state).toBe(state);
    }
  });

  test("downgrades unknown states to 'unknown' instead of throwing", () => {
    // Forward-compat: future runtime versions may add states. We must
    // not crash the entire /api/status payload.
    const out = normalizeMeshVisibility({
      // @ts-expect-error — deliberately unknown
      state: "future_state",
      consecutive_invisible_count: 0,
      entry_url: "x",
      soft_reconnect_triggered: false,
      hard_reset_triggered: false,
    });
    expect(out?.state).toBe("unknown");
  });

  test("maps snake_case to camelCase and applies defaults", () => {
    const out = normalizeMeshVisibility({
      state: "invisible",
      last_check_unix: 1234,
      last_visible_unix: 5678,
      consecutive_invisible_count: 5,
      last_error: "boom",
      entry_url: "https://mesh.example",
      soft_reconnect_triggered: true,
      hard_reset_triggered: false,
    });
    expect(out).toEqual({
      state: "invisible",
      lastCheckUnix: 1234,
      lastVisibleUnix: 5678,
      consecutiveInvisibleCount: 5,
      lastError: "boom",
      entryUrl: "https://mesh.example",
      softReconnectTriggered: true,
      hardResetTriggered: false,
    });
  });
});

describe("reportToInvisibleNode", () => {
  test("produces a synthetic 'unreachable' node from a report", () => {
    const node = reportToInvisibleNode(makeReport());
    expect(node.id).toBe("MSI_id_full_string_xx");
    expect(node.hostname).toBe("MSI");
    expect(node.state).toBe("unreachable");
    expect(node.meshVisibility?.state).toBe("invisible");
    // servingModels from the report seed both top-level and capability.
    expect(node.servingModels).toEqual(["DeepSeek-R1-Distill-70B-Q4_K_M"]);
    expect(node.capability.loadedModels).toEqual(["DeepSeek-R1-Distill-70B-Q4_K_M"]);
  });
});

describe("mergePeerReports", () => {
  test("returns the input unchanged when there are no reports", () => {
    const nodes = [makeNode()];
    const out = mergePeerReports(nodes, [], "self_id");
    expect(out).toHaveLength(1);
    expect(out[0]?.meshVisibility).toBeNull();
  });

  test("overlays meshVisibility onto a node already in the list (matched by short id)", () => {
    const reportId = "MSI_id_full_string_xx";
    const entryShortId = reportId.slice(0, 10); // matches buildNodes' shortId
    const nodes = [makeNode({ id: entryShortId, hostname: null, version: null })];
    const out = mergePeerReports(nodes, [makeReport({ nodeId: reportId })], "self_id");
    expect(out).toHaveLength(1);
    expect(out[0]?.meshVisibility?.state).toBe("invisible");
    // hostname/version backfilled from the report because the existing
    // node had nulls.
    expect(out[0]?.hostname).toBe("MSI");
    expect(out[0]?.version).toBe("0.66.18");
  });

  test("does NOT overwrite hostname/version that the entry already provided", () => {
    const reportId = "MSI_id_full_string_xx";
    const entryShortId = reportId.slice(0, 10);
    const nodes = [
      makeNode({ id: entryShortId, hostname: "ENTRY_HOSTNAME", version: "1.0.0" }),
    ];
    const out = mergePeerReports(nodes, [makeReport({ nodeId: reportId })], "self_id");
    expect(out[0]?.hostname).toBe("ENTRY_HOSTNAME");
    expect(out[0]?.version).toBe("1.0.0");
    // But meshVisibility still flows through.
    expect(out[0]?.meshVisibility?.state).toBe("invisible");
  });

  test("synthesizes a new node when the report's id is NOT in the list", () => {
    // Exactly the May 2026 MSI shape: entry sees only LYU, MSI is
    // reporting in but invisible.
    const nodes = [makeNode({ id: "LYU_id_full_string_xx", hostname: "LYU" })];
    const out = mergePeerReports(nodes, [makeReport()], "self_id");
    expect(out).toHaveLength(2);
    const msi = out.find((n) => n.id === "MSI_id_full_string_xx");
    expect(msi).toBeDefined();
    expect(msi?.state).toBe("unreachable");
    expect(msi?.meshVisibility?.state).toBe("invisible");
    expect(msi?.servingModels).toEqual(["DeepSeek-R1-Distill-70B-Q4_K_M"]);
  });

  test("skips reports whose id matches the local self (avoid double-counting)", () => {
    const selfId = "self_id_full_string_x";
    const selfShort = selfId.slice(0, 10);
    const nodes = [makeNode({ id: selfShort, isSelf: true, hostname: "SELF" })];
    const out = mergePeerReports(nodes, [makeReport({ nodeId: selfId })], selfId);
    expect(out).toHaveLength(1);
    // Self's meshVisibility came from the local runtime, not the
    // report — we must NOT overwrite it.
    expect(out[0]?.meshVisibility).toBeNull();
  });

  test("multiple reports for distinct peers all surface in the output", () => {
    const nodes = [makeNode({ id: "LYU_id_full_string_xx" })];
    const reports = [
      makeReport({ nodeId: "MSI_id_full_string_xx", hostname: "MSI" }),
      makeReport({ nodeId: "MAC_id_full_string_xx", hostname: "MAC" }),
    ];
    const out = mergePeerReports(nodes, reports, "self_id");
    expect(out.map((n) => n.hostname).sort()).toEqual(["LYU", "MAC", "MSI"]);
  });

  test("ordering: existing nodes come before synthesized invisible nodes", () => {
    // The UI relies on existing/known nodes appearing first; an
    // invisible-only peer should never reshuffle the live peers.
    const nodes = [
      makeNode({ id: "LYU_id_full_string_xx", hostname: "LYU" }),
      makeNode({ id: "MAC_id_full_string_xx", hostname: "MAC" }),
    ];
    const out = mergePeerReports(nodes, [makeReport({ nodeId: "MSI_id_full_string_xx" })], "self_id");
    expect(out.map((n) => n.hostname)).toEqual(["LYU", "MAC", "MSI"]);
  });
});
