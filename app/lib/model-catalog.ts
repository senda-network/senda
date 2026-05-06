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
    id: "Qwen3-32B-Q4_K_M",
    name: "Qwen 3 · 32B",
    family: "qwen",
    sizeGb: 20,
    minVramGb: 24,
    description:
      "Largest dense Qwen 3. Strong reasoning with thinking-mode, fits on a single 24 GB card or pools nicely across two mid-range contributors.",
  },
  {
    id: "Qwen2.5-Coder-32B-Instruct-Q4_K_M",
    name: "Qwen 2.5 Coder · 32B Instruct",
    family: "qwen",
    sizeGb: 20,
    minVramGb: 24,
    description:
      "Top-tier open coding model — comparable to GPT-4o on code benchmarks. The natural upgrade from the 7B coder when you have a 24 GB card or two mid-range contributors.",
  },
  {
    id: "Llama-3.3-70B-Instruct-Q4_K_M",
    name: "Llama 3.3 · 70B Instruct",
    family: "llama",
    sizeGb: 40,
    minVramGb: 48,
    description:
      "Meta's frontier dense 70B. Broad tool ecosystem support. Needs a 48 GB box or two ~24 GB contributors pooling.",
  },
  {
    id: "DeepSeek-R1-Distill-70B-Q4_K_M",
    name: "DeepSeek R1 Distill · 70B",
    family: "deepseek",
    sizeGb: 43,
    minVramGb: 48,
    description:
      "Same 70B footprint as Llama 3.3, swapped for a thinking-mode reasoner distilled from DeepSeek-R1. Trades latency for stronger math and step-by-step problem solving.",
  },
  {
    id: "Qwen2.5-72B-Instruct-Q4_K_M",
    name: "Qwen 2.5 · 72B Instruct",
    family: "qwen",
    sizeGb: 47,
    minVramGb: 56,
    description:
      "Qwen's flagship dense in this size class — the real frontier Qwen at 72B. Comfortable across two ~32 GB contributors and a great showcase for tensor-split inference.",
  },
  {
    id: "Qwen3-Coder-Next-Q4_K_M",
    name: "Qwen 3 · Coder Next (~85B)",
    family: "qwen",
    sizeGb: 48,
    minVramGb: 56,
    description:
      "Frontier open-source coding model — ~85B dense, beats Qwen 2.5 Coder 32B by a real margin on agentic and tool-use benchmarks. Multi-part GGUF that splits cleanly across two beefy contributors.",
  },
  {
    id: "Mixtral-8x22B-Instruct-Q4_K_M",
    name: "Mixtral · 8x22B Instruct",
    family: "mistral",
    sizeGb: 86,
    minVramGb: 96,
    description:
      "Mistral's larger mixture-of-experts: 141B params, ~39B active per token. The realistic 'a few people pooling capacity' showcase — three or four contributors and you're running it.",
  },
  {
    id: "Qwen3-235B-A22B-Q4_K_M",
    name: "Qwen 3 · 235B (A22B MoE)",
    family: "qwen",
    sizeGb: 142,
    minVramGb: 144,
    description:
      "Frontier-class mixture-of-experts: 235B params, ~22B active per token. Won't fit on any single laptop — this is the model that demonstrates what the mesh is for.",
  },
];
