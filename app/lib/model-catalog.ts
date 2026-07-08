/**
 * Curated catalog of models we know the Senda runtime can pull.
 *
 * Hand-maintained for now — once the runtime exposes a /v1/models/catalog
 * endpoint we can swap this out for a fetch. Keeping it client-side keeps
 * the Models page snappy even with no runtime online.
 *
 * ─── A note on memory accounting ──────────────────────────────────────
 *
 * `minVramGb` is *usable GPU-allocatable memory*, not system RAM. It's
 * compared directly against the runtime's reported `vramGb`, which the
 * controller already pre-adjusts per backend:
 *
 *   • CUDA / ROCm: `vramGb` = the card's nameplate VRAM (e.g. an RTX
 *     3090 reports ~24 GB and you really do get 24 GB).
 *   • Metal (Apple Silicon): `vramGb` = the IOGPU wired-memory budget,
 *     which macOS caps at roughly 75 % of unified memory by default
 *     (`iogpu.wired_limit_mb`). So a 32 GB Mac reports ~24 GB, a 48 GB
 *     Mac reports ~36 GB, a 64 GB Mac reports ~48 GB, etc.
 *
 * That mapping is why human-readable descriptions below distinguish
 * "24 GB GPU" (CUDA card) from a "32 GB Mac" (system spec, ~24 GB
 * usable to Metal). Conflating the two is the most common way to
 * mislead a user about whether a model will actually fit, so when in
 * doubt, quote the *system-RAM* number for Macs (it's what users see
 * in About This Mac) and the *VRAM* number for discrete GPUs.
 */

export type CatalogModel = {
  id: string;
  name: string;
  family: "qwen" | "llama" | "mistral" | "phi" | "gemma" | "deepseek" | "glm";
  sizeGb: number;
  /**
   * Usable GPU-allocatable memory the runtime needs to serve this
   * model. Compared directly against the runtime's reported `vramGb`
   * (already Metal-budget-adjusted on Apple Silicon — see file header).
   * For Mac users, multiply by ~1.33 to get the system-RAM equivalent
   * (e.g. minVramGb 24 ≈ a 32 GB+ Mac, minVramGb 48 ≈ a 64 GB+ Mac).
   */
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
      "Senda's reference demo model. Strong reasoning and code, runs comfortably on a 16GB Mac or a mid-range GPU.",
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
      "Coding-specialized 7B. Pair it with the OpenAI-compatible endpoint to use Senda as a local backend for editors and agents.",
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
    id: "Gemma-3-27B-it-Q4_K_M",
    name: "Gemma 3 · 27B",
    family: "gemma",
    sizeGb: 17,
    minVramGb: 20,
    description:
      "Google Gemma 3 27B — strong all-around reasoning. Fits on a 24 GB GPU or a 28 GB+ Mac, or pools across two mid-range contributors (e.g. an 18 GB Mac + an 8 GB GPU at the bare minimum).",
  },
  {
    id: "Qwen3-30B-A3B-Q4_K_M",
    name: "Qwen 3 · 30B A3B (MoE)",
    family: "qwen",
    sizeGb: 17.3,
    minVramGb: 20,
    description:
      "Mixture-of-experts: 30B total, ~3B active per token, 128 experts top-8. Senda splits by expert with zero per-token cross-node traffic — pools well across two contributors as long as each can hold the shared trunk (~6 GB) plus its expert shard.",
  },
  {
    id: "GLM-4.7-Flash-Q4_K_M",
    name: "GLM 4.7 · Flash (MoE)",
    family: "glm",
    sizeGb: 18,
    minVramGb: 20,
    description:
      "Mixture-of-experts: 30B total, ~3B active per token, 64 experts top-4. The smallest min-experts-per-node of any MoE in the catalog, so it pools well across asymmetric nodes — an 18 GB Mac + an 8 GB laptop GPU is enough. Fast inference, tool calling.",
  },
  {
    id: "Qwen3-Coder-30B-A3B-Instruct-Q4_K_M",
    name: "Qwen 3 Coder · 30B A3B (MoE)",
    family: "qwen",
    sizeGb: 18.6,
    minVramGb: 22,
    description:
      "Coding-specialised mixture-of-experts — same architecture as Qwen 3 30B A3B but post-trained for agentic coding and tool use. Drop-in upgrade from Qwen 2.5 Coder 7B when you have a 24 GB+ GPU or two contributors to pool.",
  },
  {
    id: "GLM-4-32B-0414-Q4_K_M",
    name: "GLM 4 · 32B",
    family: "glm",
    sizeGb: 19.7,
    minVramGb: 24,
    description:
      "GLM 4 32B — strong dense generalist with solid tool calling. Same hardware envelope as Qwen 3 32B: 24 GB GPU, 36 GB+ Mac, or two mid-range contributors pooling.",
  },
  {
    id: "Qwen3-32B-Q4_K_M",
    name: "Qwen 3 · 32B",
    family: "qwen",
    sizeGb: 20,
    minVramGb: 24,
    description:
      "Largest dense Qwen 3. Strong reasoning with thinking-mode, fits on a 24 GB GPU or a 36 GB+ Mac (a 32 GB Mac is right at the Metal-budget line and may not load at long context). Also pools nicely across two mid-range contributors.",
  },
  {
    id: "Qwen2.5-Coder-32B-Instruct-Q4_K_M",
    name: "Qwen 2.5 Coder · 32B Instruct",
    family: "qwen",
    sizeGb: 20,
    minVramGb: 24,
    description:
      "Top-tier open coding model — comparable to GPT-4o on code benchmarks. The natural upgrade from the 7B coder when you have a 24 GB GPU, a 36 GB+ Mac, or two mid-range contributors to pool.",
  },
  {
    id: "Llama-3.3-70B-Instruct-Q4_K_M",
    name: "Llama 3.3 · 70B Instruct",
    family: "llama",
    sizeGb: 40,
    minVramGb: 48,
    description:
      "Meta's frontier dense 70B. Broad tool ecosystem support. Needs a 48 GB GPU, a 64 GB+ Mac (Metal caps a 64 GB Mac at ~48 GB usable — exactly the threshold), or two ~24 GB contributors pooling.",
  },
  {
    id: "DeepSeek-R1-Distill-70B-Q4_K_M",
    name: "DeepSeek R1 Distill · 70B",
    family: "deepseek",
    sizeGb: 43,
    minVramGb: 48,
    description:
      "Same 70B footprint as Llama 3.3, swapped for a thinking-mode reasoner distilled from DeepSeek-R1. Same hardware envelope: 48 GB GPU, a 64 GB+ Mac, or two ~24 GB contributors. Trades latency for stronger math and step-by-step problem solving.",
  },
  {
    id: "Qwen2.5-72B-Instruct-Q4_K_M",
    name: "Qwen 2.5 · 72B Instruct",
    family: "qwen",
    sizeGb: 47,
    minVramGb: 56,
    description:
      "Qwen's flagship dense in this size class — the real frontier Qwen at 72B. Needs a 96 GB Mac (~72 GB usable to Metal), or two contributors with ~32 GB usable each (e.g. two 48 GB Macs). A great showcase for tensor-split inference.",
  },
  {
    id: "Qwen3-Coder-Next-Q4_K_M",
    name: "Qwen 3 · Coder Next (~85B)",
    family: "qwen",
    sizeGb: 48,
    minVramGb: 56,
    description:
      "Frontier open-source coding model — ~85B dense, beats Qwen 2.5 Coder 32B by a real margin on agentic and tool-use benchmarks. Same envelope as Qwen 2.5 72B: 96 GB+ Mac solo, or two ~32 GB-usable contributors. Multi-part GGUF that splits cleanly across two beefy nodes.",
  },
  {
    id: "Mixtral-8x22B-Instruct-Q4_K_M",
    name: "Mixtral · 8x22B Instruct",
    family: "mistral",
    sizeGb: 86,
    minVramGb: 96,
    description:
      "Mistral's larger mixture-of-experts: 141B params, ~39B active per token. The realistic 'a few people pooling capacity' showcase — needs roughly four 32 GB-usable contributors (e.g. four 48 GB Macs) or three with ~32 GB+ each.",
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
