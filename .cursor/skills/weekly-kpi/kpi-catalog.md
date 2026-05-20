# ClosedMesh KPI catalog

Reference for choosing weekly headline metrics.

**Default for company weekly (exec + peer eng + board):** see [SKILL.md](SKILL.md) § “Default KPI pair” — **primary: flagship p50 tok/s (Δ)**, **secondary: contributor count**, **context: pooled VRAM + backends**.

## Tier 1 — Best for mixed company audience (outcome + trend)

| KPI | Why | Week-over-week |
|-----|-----|----------------|
| Median decode speed (flagship model, mesh p50) | Shows the mesh got faster | Up = better hardware, runtime, routing |
| Time to first token (best peer for model) | User-facing latency | Down = UX win |
| Contributors serving flagship model | Redundancy vs “N machines joined” | Up = survives one peer sleeping |
| Successful route rate | Product works end-to-end | Up = capability + catalog coverage |
| Pooled mesh VRAM (GB) | Capacity story in one number | Up = bigger models feasible |

**Default headline:** `Qwen3-32B-Q4_K_M: {tps} tok/s (p50), {ttft}s TTFT (best), {n} contributors`

## Tier 2 — Heterogeneous P2P differentiator

| KPI | Story |
|-----|--------|
| Backend diversity count | “Any hardware joins” (metal, CUDA, Vulkan, CPU) |
| Largest model served solo | Capacity milestone |
| Active speculative draft+verifier pairs | Multi-peer mode that pays off on WAN |
| Models with ≥2 contributors | Marketplace redundancy |

## Tier 3 — Shipping / product

| KPI | Story |
|-----|--------|
| Runtime + desktop release version + peer upgrade % | Operability |
| Heterogeneous validation phase (0–4) | Concrete engineering milestone |
| Public mesh contributor count (exclude entry nodes) | External traction |
| Install → serving time on fresh machine | Onboarding (“boss’s GPU”) |

## Anti-patterns

- **Topology only:** “4 machines mesh, model X” — use as context, not the headline.
- **Fake precision:** Reporting `0 tok/s` when the key is missing (means not measured yet).
- **Stale smoke output:** Smoke scripts do not write history; re-run or use `internal/kpi/` snapshots.

## Field mapping (`/api/status`)

| Report term | JSON / UI source |
|-------------|------------------|
| Contributor count (model) | Peers with model in `serving_models` / `capability.loadedModels` |
| p50 tok/s | `measured_tps_p50_by_model[model]` per peer → median in status catalog |
| Best TTFT | `measured_ttft_ms_p50_by_model[model]` → minimum across peers |
| Peer count | `len(peers)` (admin) or status page node list |
| Pooled VRAM | Sum of `capability.vram_gb` / `vram_gb` across contributors |
| `no_capable_node` | HTTP 503 from `/api/chat` with `reason_code` (validation runbook) |
