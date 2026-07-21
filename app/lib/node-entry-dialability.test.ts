import { describe, expect, it } from "vitest";
import { nodeLooksServingButUndialable } from "./node-entry-dialability";
import type { NodeSummary } from "./use-mesh-status";

function makeNode(overrides: Partial<NodeSummary> = {}): NodeSummary {
  return {
    id: "peer123456",
    hostname: "Elevens-MacBook-Air.local",
    isSelf: false,
    role: "Host",
    state: "standby",
    vramGb: 24,
    servingModels: ["Qwen3-8B-Q4_K_M"],
    capability: {
      backend: "metal",
      vendor: "apple",
      computeClass: "hi",
      vramGb: 24,
      loadedModels: ["Qwen3-8B-Q4_K_M"],
    },
    version: "0.66.80",
    splitRole: null,
    splitGroup: null,
    moeShard: null,
    meshVisibility: null,
    rttMs: null,
    ...overrides,
  };
}

describe("nodeLooksServingButUndialable", () => {
  it("flags a remote host with loaded model and null RTT", () => {
    expect(nodeLooksServingButUndialable(makeNode())).toBe(true);
  });

  it("ignores self even with null RTT", () => {
    expect(nodeLooksServingButUndialable(makeNode({ isSelf: true }))).toBe(false);
  });

  it("ignores peers with measured RTT", () => {
    expect(nodeLooksServingButUndialable(makeNode({ rttMs: 149 }))).toBe(false);
  });

  it("ignores legacy payloads without rttMs", () => {
    expect(nodeLooksServingButUndialable(makeNode({ rttMs: undefined }))).toBe(
      false,
    );
  });

  it("ignores pipeline workers", () => {
    expect(
      nodeLooksServingButUndialable(
        makeNode({ splitRole: "pipeline_worker", state: "loading" }),
      ),
    ).toBe(false);
  });

  it("ignores peers still loading without a loaded model", () => {
    expect(
      nodeLooksServingButUndialable(
        makeNode({
          state: "loading",
          capability: {
            backend: "metal",
            vendor: "apple",
            computeClass: "hi",
            vramGb: 24,
            loadedModels: [],
          },
        }),
      ),
    ).toBe(false);
  });

  it("ignores idle peers with no serving intent", () => {
    expect(
      nodeLooksServingButUndialable(
        makeNode({ servingModels: [], capability: { ...makeNode().capability, loadedModels: [] } }),
      ),
    ).toBe(false);
  });
});
