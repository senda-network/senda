import { describe, expect, it } from "vitest";
import {
  isChatViableMeshModel,
  neededSoloVramGb,
  peerIsReadyHost,
  withMeshOfferFlags,
} from "./chat-viable-mesh-models";

const GEMMA = "google_gemma-3-27b-it-Q4_K_M";
const QWEN = "Qwen3-8B-Q4_K_M";

describe("neededSoloVramGb", () => {
  it("prefers mesh_fit, then catalog minVram for Gemma (~20)", () => {
    expect(
      neededSoloVramGb({
        name: GEMMA,
        mesh_fit: { needed_vram_gb: 18.7 },
      }),
    ).toBeCloseTo(18.7);
    expect(neededSoloVramGb({ name: "Gemma-3-27B-it-Q4_K_M" })).toBe(20);
  });
});

describe("peerIsReadyHost / isChatViableMeshModel", () => {
  const elevens = {
    hostname: "Elevens-MacBook-Air.local",
    rtt_ms: 139,
    state: "serving",
    serving_models: [GEMMA],
    vram_gb: 24,
  };
  const lyuLoading = {
    hostname: "LYU",
    rtt_ms: 151,
    state: "loading",
    serving_models: [GEMMA],
    vram_gb: 13,
  };
  const senda = {
    hostname: "0xSenda",
    rtt_ms: 150,
    state: "serving",
    serving_models: [QWEN],
    vram_gb: 13.5,
  };

  it("rejects undersized loading host for Gemma", () => {
    expect(
      peerIsReadyHost(
        lyuLoading,
        { name: GEMMA, status: "warm", node_count: 1, active_nodes: ["LYU"] },
        "entry",
      ),
    ).toBe(false);
  });

  it("accepts Elevens serving Gemma with enough VRAM", () => {
    expect(
      peerIsReadyHost(
        elevens,
        {
          name: GEMMA,
          status: "warm",
          node_count: 1,
          active_nodes: ["Elevens-MacBook-Air.local"],
        },
        "entry",
      ),
    ).toBe(true);
  });

  it("LYU-only loading mesh is not chat-viable; Elevens makes it viable", () => {
    const model = {
      name: GEMMA,
      status: "warm" as const,
      node_count: 2,
      active_nodes: ["LYU", "Elevens-MacBook-Air.local"],
    };
    expect(isChatViableMeshModel(model, [lyuLoading], "entry")).toBe(false);
    expect(isChatViableMeshModel(model, [lyuLoading, elevens], "entry")).toBe(
      true,
    );
  });

  it("keeps Qwen chat-viable on a mid-size serving peer", () => {
    expect(
      isChatViableMeshModel(
        {
          name: QWEN,
          status: "warm",
          node_count: 1,
          active_nodes: ["0xSenda"],
        },
        [senda],
        "entry",
      ),
    ).toBe(true);
  });

  it("rejects undialable serving host", () => {
    expect(
      isChatViableMeshModel(
        {
          name: GEMMA,
          status: "warm",
          node_count: 1,
          active_nodes: ["Elevens-MacBook-Air.local"],
        },
        [{ ...elevens, rtt_ms: null }],
        "entry",
      ),
    ).toBe(false);
  });
});

describe("withMeshOfferFlags", () => {
  it("sets selectable without chat_viable when only loading undersized host", () => {
    const out = withMeshOfferFlags(
      [
        {
          name: GEMMA,
          status: "warm",
          node_count: 1,
          active_nodes: ["LYU"],
          size_gb: 17,
        },
      ],
      [
        {
          hostname: "LYU",
          rtt_ms: 151,
          state: "loading",
          serving_models: [GEMMA],
          vram_gb: 13,
        },
      ],
      "entry",
    );
    expect(out[0].selectable).toBe(true);
    expect(out[0].chat_viable).toBe(false);
  });
});
