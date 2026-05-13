import { describe, expect, test } from "vitest";
import type { StoredPeerReport } from "../peer-report/store";
import {
  applyPipelineHealthGate,
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
    pipelineDegraded: false,
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

describe("applyPipelineHealthGate", () => {
  // Regression: the May 13 2026 incident. LYU was elected pipeline_host
  // for DeepSeek-R1-Distill-70B but its two workers (MSI, MacBook-Air)
  // were stuck in `state="loading"` forever. The runtime still set LYU
  // to `state="serving"` and advertised the model in `/v1/models`, so
  // the public status page rendered "LYU · 16 GB VRAM · serving
  // DeepSeek-R1-Distill-70B" while every chat request would 503. This
  // test pins the truthful behaviour: degraded host -> loading +
  // model dropped from catalog.
  test("downgrades pipeline_host to loading when any worker is not serving", () => {
    const lyu: NodeSummary = {
      id: "029fb6049c",
      hostname: "LYU",
      isSelf: false,
      role: "Host",
      state: "serving",
      vramGb: 106,
      servingModels: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
      capability: {
        backend: "cuda",
        vendor: "nvidia",
        computeClass: "mid",
        vramGb: 16,
        loadedModels: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
      },
      version: "0.66.17",
      splitRole: "pipeline_host",
      splitGroup: {
        model: "DeepSeek-R1-Distill-70B-Q4_K_M",
        hostId: "029fb6049c",
        peerIds: ["029fb6049c", "1024286234", "69a300b28e"],
        totalGroupVramGb: 148.4,
      },
      moeShard: null,
      pipelineDegraded: false,
      meshVisibility: null,
    };
    const msi: NodeSummary = {
      ...lyu,
      id: "69a300b28e",
      hostname: "MSI",
      role: "Worker",
      state: "loading",
      splitRole: "pipeline_worker",
      capability: { ...lyu.capability, vramGb: 8, loadedModels: [] },
    };
    const mba: NodeSummary = {
      ...lyu,
      id: "1024286234",
      hostname: "MBA",
      role: "Worker",
      state: "loading",
      splitRole: "pipeline_worker",
      capability: { ...lyu.capability, vramGb: 18, loadedModels: [] },
    };
    const result = applyPipelineHealthGate(
      [lyu, msi, mba],
      ["DeepSeek-R1-Distill-70B-Q4_K_M"],
    );
    const lyuOut = result.nodes.find((n) => n.hostname === "LYU");
    expect(lyuOut?.state).toBe("loading");
    expect(lyuOut?.capability.loadedModels).toEqual([]);
    expect(lyuOut?.pipelineDegraded).toBe(true);
    expect(result.models).toEqual([]);
  });

  test("leaves a healthy pipeline alone (all workers serving)", () => {
    const host: NodeSummary = {
      id: "host_xxx",
      hostname: "HOST",
      isSelf: false,
      role: "Host",
      state: "serving",
      vramGb: 64,
      servingModels: ["BigModel-Q4"],
      capability: {
        backend: "metal",
        vendor: "apple",
        computeClass: "hi",
        vramGb: 64,
        loadedModels: ["BigModel-Q4"],
      },
      version: "0.66.18",
      splitRole: "pipeline_host",
      splitGroup: {
        model: "BigModel-Q4",
        hostId: "host_xxx",
        peerIds: ["host_xxx", "wrkr_yyyy"],
        totalGroupVramGb: 96,
      },
      moeShard: null,
      pipelineDegraded: false,
      meshVisibility: null,
    };
    const worker: NodeSummary = {
      ...host,
      id: "wrkr_yyyy",
      hostname: "WORKER",
      role: "Worker",
      state: "serving",
      splitRole: "pipeline_worker",
    };
    const result = applyPipelineHealthGate([host, worker], ["BigModel-Q4"]);
    expect(result.nodes[0].state).toBe("serving");
    expect(result.nodes[0].pipelineDegraded).toBe(false);
    expect(result.models).toEqual(["BigModel-Q4"]);
  });

  test("solo serves are never gated (no splitGroup)", () => {
    const solo: NodeSummary = {
      id: "solo_xxxxxxx",
      hostname: "SOLO",
      isSelf: false,
      role: "Host",
      state: "serving",
      vramGb: 32,
      servingModels: ["Qwen3-0.6B-Q4_K_M"],
      capability: {
        backend: "metal",
        vendor: "apple",
        computeClass: "hi",
        vramGb: 32,
        loadedModels: ["Qwen3-0.6B-Q4_K_M"],
      },
      version: "0.66.18",
      splitRole: null,
      splitGroup: null,
      moeShard: null,
      pipelineDegraded: false,
      meshVisibility: null,
    };
    const result = applyPipelineHealthGate([solo], ["Qwen3-0.6B-Q4_K_M"]);
    expect(result.nodes[0].state).toBe("serving");
    expect(result.models).toEqual(["Qwen3-0.6B-Q4_K_M"]);
  });

  test("a model served redundantly survives if at least one host is healthy", () => {
    // Solo host A is fine; pipeline host B has a stuck worker. The
    // model should still be advertised because A can route it.
    const a: NodeSummary = {
      id: "aaaaaaaaaa",
      hostname: "A",
      isSelf: false,
      role: "Host",
      state: "serving",
      vramGb: 96,
      servingModels: ["Mid-Q4"],
      capability: {
        backend: "metal",
        vendor: "apple",
        computeClass: "hi",
        vramGb: 96,
        loadedModels: ["Mid-Q4"],
      },
      version: "0.66.18",
      splitRole: null,
      splitGroup: null,
      moeShard: null,
      pipelineDegraded: false,
      meshVisibility: null,
    };
    const b: NodeSummary = {
      ...a,
      id: "bbbbbbbbbb",
      hostname: "B",
      capability: { ...a.capability, vramGb: 16 },
      splitRole: "pipeline_host",
      splitGroup: {
        model: "Mid-Q4",
        hostId: "bbbbbbbbbb",
        peerIds: ["bbbbbbbbbb", "cccccccccc"],
        totalGroupVramGb: 32,
      },
    };
    const c: NodeSummary = {
      ...b,
      id: "cccccccccc",
      hostname: "C",
      role: "Worker",
      state: "loading",
      splitRole: "pipeline_worker",
      capability: { ...b.capability, loadedModels: [] },
    };
    const result = applyPipelineHealthGate([a, b, c], ["Mid-Q4"]);
    expect(result.models).toEqual(["Mid-Q4"]);
    const bOut = result.nodes.find((n) => n.hostname === "B");
    expect(bOut?.state).toBe("loading");
    expect(bOut?.pipelineDegraded).toBe(true);
    const aOut = result.nodes.find((n) => n.hostname === "A");
    expect(aOut?.state).toBe("serving");
    expect(aOut?.pipelineDegraded).toBe(false);
  });

  // Regression for the May 13 split-brain mode: every peer in the cohort
  // is `role: Worker`, `state: loading`, `splitRole: pipeline_worker`.
  // The host-only branch of the gate did nothing for them, so the public
  // page rendered three "Loading" cards with no diagnostic and the
  // catalog kept the model in `models[]`. After the fix the WORKERS get
  // pipelineDegraded=true (so the page can name the deadlock) and the
  // model is dropped from the catalog because no node is serving it.
  test("downgrades pipeline_worker peers when no member of the cohort is serving", () => {
    const baseCap = {
      backend: "cuda",
      vendor: "nvidia",
      computeClass: "mid",
      vramGb: 16,
      loadedModels: [] as string[],
    };
    const sg = {
      model: "DeepSeek-R1-Distill-70B-Q4_K_M",
      hostId: "029fb6049c",
      peerIds: ["029fb6049c", "1024286234", "69a300b28e"],
      totalGroupVramGb: 148.4,
    };
    const lyu: NodeSummary = {
      id: "029fb6049c",
      hostname: "LYU",
      isSelf: false,
      role: "Worker",
      state: "loading",
      vramGb: 106,
      servingModels: ["DeepSeek-R1-Distill-70B-Q4_K_M"],
      capability: { ...baseCap, vramGb: 16 },
      version: "0.66.17",
      splitRole: "pipeline_worker",
      splitGroup: sg,
      moeShard: null,
      pipelineDegraded: false,
      meshVisibility: null,
    };
    const msi: NodeSummary = {
      ...lyu,
      id: "69a300b28e",
      hostname: "MSI",
      capability: { ...baseCap, vramGb: 8 },
    };
    const mba: NodeSummary = {
      ...lyu,
      id: "1024286234",
      hostname: "MBA",
      capability: { ...baseCap, vramGb: 18 },
    };
    const result = applyPipelineHealthGate(
      [lyu, msi, mba],
      ["DeepSeek-R1-Distill-70B-Q4_K_M"],
    );
    for (const n of result.nodes) {
      expect(n.pipelineDegraded).toBe(true);
      expect(n.capability.loadedModels).toEqual([]);
    }
    expect(result.models).toEqual([]);
  });

  // Mirror of the regression: a worker whose cohort IS healthy must NOT
  // get the degraded treatment. Otherwise the gate would over-fire on
  // every routine pipeline serve and turn green peers amber.
  test("leaves pipeline_worker peers alone when every cohort member is serving", () => {
    const cap = {
      backend: "metal",
      vendor: "apple",
      computeClass: "hi",
      vramGb: 64,
      loadedModels: ["BigModel-Q4"],
    };
    const sg = {
      model: "BigModel-Q4",
      hostId: "host_xxxxx",
      peerIds: ["host_xxxxx", "wrkr_yyyyy"],
      totalGroupVramGb: 96,
    };
    const host: NodeSummary = {
      id: "host_xxxxx",
      hostname: "HOST",
      isSelf: false,
      role: "Host",
      state: "serving",
      vramGb: 64,
      servingModels: ["BigModel-Q4"],
      capability: cap,
      version: "0.66.18",
      splitRole: "pipeline_host",
      splitGroup: sg,
      moeShard: null,
      pipelineDegraded: false,
      meshVisibility: null,
    };
    const worker: NodeSummary = {
      ...host,
      id: "wrkr_yyyyy",
      hostname: "WORKER",
      role: "Worker",
      state: "serving",
      splitRole: "pipeline_worker",
    };
    const result = applyPipelineHealthGate([host, worker], ["BigModel-Q4"]);
    expect(result.nodes.find((n) => n.hostname === "WORKER")?.pipelineDegraded).toBe(false);
    expect(result.nodes.find((n) => n.hostname === "HOST")?.pipelineDegraded).toBe(false);
    expect(result.models).toEqual(["BigModel-Q4"]);
  });
});
