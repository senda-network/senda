import { describe, expect, test } from "vitest";
import {
  isPublicDeploymentClient,
  isPublicDeploymentServer,
} from "./deployment";

/**
 * Tests for the shared deployment-flag helpers.
 *
 * The skew this fixes used to be:
 *  - `proxy.ts` ignored `FORGEMESH_DEPLOYMENT`
 *  - `_lib.ts` ignored `NEXT_PUBLIC_CLOSEDMESH_DEPLOYMENT`
 *  - `runtime-target.ts` (browser) couldn't see server-only names at all
 *
 * Pin the canonical sets so a future "let's add another env name"
 * change has to add it here (and update every layer at once) instead
 * of in one spot.
 */

describe("isPublicDeploymentClient", () => {
  test("matches NEXT_PUBLIC_DEPLOYMENT=public", () => {
    expect(isPublicDeploymentClient({ NEXT_PUBLIC_DEPLOYMENT: "public" })).toBe(
      true,
    );
  });

  test("matches NEXT_PUBLIC_CLOSEDMESH_DEPLOYMENT=public", () => {
    expect(
      isPublicDeploymentClient({ NEXT_PUBLIC_CLOSEDMESH_DEPLOYMENT: "public" }),
    ).toBe(true);
  });

  test("ignores server-only names (browser bundles can't see them)", () => {
    expect(
      isPublicDeploymentClient({
        CLOSEDMESH_DEPLOYMENT: "public",
        FORGEMESH_DEPLOYMENT: "public",
      }),
    ).toBe(false);
  });

  test("trims trailing newlines (Vercel env-var pitfall)", () => {
    expect(
      isPublicDeploymentClient({ NEXT_PUBLIC_DEPLOYMENT: "public\n" }),
    ).toBe(true);
  });

  test("returns false for unset / empty / non-`public` values", () => {
    expect(isPublicDeploymentClient({})).toBe(false);
    expect(isPublicDeploymentClient({ NEXT_PUBLIC_DEPLOYMENT: "" })).toBe(
      false,
    );
    expect(isPublicDeploymentClient({ NEXT_PUBLIC_DEPLOYMENT: "true" })).toBe(
      false,
    );
  });
});

describe("isPublicDeploymentServer", () => {
  test("matches every accepted env name", () => {
    for (const key of [
      "NEXT_PUBLIC_DEPLOYMENT",
      "NEXT_PUBLIC_CLOSEDMESH_DEPLOYMENT",
      "CLOSEDMESH_DEPLOYMENT",
      "FORGEMESH_DEPLOYMENT",
    ]) {
      expect(isPublicDeploymentServer({ [key]: "public" })).toBe(true);
    }
  });

  test("is a superset of the client variant", () => {
    const env = { NEXT_PUBLIC_CLOSEDMESH_DEPLOYMENT: "public" };
    expect(isPublicDeploymentClient(env)).toBe(true);
    expect(isPublicDeploymentServer(env)).toBe(true);
  });

  test("returns false when nothing is set", () => {
    expect(isPublicDeploymentServer({})).toBe(false);
  });

  test("trims trailing newlines on server-only names too", () => {
    expect(
      isPublicDeploymentServer({ CLOSEDMESH_DEPLOYMENT: "public\n" }),
    ).toBe(true);
  });
});
