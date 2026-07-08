---
name: weekly-kpi
description: >-
  Draft and refresh Senda company weekly-report KPIs from live mesh
  status, smoke tests, and prior snapshots. Use when the user mentions
  weekly reports, internal KPIs, team progress summaries, mesh metrics,
  tok/s, TTFT, contributor counts, or wants to compare week-over-week.
---

# Senda weekly KPIs

## What we are optimizing for

Company internal weekly reports need:

1. **One headline number that trends** (not a static topology snapshot).
2. **One sentence of context** (mesh size, flagship model, backends).
3. **Optional week-over-week delta** when a prior snapshot exists.

Avoid leading with static facts like “4 machines, Qwen3-32B” unless paired with a moving metric (throughput, contributors, route success).

## Default KPI pair (mixed exec / peer eng / board) — use for the next 4–8 weeks

Audience is mostly **company weekly**: executives want trend + plain outcome, peer teams want credible numbers, board/investors skim for differentiation and momentum. One headline they all understand beats a menu of metrics.

| Role | Metric | Why |
|------|--------|-----|
| **Primary** | Flagship **p50 tok/s** (week-over-week delta) | “The mesh is getting faster” — outcome, not topology. Eng can sanity-check; exec/board don’t need backend jargon. |
| **Secondary** | **Contributors** serving the flagship model | Redundancy = real product (survives one laptop sleeping). More convincing than raw machine count. |
| **Context line** (not a second headline) | Pooled VRAM (GB) + backends + mesh size | Capacity story + “any hardware” in one short line under the KPI. |

**Flagship model (fixed until you change it):** `Qwen3-32B-Q4_K_M` — team daily driver, matches prior weekly KPI.

**Headline template:**

```text
KPI: Qwen3-32B — {tps} tok/s mesh p50 ({delta}), {n} contributors ({n_delta})
Context: {peers} peers · {pooled} GB pooled · {backends}
```

**Example (first week, no prior snapshot):**

```text
KPI: Qwen3-32B — 18 tok/s mesh p50, 3 contributors
Context: 4 peers · 132 GB pooled · metal, CUDA
```

**Example (week 2+ with snapshot):**

```text
KPI: Qwen3-32B — 18 → 22 tok/s p50 (+22%), 2 → 3 contributors
Context: 4 peers · 132 → 156 GB pooled · metal, CUDA, Vulkan
```

**Do not lead with** TTFT in the headline unless latency was the main win that week (regression fix, routing change). TTFT belongs in “This week” bullets or when primary TPS is missing.

**Rotate primary only when the story changes (after ~8 weeks or a milestone):**

| Trigger | Switch primary to | Keep secondary |
|---------|-----------------|----------------|
| Heterogeneous validation / boss GPU join | Backend count in one mesh (one week) | Contributors |
| Reliability incident week | “0 `no_capable_node` on team models” | Contributors |
| Pushing 70B solo | Pooled VRAM + “largest solo serve: 70B” | Contributors |

See [kpi-catalog.md](kpi-catalog.md) for alternates; default to the pair above unless the user overrides.

## Are KPIs stored when we test?

**No dedicated KPI store in repo or CI today.**

| Source | Persisted? | Retention | Use for weekly KPI |
|--------|------------|-----------|-------------------|
| Runtime `measured_tps_p50_by_model` / `measured_ttft_ms_p50_by_model` | In-memory only | Rolling **1 hour** per peer; gossiped on `/api/status` | **Live snapshot** at report time — not historical unless you save it |
| Smoke scripts (`scripts/smoke-capability.sh`, `scripts/smoke-mesh-visibility.sh`) | **No** — stdout only | N/A | Pass/fail + eyeball; re-run to refresh |
| Heterogeneous mesh validation (`docs/heterogeneous-mesh-validation.md`) | **No** — manual runbook | N/A | Milestone KPI (“Phase 3/4 passed”) when you complete a phase |
| `senda-llm/docs/BENCHMARKS.md` | **Yes** — hand-edited markdown | Permanent in git | Reference benchmarks, not auto-updated from tests |
| GPU fingerprint (`~/.cache/senda/benchmark-fingerprint.json`) | Per-machine disk cache | Until refresh | Hardware bandwidth, not chat KPIs |
| Peer audit (`/api/peer-report` on senda.network) | Vercel in-memory | ~minutes | Mesh visibility / “claimed but invisible” — not weekly history |
| **`internal/kpi/` snapshots** | **Optional, local** — gitignored via `internal/` | You choose | **This is the intended week-over-week store** — create when drafting a report |

**Implication:** To show “18 → 22 tok/s”, someone must run a snapshot near report time (see below) and keep prior weeks under `internal/kpi/`.

## Fetch live KPIs (always do this first)

### Team / private mesh (local admin API)

Default admin URL: `http://127.0.0.1:3131` (override with `SENDA_ADMIN_URL` or script arg).

```bash
./.cursor/skills/weekly-kpi/scripts/snapshot-kpi.sh
./.cursor/skills/weekly-kpi/scripts/snapshot-kpi.sh http://127.0.0.1:3131 Qwen3-32B-Q4_K_M
./.cursor/skills/weekly-kpi/scripts/snapshot-kpi.sh --save   # writes internal/kpi/YYYY-Www.json
```

### Public mesh

```bash
./.cursor/skills/weekly-kpi/scripts/snapshot-kpi.sh https://senda.network/api/status
```

Or open https://senda.network/status — catalog rows already aggregate contributor count, median TPS, best TTFT per model.

### Manual jq (when script unavailable)

```bash
curl -fsS http://127.0.0.1:3131/api/status | jq '{
  peer_count: (.peers | length),
  contributors: [.peers[]?, .] | map(select(.capability)) | length,
  pooled_vram_gb: ([.peers[]?.capability.vram_gb? // .my_vram_gb?] | add),
  flagship_tps: .measured_tps_p50_by_model["Qwen3-32B-Q4_K_M"],
  flagship_ttft_ms: .measured_ttft_ms_p50_by_model["Qwen3-32B-Q4_K_M"]
}'
```

Replace model id with your weekly flagship. Peers need runtime **≥ v0.66.42** and recent successful inference for TPS/TTFT keys to exist (“missing” ≠ zero).

## Weekly report template

```markdown
### Senda (week YYYY-Www)

**KPI:** Qwen3-32B — {tps} tok/s mesh p50 ({delta}), {n} contributors ({n_delta})
**Context:** {peers} peers · {pooled} GB pooled · {backends}
**This week:** <2–4 bullets — shipped, validated, incidents>
**Next week target:** <one number, e.g. “3 contributors on 32B” or “22 tok/s p50”>
```

**Prose framing for mixed audience:** One line on *speed + redundancy* (KPI), not “we have 4 machines.” Optional third bullet for eng-only detail (runtime version, validation phase); keep bullets outcome-first for exec skim.

## Workflow for the agent

1. Use the **default KPI pair** above unless the user specifies otherwise.
2. Load prior week: `internal/kpi/YYYY-Www.json`, or `GET /api/kpi-snapshot?week=…` when Upstash is linked.
3. Run `snapshot-kpi.sh` (with `--save` when finalizing) or read `?latest=1`.
4. Compute deltas for `flagship.tps_p50_median` and `flagship.contributors`; context from `pooled_vram_gb`, `backends`, `peer_count`.
5. Read `git log` / PRs / validation runbook for “This week” bullets.
6. Set **next week target** on the weaker of the two metrics (usually contributors or tok/s).
7. If TPS is null, say “not measured yet” and target a short inference burst before next snapshot — never report 0.

## Smoke / validation tests (not KPI storage)

- `./scripts/smoke-capability.sh` — backend, VRAM, peer count; exit 0/1/2 only.
- `./docs/heterogeneous-mesh-validation.md` — phases 0–4; record phase completion in the weekly prose, not in CI artifacts.

Do not claim week-over-week throughput from smoke output unless you saved a snapshot.

## Production persistence (today vs recommended)

**Today there is no production database** for mesh KPIs or activity history.

| Layer | What persists | Good for history? |
|-------|---------------|-------------------|
| Entry (Lightsail) | `last-mesh` id only (~16 B on disk) | No |
| Runtime peers | 1h rolling TPS/TTFT in RAM; gossiped live | No |
| Website (`senda.network`) | `peer-report` in **lambda in-memory Map**, 5 min TTL | No — also lost across cold starts / instances |
| Website `/api/status` | Proxies live entry + merges peer reports | Point-in-time only |
| `internal/kpi/` | Local JSON via `snapshot-kpi.sh --save` | Yes, but not shared / not automated |

**Recommended next step (small, fits Vercel):** [Upstash Redis](https://upstash.com) via **Vercel KV** — already anticipated in `app/api/peer-report/store.ts` (“swap backing map for Vercel KV”). Use it for:

1. **Hourly mesh snapshots** (Vercel Cron → `GET` public `/api/status` → `SET kpi:snapshot:{iso-hour}` JSON, 90-day TTL).
2. **Weekly rollup keys** (`kpi:week:2026-W21` — copy of flagship snapshot for reports).
3. **Latest peer audit** (replace in-memory `peer-report` store so multi-instance Vercel is correct).

**Do not put this on the entry node first** — entry disk is minimal, identity rotates on restart, and the website already aggregates status + receives peer POSTs.

**Do not store:** chat prompts, completions, or per-request traces in prod (conflicts with no-signup / no central identity). Store **aggregates only**: contributor count, pooled VRAM, per-model p50 TPS / best TTFT, backends, runtime versions, `no_capable_node` rate if instrumented later.

**Skip for now:** Postgres, Mongo, self-hosted Influx — more ops than value at ≤50 peers. Revisit Postgres only if you need SQL dashboards or multi-tenant analytics.

**Production (after Upstash linked on Vercel):**

- Hourly cron: `vercel.json` → `GET /api/kpi-snapshot` (requires `CRON_SECRET` on project).
- Public dashboard: https://senda.network/metrics
- Read latest week: `GET https://senda.network/api/kpi-snapshot?latest=1`
- Dashboard bundle: `GET https://senda.network/api/kpi-snapshot?dashboard=1`
- Read specific week: `GET https://senda.network/api/kpi-snapshot?week=2026-W21`
- Manual capture: `curl -H "Authorization: Bearer $CRON_SECRET" https://senda.network/api/kpi-snapshot`
- Setup script: `./scripts/setup-upstash-vercel.sh` (accept marketplace terms in dashboard first if CLI prompts).

Env: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or legacy `KV_REST_*`), optional `SENDA_KPI_FLAGSHIP_MODEL`, `CRON_SECRET`.

## Related docs

- Mesh validation runbook: `docs/heterogeneous-mesh-validation.md`
- Status UI aggregation (TPS/TTFT semantics): `app/(public)/status/page.tsx` (`CatalogRow`)
- Runtime metric window: `senda-llm/senda/src/network/metrics.rs` (`MODEL_TIMING_WINDOW` = 1h)
- Infra / status URLs: `.cursor/skills/senda-infra/SKILL.md`
