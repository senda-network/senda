import { describe, expect, it } from "vitest";
import {
  MIN_PIPELINE_ELECTION_PEER_VERSION,
  peerSupportsPipelineElection,
} from "./pipeline-election-version";

describe("peerSupportsPipelineElection", () => {
  it("accepts current runtimes", () => {
    expect(peerSupportsPipelineElection("0.66.52")).toBe(true);
    expect(peerSupportsPipelineElection("0.66.20")).toBe(true);
  });

  it("rejects Eleven-shaped stale runtime", () => {
    expect(peerSupportsPipelineElection("0.66.18")).toBe(false);
  });

  it("rejects missing version", () => {
    expect(peerSupportsPipelineElection(null)).toBe(false);
    expect(peerSupportsPipelineElection("")).toBe(false);
  });

  it("min constant matches runtime", () => {
    expect(MIN_PIPELINE_ELECTION_PEER_VERSION).toBe("0.66.20");
  });
});
