import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "./model-catalog";
import {
  estimateVram,
  inferFamily,
  mapRuntimeCatalog,
  type RuntimeCatalogEntry,
} from "./catalog-merge";

describe("inferFamily", () => {
  it("maps known ids to their family", () => {
    expect(inferFamily("Qwen3-8B-Q4_K_M")).toBe("qwen");
    expect(inferFamily("Llama-3.2-3B-Instruct-Q4_K_M")).toBe("llama");
    expect(inferFamily("Gemma-3-12B-it-Q4_K_M")).toBe("gemma");
    expect(inferFamily("GLM-4.7-Flash-Q4_K_M")).toBe("glm");
    expect(inferFamily("Mixtral-8x7B-Instruct-v0.1-Q4_K_M")).toBe("mistral");
    expect(inferFamily("DeepSeek-R1-Distill-70B-Q4_K_M")).toBe("deepseek");
  });

  it("falls back to qwen for unrecognised ids", () => {
    expect(inferFamily("Some-New-Model-Q4_K_M")).toBe("qwen");
  });
});

describe("estimateVram", () => {
  it("rounds up with headroom and never returns below 1", () => {
    expect(estimateVram(5)).toBe(6);
    expect(estimateVram(0)).toBe(1);
    expect(estimateVram(17.3)).toBe(20);
  });
});

describe("mapRuntimeCatalog", () => {
  it("prefers the curated snapshot row when the id is recognised", () => {
    const curated = MODEL_CATALOG.find((m) => m.id === "Qwen3-8B-Q4_K_M")!;
    const result = mapRuntimeCatalog(
      [{ id: "Qwen3-8B-Q4_K_M", sizeGb: 5, description: "runtime terse copy" }],
      MODEL_CATALOG,
    );
    expect(result).toHaveLength(1);
    // Curated description/minVramGb win over the runtime's terse fields.
    expect(result[0]).toEqual(curated);
    expect(result[0].description).not.toBe("runtime terse copy");
  });

  it("synthesises a row for a runtime-listed model the site has no copy for", () => {
    const result = mapRuntimeCatalog(
      [
        {
          id: "Gemma-4-31B-it-Q4_K_M",
          sizeGb: 18,
          description: "brand new",
          vision: true,
        },
      ],
      MODEL_CATALOG,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "Gemma-4-31B-it-Q4_K_M",
      name: "Gemma-4-31B-it-Q4_K_M",
      family: "gemma",
      sizeGb: 18,
      minVramGb: estimateVram(18),
      description: "brand new",
      vision: true,
    });
  });

  it("drops entries without an id and honours runtime ordering/omission", () => {
    const entries: RuntimeCatalogEntry[] = [
      { id: "Qwen3-8B-Q4_K_M", sizeGb: 5 },
      { sizeGb: 3 }, // no id → dropped
    ];
    const result = mapRuntimeCatalog(entries, MODEL_CATALOG);
    expect(result.map((m) => m.id)).toEqual(["Qwen3-8B-Q4_K_M"]);
  });
});
