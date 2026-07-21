import { describe, expect, it } from "vitest";
import {
  isSelectableMeshModel,
  peerIsDialable,
  withSelectableFlags,
} from "./selectable-mesh-models";

describe("peerIsDialable", () => {
  it("treats self as dialable even without RTT", () => {
    expect(
      peerIsDialable("0xSenda", [{ hostname: "0xSenda", rtt_ms: null }], "0xSenda"),
    ).toBe(true);
  });

  it("requires measured RTT for remote peers", () => {
    expect(
      peerIsDialable(
        "Elevens-MacBook-Air.local",
        [{ hostname: "Elevens-MacBook-Air.local", rtt_ms: null }],
        "ip-172-26-3-91",
      ),
    ).toBe(false);
    expect(
      peerIsDialable(
        "0xSenda",
        [{ hostname: "0xSenda", rtt_ms: 149 }],
        "ip-172-26-3-91",
      ),
    ).toBe(true);
  });
});

describe("isSelectableMeshModel", () => {
  const peers = [
    { hostname: "0xSenda", rtt_ms: 149 },
    { hostname: "Elevens-MacBook-Air.local", rtt_ms: null },
  ];

  it("rejects cold inventory", () => {
    expect(
      isSelectableMeshModel(
        {
          name: "Qwen3-32B-Q4_K_M",
          status: "cold",
          node_count: 0,
          active_nodes: [],
        },
        peers,
        "ip-172-26-3-91",
      ),
    ).toBe(false);
  });

  it("accepts warm models on a dialable host", () => {
    expect(
      isSelectableMeshModel(
        {
          name: "Qwen3-8B-Q4_K_M",
          status: "warm",
          node_count: 1,
          active_nodes: ["0xSenda"],
        },
        peers,
        "ip-172-26-3-91",
      ),
    ).toBe(true);
  });

  it("rejects warm models whose only host has no RTT", () => {
    expect(
      isSelectableMeshModel(
        {
          name: "google_gemma-3-27b-it-Q4_K_M",
          status: "warm",
          node_count: 1,
          active_nodes: ["Elevens-MacBook-Air.local"],
        },
        peers,
        "ip-172-26-3-91",
      ),
    ).toBe(false);
  });

  it("allows a model when the only host is self", () => {
    expect(
      isSelectableMeshModel(
        {
          name: "google_gemma-3-27b-it-Q4_K_M",
          status: "warm",
          node_count: 1,
          active_nodes: ["Elevens-MacBook-Air.local"],
        },
        [{ hostname: "Elevens-MacBook-Air.local", rtt_ms: null }],
        "Elevens-MacBook-Air.local",
      ),
    ).toBe(true);
  });
});

describe("withSelectableFlags", () => {
  it("flags each row without dropping cold models", () => {
    const out = withSelectableFlags(
      [
        {
          name: "Qwen3-8B-Q4_K_M",
          status: "warm",
          node_count: 1,
          active_nodes: ["0xSenda"],
        },
        {
          name: "DeepSeek-R1-Distill-70B-Q4_K_M",
          status: "cold",
          node_count: 0,
          active_nodes: [],
        },
      ],
      [{ hostname: "0xSenda", rtt_ms: 40 }],
      "entry",
    );
    expect(out).toHaveLength(2);
    expect(out[0].selectable).toBe(true);
    expect(out[1].selectable).toBe(false);
  });
});
