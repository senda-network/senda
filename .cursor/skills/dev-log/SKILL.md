---
name: dev-log
description: >-
  Maintain the public ClosedMesh development log at `closedmesh.com/updates`.
  Use whenever a phase ships in full or in part (per `internal/STRATEGY.md`),
  whenever a major mesh metric milestone lands (first p50 sample, new
  measurable mode, throughput regime change), or whenever the user mentions
  the dev log, /updates, the updates page, the journal, the changelog, or
  "what should we tell the public about this." NOT used for routine
  per-commit, per-release, or per-bugfix work.
---

# ClosedMesh public dev log

Maintain `app/(public)/updates/page.tsx` (served at `/updates`) as the
public-facing translation of `internal/STRATEGY.md` and
`internal/RESILIENCE.md`. Append-only, phase-level, past-tense.

## When to update

**Update on:**
- A phase ships, full or partial (decision log row in `STRATEGY.md` says
  "Ratified" and the phase's "Done when" gates are met).
- A measurable milestone the public surface can verify lands: first
  end-to-end p50 sample on a new model, new serving mode (solo, pooled
  split, MoE shard, speculative-decoding pair) appearing in the catalog,
  a throughput regime change (>30% week-over-week shift in the flagship
  metric we publish on `/status`).
- A correction to a previously-published entry's facts (rare; never
  rewrite tone after the fact).

**Do NOT update on:**
- Per-commit or per-release work. Phase 1 took 7 runtime releases — they
  collapse to one entry, not seven.
- Roadmap items, planning, in-flight phases. The log is past tense only.
  Anything not shipped doesn't exist on the page.
- Bug fixes that don't change behavior the public can verify.
- Internal infra work (Vercel env changes, CI tweaks, skill edits).

## Source of truth

The two internal docs hold the substance. Read them in this order before
drafting a public entry:

1. `internal/STRATEGY.md` — the phase's "Done when" gates, validation
   evidence, decision log row, actual-vs-estimated effort.
2. `internal/RESILIENCE.md` — the code-level handoff section for the
   phase. File paths, defect classes, regression test names. The honest
   retro material.

The public entry is a **re-narration**, not a copy-paste.

## What to keep, what to redact, what to translate

| Internal | Public |
|---|---|
| Defect class names ("tunnel-bypass", "EnvFilter", "gossip-refresh", "TPS accuracy") | Plain prose: "a tunnel that bypassed the chokepoint", "a log filter that swallowed the diagnostic events", "a gossip-refresh path that didn't fire", "a streaming code path that read tok/s from the wrong field" |
| Effort estimates in eng-weeks or working days | Drop. The public doesn't pay for our hours. |
| Dollar figures, hardware tier yield models, tokenomics math | Drop until tokenomics ships publicly. |
| Decision log rows verbatim | Drop. The decision is implicit in what shipped. |
| Roadmap promises (Phase 3, Phase 4, Phase 5) | Drop entirely. The log is past tense only. |
| File paths, function names, test names | Keep when they make the technical claim verifiable; drop when they're noise. Err on the side of dropping. |
| Real measurements on the live mesh (tok/s, TTFT, peer counts, version arcs) | Keep verbatim. These are the most valuable content on the page. |
| Defect *honesty* — admitting we shipped 7 releases for one phase, that 4 of them were follow-up fixes, that one defect produced 953k tok/s readings until we noticed | Keep. The dev-honest tone is the entire reason this page is worth more than marketing copy. |

## Tone rules

- Past tense. "Phase 2 shipped 2026-05-20." Never "we're delighted to announce."
- Direct. "The runtime instruments its own backend proxy" — not "leverages
  cutting-edge instrumentation."
- Admit defects. The Phase 1 entry names that 4 of 7 releases were follow-up
  fixes. That paragraph is the most credible thing on the page.
- One number per metric. Don't list the full p50/p95/p99 distribution. If
  the metric was "0.482 tok/s on a streaming chat", say that.
- No first-person plural cheerleading ("we built", "we believe"). The log
  is what shipped, not what the team feels about it.
- Code identifiers (`v0.66.48`, `Qwen3-8B-Q4_K_M`, `CLOSEDMESH_FORCE_SPLIT_ROUTING`)
  in inline backticks or the version-anchor field; not in body prose.

## Entry shape

Every entry conforms to the `LogEntry` type in
`app/(public)/log/page.tsx`. Fields:

| Field | Required | Constraint |
|---|---|---|
| `id` | yes | URL-safe slug, unique. Stable forever once published — anchor links depend on it. Format: `phase-N-short-slug` (e.g. `phase-2-routing-defaults`). |
| `date` | yes | ISO `YYYY-MM-DD`. Ship date on `main`, not author date. |
| `phase` | yes | Display label: `"Phase 0"`, `"Phase 1"`, `"Phase 2"` … |
| `version` | optional | Single version (`"v0.66.48"`) or arc (`"v0.66.41 → v0.66.47"`). Drop for non-runtime phases (e.g. Phase 0 narrative). |
| `title` | yes | Past-tense headline. Period at end. ≤80 chars. |
| `lede` | yes | One paragraph, ≤2 sentences, ≤320 chars. The TL;DR. |
| `body` | yes | Array of paragraphs. 2–4 entries. ~80–150 words each. |
| `metrics` | optional | 2–4 stat tiles. Real measurements only. Format: `{ label: "Qwen3-8B-Q4_K_M (solo)", value: "0.693 tok/s · 20.66 s TTFT" }`. |

Newest entry first in the `ENTRIES` array.

## Workflow

When updating:

1. Read `internal/STRATEGY.md` for the relevant phase's status block,
   "Done when" evidence, and decision log entries.
2. Read `internal/RESILIENCE.md` for the corresponding code-level section
   (if any).
3. Pull live numbers from `https://mesh.closedmesh.com/api/status` or
   `https://closedmesh.com/api/status` — use values from the same data
   path the public sees, not from a private benchmark.
4. Draft the entry following the shape and tone rules above.
5. Insert at the top of the `ENTRIES` array in
   `app/(public)/updates/page.tsx`.
6. Verify: `npx tsc --noEmit -p .` from the website root.
7. Deploy: `vercel --prod` from the website root (Vercel does NOT
   auto-deploy on git push — see `.cursor/skills/closedmesh-infra/`).
8. Spot-check `https://closedmesh.com/updates` renders the new entry and
   the metrics tiles aren't broken.

## Hard rules

1. Past tense only. Anything not shipped does not appear.
2. Phase-level entries only. Never per-release, never per-commit.
3. Re-narration, not copy-paste from internal docs.
4. No roadmap. Phase N+1 doesn't exist on the page until it ships.
5. Real numbers from the live mesh, or no numbers.
6. Append-only. Don't rewrite published entries; if facts are wrong, add
   a correction note with a date inside the existing entry's `body`,
   don't silently edit history.
7. The page stays unlinked from `PublicHeader` nav until the founder
   explicitly asks to link it. The footer link from `/updates` itself is
   fine — that's just internal cross-navigation.

## Related docs

- Live status surface: `app/(public)/status/page.tsx` (`/status`)
- Internal strategy: `internal/STRATEGY.md`
- Internal post-mortems: `internal/RESILIENCE.md`
- Deploy flow: `.cursor/skills/closedmesh-infra/SKILL.md`
- Weekly KPIs (related but different surface): `.cursor/skills/weekly-kpi/SKILL.md`
