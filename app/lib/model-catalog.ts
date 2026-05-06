/**
 * Curated catalog of models we know the ClosedMesh runtime can pull.
 *
 * Hand-maintained for now — once the runtime exposes a /v1/models/catalog
 * endpoint we can swap this out for a fetch. Keeping it client-side keeps
 * the Models page snappy even with no runtime online.
 */

export type CatalogModel = {
  id: string;
  name: string;
  family: "qwen" | "llama" | "mistral" | "phi" | "gemma" | "deepseek";
  sizeGb: number;
  /** Memory the runtime needs to actually serve this model at Q4_K_M. */
  minVramGb: number;
  description: string;
  recommended?: boolean;
  cpuOk?: boolean;
};

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: "Qwen3-0.6B-Q4_K_M",
    name: "Qwen 3 · 0.6B",
    family: "qwen",
    sizeGb: 0.4,
    minVramGb: 1,
    description:
      "Tiny smoke-test model. Boots in seconds; useful for verifying the mesh end-to-end before pulling something heavier.",
    cpuOk: true,
  },
  {
    id: "Llama-3.2-3B-Instruct-Q4_K_M",
    name: "Llama 3.2 · 3B Instruct",
    family: "llama",
    sizeGb: 2,
    minVramGb: 3,
    description:
      "Meta's smallest instruct. The natural step up from the Qwen smoke test — runs on CPU-only laptops but handles real chat.",
    cpuOk: true,
  },
  {
    id: "Qwen3-8B-Q4_K_M",
    name: "Qwen 3 · 8B",
    family: "qwen",
    sizeGb: 5,
    minVramGb: 8,
    description:
      "ClosedMesh's reference demo model. Strong reasoning and code, runs comfortably on a 16GB Mac or a mid-range GPU.",
    recommended: true,
  },
  {
    id: "Llama-3.1-8B-Instruct-Q4_K_M",
    name: "Llama 3.1 · 8B Instruct",
    family: "llama",
    sizeGb: 5,
    minVramGb: 8,
    description:
      "Meta's instruction-tuned 8B. Wide tool ecosystem, great default for chat.",
  },
  {
    id: "Qwen2.5-Coder-7B-Instruct-Q4_K_M",
    name: "Qwen 2.5 Coder · 7B Instruct",
    family: "qwen",
    sizeGb: 4.7,
    minVramGb: 8,
    description:
      "Coding-specialized 7B. Pair it with the OpenAI-compatible endpoint to use ClosedMesh as a local backend for editors and agents.",
  },
  {
    id: "Mistral-7B-Instruct-Q4_K_M",
    name: "Mistral · 7B Instruct",
    family: "mistral",
    sizeGb: 4.5,
    minVramGb: 6,
    description:
      "Lighter on memory than other 8B models with strong instruction-following. Good for laptops without a discrete GPU.",
  },
  {
    id: "Phi-3-mini-4k-Q4_K_M",
    name: "Phi-3 mini · 4K",
    family: "phi",
    sizeGb: 2.5,
    minVramGb: 4,
    description:
      "Microsoft's compact model. Punches above its weight, runs on CPU-only mesh nodes.",
    cpuOk: true,
  },
  {
    id: "Gemma-2-9B-it-Q4_K_M",
    name: "Gemma 2 · 9B",
    family: "gemma",
    sizeGb: 5.5,
    minVramGb: 10,
    description:
      "Google's 9B with strong multilingual + reasoning chops. A bit chunkier than 8B class.",
  },
  {
    id: "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M",
    name: "DeepSeek R1 Distill · Qwen 14B",
    family: "deepseek",
    sizeGb: 9,
    minVramGb: 12,
    description:
      "Reasoning model distilled from DeepSeek-R1 onto a Qwen 14B base. Thinks step-by-step before answering — trades latency for stronger math and code.",
  },
  {
    id: "Mixtral-8x7B-Instruct-v0.1-Q4_K_M",
    name: "Mixtral · 8x7B Instruct",
    family: "mistral",
    sizeGb: 26,
    minVramGb: 32,
    description:
      "Mistral's mixture-of-experts: 47B params, ~13B active per token. Too big for one laptop, well within reach for two or three mesh contributors.",
  },
  {
    id: "Llama-3.3-70B-Instruct-Q4_K_M",
    name: "Llama 3.3 · 70B Instruct",
    family: "llama",
    sizeGb: 40,
    minVramGb: 48,
    description:
      "Meta's frontier 70B. Comparable quality to Qwen3 72B with a broader tool ecosystem. Needs a 48 GB box or a few mesh contributors.",
  },
  {
    id: "Qwen3-72B-Q4_K_M",
    name: "Qwen 3 · 72B",
    family: "qwen",
    sizeGb: 40,
    minVramGb: 48,
    description:
      "Frontier-class. Needs a 48 GB+ card or a multi-GPU mesh. If no machine in your mesh is big enough, chat will tell you and suggest a smaller model.",
  },
];
