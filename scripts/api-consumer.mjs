#!/usr/bin/env node
/**
 * Production API consumer — generate real inference traffic so token
 * consumption shows up across the stack (mesh_share_pct, the credits
 * ledger, the /status per-model TPS/TTFT catalog, KPI snapshots).
 *
 * Two modes:
 *
 *   chat    (default) → POST https://senda.network/api/chat
 *           The public website surface. No auth. This is the path that
 *           records served_by (mesh vs fallback), mints mesh credits from
 *           completion tokens, and feeds the runtime's catalog samples —
 *           i.e. the one that makes the website dashboards move.
 *
 *   openai  → POST https://entry.senda.network/v1/chat/completions
 *           The raw OpenAI-compatible runtime API (the "real API" a paid
 *           customer would call in Phase 5). Needs the bearer token
 *           (SENDA_RUNTIME_TOKEN). Bypasses the website's mesh-share
 *           / credits bookkeeping — the runtime still records its own
 *           per-model TPS/TTFT catalog, visible on /status.
 *
 * Models:
 *   By default the script pulls routable models from /api/status and
 *   rotates only daily-driver tier (chat-viable). Use --all-tiers to
 *   include capacity/experimental. Pin with --model, or --models a,b,c.
 *
 * Stats:
 *   Every request is appended as JSONL under .senda/consume/ (gitignored).
 *   On exit a summary JSON lands next to it with per-model rollups.
 *   Rows include x-senda-sla-* / served-by headers when present.
 *
 * Usage:
 *   node scripts/api-consumer.mjs                       # rotate daily drivers
 *   node scripts/api-consumer.mjs --all-tiers           # include capacity too
 *   node scripts/api-consumer.mjs --count 20            # 20 requests then stop
 *   node scripts/api-consumer.mjs --interval 5000       # 5s between requests
 *   node scripts/api-consumer.mjs --concurrency 3       # 3 in flight
 *   node scripts/api-consumer.mjs --model Qwen3-8B      # pin a model
 *   node scripts/api-consumer.mjs --models A,B,C        # rotate a custom list
 *   node scripts/api-consumer.mjs --out ./run.jsonl     # custom stats path
 *   node scripts/api-consumer.mjs --mode openai --token $SENDA_RUNTIME_TOKEN
 *
 * Ctrl-C prints a summary and exits.
 */

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  mode: "chat",
  site: "https://senda.network",
  runtime: "https://entry.senda.network/v1",
  interval: 2000,
  concurrency: 1,
  count: 0, // 0 = run until Ctrl-C
  maxTokens: 256,
};

// Latency-tolerant prompts — the work Senda actually targets
// (summarization, classification, extraction, light reasoning). Short
// inputs, bounded outputs, so each request is a quick real token spend.
const PROMPTS = [
  "Summarize the concept of peer-to-peer networking in two sentences.",
  "Classify the sentiment of this review as positive, negative, or neutral: 'The battery lasts all day but the screen is dim.'",
  "Extract every date mentioned: 'We met on March 3rd, shipped on 2026-01-09, and review again next Friday.'",
  "List three latency-tolerant LLM workloads and one sentence on why each tolerates latency.",
  "Rewrite this sentence to be more concise: 'Due to the fact that the server was down, we were unable to complete the task.'",
  "Give a one-paragraph explanation of why unified memory helps on-device inference.",
  "Translate to French: 'The mesh routes your request to a contributor's machine.'",
  "What is 17 * 24? Show the steps briefly.",
  "Name five open-weight model families and the org that trained each.",
  "Turn these notes into a tweet: decentralized inference, privacy you control, earn by serving open models.",
];

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const opts = {
    ...DEFAULTS,
    token: process.env.SENDA_RUNTIME_TOKEN ?? "",
    model: null,
    models: null,
    base: null,
    out: null,
    noStats: false,
    allTiers: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--mode": opts.mode = next(); break;
      case "--base": opts.base = next(); break;
      case "--model": opts.model = next(); break;
      case "--models": opts.models = next(); break;
      case "--token": opts.token = next(); break;
      case "--interval": opts.interval = Number(next()); break;
      case "--concurrency": opts.concurrency = Number(next()); break;
      case "--count": opts.count = Number(next()); break;
      case "--max-tokens": opts.maxTokens = Number(next()); break;
      case "--out": opts.out = next(); break;
      case "--no-stats": opts.noStats = true; break;
      case "--all-tiers": opts.allTiers = true; break;
      case "-h":
      case "--help": opts.help = true; break;
      default:
        console.error(C.red(`Unknown argument: ${a}`));
        opts.help = true;
    }
  }
  if (opts.mode !== "chat" && opts.mode !== "openai") {
    console.error(C.red(`--mode must be "chat" or "openai" (got "${opts.mode}")`));
    opts.help = true;
  }
  if (opts.model && opts.models) {
    console.error(C.red("use either --model or --models, not both"));
    opts.help = true;
  }
  return opts;
}

function printHelp() {
  console.log(`senda production API consumer

  --mode chat|openai     surface to drive (default: chat / the website)
  --base URL             override the base URL
  --model NAME           pin a single model
  --models A,B,C         rotate an explicit model list
  (default)              rotate daily-driver models from /api/status
  --all-tiers            include capacity / experimental in the rotation
  --token TOKEN          bearer token for openai mode (or SENDA_RUNTIME_TOKEN)
  --count N              stop after N requests (default: 0 = run until Ctrl-C)
  --interval MS          delay between requests per worker (default: 2000)
  --concurrency N        concurrent workers (default: 1)
  --max-tokens N         cap output length (default: 256)
  --out PATH             write JSONL stats here (default: .senda/consume/<ts>.jsonl)
  --no-stats             skip writing stats files
  -h, --help             this help
`);
}

/** Rough mirror of app/lib/model-tiers.ts for the consumer (no TS import). */
function modelTier(id) {
  const n = String(id)
    .toLowerCase()
    .replace(/\.gguf$/, "")
    .replace(/[._]/g, "-")
    .replace(/-+/g, "-");
  // Smoke-test tiny model — experimental in the TS table.
  if (/-0-6b/.test(n)) return "experimental";
  if (
    /-(27|30|32|70|72|235)b/.test(n) ||
    /30b-a3b/.test(n) ||
    /8x22b/.test(n) ||
    /coder-next/.test(n)
  ) {
    return "capacity";
  }
  if (/-(3|7|8|9|12|14)b/.test(n)) return "daily_driver";
  return "experimental";
}

function isDailyDriver(id) {
  return modelTier(id) === "daily_driver";
}

function readSlaHeaders(res) {
  return {
    slaStatus: res.headers.get("x-senda-sla-status"),
    slaTier: res.headers.get("x-senda-sla-tier"),
    slaBestTps: res.headers.get("x-senda-sla-best-tps"),
    slaBestTtftMs: res.headers.get("x-senda-sla-best-ttft-ms"),
    slaCandidates: res.headers.get("x-senda-sla-candidates"),
    slaNativeRatio: res.headers.get("x-senda-sla-native-ratio"),
    fallbackStatus: res.headers.get("x-senda-fallback-status"),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const approxTokens = (text) => Math.max(1, Math.round(text.length / 4));
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
};

/**
 * Iterate `data:`-prefixed SSE lines from a fetch Response body.
 * Yields the raw payload string after `data: ` for each event.
 */
async function* sseEvents(res) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trimEnd();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trimStart();
    }
  }
  const tail = buffer.trimEnd();
  if (tail.startsWith("data:")) yield tail.slice(5).trimStart();
}

/** One request against the website /api/chat (AI SDK v5 UIMessage stream). */
async function runChatRequest(opts, prompt, model) {
  const base = opts.base ?? opts.site;
  const body = {
    messages: [{ id: cryptoId(), role: "user", parts: [{ type: "text", text: prompt }] }],
  };
  if (model) body.model = model;

  const start = performance.now();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const detail = await safeText(res);
    throw new Error(`HTTP ${res.status} ${detail}`);
  }

  const servedBy = res.headers.get("x-senda-served-by") ?? "?";
  const sla = readSlaHeaders(res);
  let text = "";
  let ttft = null;
  for await (const payload of sseEvents(res)) {
    if (payload === "[DONE]") break;
    let evt;
    try { evt = JSON.parse(payload); } catch { continue; }
    const delta = evt.delta ?? evt.textDelta;
    if (typeof delta === "string" && (evt.type === "text-delta" || evt.type === "text")) {
      if (ttft === null) ttft = performance.now() - start;
      text += delta;
    }
    if (evt.type === "error") throw new Error(evt.errorText ?? "stream error");
  }
  const totalMs = performance.now() - start;
  const tokens = approxTokens(text);
  return {
    servedBy,
    model: model ?? "(server-picked)",
    ttftMs: ttft,
    totalMs,
    tokens,
    tokensExact: false,
    tps: ttft != null && totalMs > ttft ? tokens / ((totalMs - ttft) / 1000) : null,
    slaTps: sla.slaBestTps != null ? Number(sla.slaBestTps) : null,
    sla,
    preview: text.slice(0, 80).replace(/\s+/g, " ").trim(),
  };
}

/** One request against the runtime /v1/chat/completions (OpenAI stream). */
async function runOpenAIRequest(opts, prompt, model) {
  const base = opts.base ?? opts.runtime;
  if (!model) throw new Error("openai mode needs a model (none routable and none pinned)");
  const headers = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: opts.maxTokens,
  };

  const start = performance.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const detail = await safeText(res);
    throw new Error(`HTTP ${res.status} ${detail}`);
  }

  let text = "";
  let ttft = null;
  let usageTokens = null;
  for await (const payload of sseEvents(res)) {
    if (payload === "[DONE]") break;
    let evt;
    try { evt = JSON.parse(payload); } catch { continue; }
    const delta = evt.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length) {
      if (ttft === null) ttft = performance.now() - start;
      text += delta;
    }
    if (evt.usage?.completion_tokens != null) usageTokens = evt.usage.completion_tokens;
  }
  const totalMs = performance.now() - start;
  const tokens = usageTokens ?? approxTokens(text);
  return {
    servedBy: res.headers.get("x-senda-served-by") ?? "runtime",
    model,
    ttftMs: ttft,
    totalMs,
    tokens,
    tokensExact: usageTokens != null,
    tps: ttft != null && totalMs > ttft ? tokens / ((totalMs - ttft) / 1000) : null,
    slaTps: null,
    sla: readSlaHeaders(res),
    preview: text.slice(0, 80).replace(/\s+/g, " ").trim(),
  };
}

function cryptoId() {
  return "msg_" + Math.random().toString(36).slice(2, 10);
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 200); } catch { return ""; }
}

/** Fetch routable model ids from the website /api/status. */
async function fetchRoutableModels(opts) {
  const site = opts.mode === "chat" ? (opts.base ?? opts.site) : opts.site;
  const res = await fetch(`${site}/api/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const s = await res.json();
  return {
    online: !!s.online,
    nodeCount: s.nodeCount ?? 0,
    models: Array.isArray(s.models) ? s.models.filter((m) => typeof m === "string" && m.length) : [],
  };
}

/** Resolve the rotation list: --model, --models, or /api/status. */
async function resolveModelPool(opts) {
  if (opts.model) {
    return { models: [opts.model], source: "pinned", status: null, note: null };
  }
  if (opts.models) {
    const models = opts.models.split(",").map((m) => m.trim()).filter(Boolean);
    if (!models.length) throw new Error("--models was empty");
    return { models, source: "cli", status: null, note: null };
  }
  try {
    const status = await fetchRoutableModels(opts);
    if (!status.models.length) {
      return { models: [], source: "status-empty", status, note: null };
    }
    if (opts.allTiers) {
      return { models: status.models, source: "status-all-tiers", status, note: null };
    }
    const daily = status.models.filter(isDailyDriver);
    if (daily.length) {
      return { models: daily, source: "status-daily-driver", status, note: null };
    }
    // Only capacity online — still run, but say why we widened.
    return {
      models: status.models,
      source: "status-fallback-all",
      status,
      note: "no daily-driver models routable — rotating all tiers",
    };
  } catch (err) {
    return { models: [], source: "status-error", status: null, error: err, note: null };
  }
}

/** Pre-flight: show what the mesh can serve right now. */
async function showMeshStatus(opts, pool) {
  if (pool.status) {
    const models = pool.status.models.join(", ") || "(none routable)";
    console.log(C.dim(`  mesh: ${pool.status.online ? "online" : "offline"} · ${pool.status.nodeCount} node(s) · models: ${models}`));
    return;
  }
  try {
    const status = await fetchRoutableModels(opts);
    const models = status.models.join(", ") || "(none routable)";
    console.log(C.dim(`  mesh: ${status.online ? "online" : "offline"} · ${status.nodeCount} node(s) · models: ${models}`));
  } catch {
    console.log(C.yellow("  (could not reach /api/status)"));
  }
}

/** Show the top of the credits ledger so token accrual is visible. */
async function showCredits(opts, label) {
  const site = opts.base ?? opts.site;
  try {
    const res = await fetch(`${site}/api/credits?limit=3`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.storeReady) {
      console.log(C.dim(`  credits ledger: not configured (Upstash unset)`));
      return;
    }
    const top = (data.leaderboard ?? [])
      .map((e) => `${(e.peerId ?? "?").slice(0, 8)}=${e.credits ?? e.tokens ?? 0}`)
      .join("  ") || "(empty)";
    console.log(C.dim(`  credits ${label}: ${top}`));
  } catch {
    /* best-effort */
  }
}

function fmt(n, suffix = "") {
  return n == null ? "—" : `${Math.round(n)}${suffix}`;
}

function shortModel(name) {
  if (!name || name === "(server-picked)") return name;
  // Drop common quant suffixes for the live line so columns stay readable.
  return name.replace(/-Q\d[_A-Z0-9]+$/i, "").slice(0, 28);
}

function defaultOutPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(REPO_ROOT, ".senda", "consume", `${stamp}.jsonl`);
}

function openStatsWriter(opts) {
  if (opts.noStats) return null;
  const jsonlPath = resolve(opts.out ?? defaultOutPath());
  mkdirSync(dirname(jsonlPath), { recursive: true });
  const summaryPath = jsonlPath.endsWith(".jsonl")
    ? jsonlPath.slice(0, -".jsonl".length) + ".summary.json"
    : jsonlPath + ".summary.json";
  return {
    jsonlPath,
    summaryPath,
    writeRow(row) {
      appendFileSync(jsonlPath, JSON.stringify(row) + "\n");
    },
    writeSummary(summary) {
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
    },
  };
}

function emptyModelBucket() {
  return { ok: 0, failed: 0, mesh: 0, fallback: 0, tokens: 0, ttfts: [], tpsList: [], totalMs: [] };
}

function rollupBucket(b) {
  return {
    ok: b.ok,
    failed: b.failed,
    mesh: b.mesh,
    fallback: b.fallback,
    tokens: b.tokens,
    avgTtftMs: avg(b.ttfts),
    p50TtftMs: pct(b.ttfts, 50),
    avgTps: avg(b.tpsList),
    p50Tps: pct(b.tpsList, 50),
    avgTotalMs: avg(b.totalMs),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();

  const target =
    opts.mode === "chat"
      ? `${opts.base ?? opts.site}/api/chat`
      : `${opts.base ?? opts.runtime}/chat/completions`;

  const pool = await resolveModelPool(opts);
  if (opts.mode === "openai" && !pool.models.length) {
    console.error(C.red("openai mode needs at least one model — none routable from /api/status and none pinned with --model / --models"));
    process.exit(1);
  }
  if (pool.source === "status-error") {
    console.log(C.yellow(`  (could not resolve models from /api/status: ${pool.error?.message ?? pool.error})`));
  }

  const rotating = pool.models.length > 1;
  const modelLabel = !pool.models.length
    ? "(server-picked)"
    : rotating
      ? `rotate ${pool.models.length} (${pool.source})`
      : `${pool.models[0]} (${pool.source})`;

  const statsWriter = openStatsWriter(opts);

  console.log(C.bold(`Senda API consumer`));
  console.log(`  mode      : ${C.cyan(opts.mode)}`);
  console.log(`  target    : ${target}`);
  console.log(`  model     : ${modelLabel}`);
  if (rotating) {
    console.log(C.dim(`             ${pool.models.join(", ")}`));
  }
  if (pool.note) console.log(C.yellow(`  note      : ${pool.note}`));
  console.log(`  rate      : ${opts.concurrency} worker(s), ${opts.interval}ms apart`);
  console.log(`  count     : ${opts.count === 0 ? "until Ctrl-C" : opts.count}`);
  if (statsWriter) {
    console.log(`  stats     : ${statsWriter.jsonlPath}`);
  }
  if (opts.mode === "openai" && !opts.token) {
    console.log(C.yellow("  warning   : no token — gated endpoints will 401 (set --token or SENDA_RUNTIME_TOKEN)"));
  }
  await showMeshStatus(opts, pool);
  if (opts.mode === "chat") await showCredits(opts, "before");
  console.log("");

  const runOne = opts.mode === "chat" ? runChatRequest : runOpenAIRequest;
  const stats = {
    startedAt: new Date().toISOString(),
    sent: 0,
    ok: 0,
    failed: 0,
    mesh: 0,
    fallback: 0,
    tokens: 0,
    ttfts: [],
    tpsList: [],
    byModel: Object.create(null),
  };
  let stopping = false;
  let nextIndex = 0;

  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log(C.yellow("\nstopping after in-flight requests…"));
  });

  function pickModel(reqNum) {
    if (!pool.models.length) return null;
    return pool.models[(reqNum - 1) % pool.models.length];
  }

  function noteResult(modelKey, r) {
    const key = modelKey ?? "(server-picked)";
    if (!stats.byModel[key]) stats.byModel[key] = emptyModelBucket();
    const b = stats.byModel[key];
    b.ok++;
    if (r.servedBy === "mesh") b.mesh++;
    else if (r.servedBy === "fallback") b.fallback++;
    b.tokens += r.tokens;
    if (r.ttftMs != null) b.ttfts.push(r.ttftMs);
    if (r.tps != null) b.tpsList.push(r.tps);
    b.totalMs.push(r.totalMs);
  }

  function noteFailure(modelKey) {
    const key = modelKey ?? "(server-picked)";
    if (!stats.byModel[key]) stats.byModel[key] = emptyModelBucket();
    stats.byModel[key].failed++;
  }

  async function worker(_workerId) {
    while (!stopping && (opts.count === 0 || nextIndex < opts.count)) {
      const reqNum = ++nextIndex;
      const prompt = PROMPTS[(reqNum - 1) % PROMPTS.length];
      const model = pickModel(reqNum);
      stats.sent++;
      const tag = C.dim(`#${String(reqNum).padStart(3, " ")}`);
      const modelTag = C.cyan(shortModel(model ?? "(auto)").padEnd(28));
      const t0 = new Date().toISOString();
      try {
        const r = await runOne(opts, prompt, model);
        stats.ok++;
        if (r.servedBy === "mesh") stats.mesh++;
        else if (r.servedBy === "fallback") stats.fallback++;
        stats.tokens += r.tokens;
        if (r.ttftMs != null) stats.ttfts.push(r.ttftMs);
        if (r.tps != null) stats.tpsList.push(r.tps);
        noteResult(r.model, r);
        const served =
          r.servedBy === "mesh" ? C.green("mesh")
          : r.servedBy === "fallback" ? C.yellow("fallback")
          : C.dim(r.servedBy);
        const slaTag = r.sla?.slaStatus
          ? C.dim(`sla=${r.sla.slaStatus}`)
          : "";
        console.log(
          `${tag} ${modelTag} ${served.padEnd(8)} ` +
          `${C.cyan(fmt(r.tokens) + (r.tokensExact ? "tok" : "~tok")).padEnd(18)} ` +
          `ttft ${fmt(r.ttftMs, "ms").padStart(7)} ` +
          `total ${fmt(r.totalMs, "ms").padStart(7)} ` +
          `${fmt(r.tps)} tok/s  ` +
          (slaTag ? `${slaTag}  ` : "") +
          C.dim(`"${r.preview}…"`),
        );
        statsWriter?.writeRow({
          ts: t0,
          ok: true,
          n: reqNum,
          mode: opts.mode,
          model: r.model,
          prompt,
          servedBy: r.servedBy,
          tokens: r.tokens,
          tokensExact: r.tokensExact,
          ttftMs: r.ttftMs,
          totalMs: r.totalMs,
          tps: r.tps,
          slaTps: r.slaTps,
          sla: r.sla ?? null,
          preview: r.preview,
        });
      } catch (err) {
        stats.failed++;
        noteFailure(model);
        const message = String(err.message ?? err);
        console.log(`${tag} ${modelTag} ${C.red("FAILED")}   ${C.dim(message)}`);
        statsWriter?.writeRow({
          ts: t0,
          ok: false,
          n: reqNum,
          mode: opts.mode,
          model: model ?? "(server-picked)",
          prompt,
          error: message,
        });
      }
      if (!stopping && (opts.count === 0 || nextIndex < opts.count)) {
        await sleep(opts.interval);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, (_, i) => worker(i));
  await Promise.all(workers);

  const endedAt = new Date().toISOString();
  const byModel = Object.fromEntries(
    Object.entries(stats.byModel).map(([k, b]) => [k, rollupBucket(b)]),
  );

  console.log("");
  console.log(C.bold("summary"));
  console.log(`  requests  : ${stats.ok} ok, ${stats.failed} failed (${stats.sent} sent)`);
  console.log(`  served by : ${C.green(String(stats.mesh) + " mesh")}, ${C.yellow(String(stats.fallback) + " fallback")}`);
  console.log(`  tokens    : ~${stats.tokens} output tokens generated`);
  console.log(`  avg ttft  : ${fmt(avg(stats.ttfts), "ms")}`);
  console.log(`  avg tok/s : ${fmt(avg(stats.tpsList))}`);

  const modelKeys = Object.keys(byModel).sort();
  if (modelKeys.length > 1 || (modelKeys.length === 1 && modelKeys[0] !== "(server-picked)")) {
    console.log(C.bold("  by model"));
    for (const key of modelKeys) {
      const m = byModel[key];
      console.log(
        `    ${shortModel(key).padEnd(28)} ` +
        `${m.ok} ok / ${m.failed} fail  ` +
        `mesh ${m.mesh}  ` +
        `ttft ${fmt(m.p50TtftMs ?? m.avgTtftMs, "ms")}  ` +
        `${fmt(m.p50Tps ?? m.avgTps)} tok/s`,
      );
    }
  }

  if (statsWriter) {
    statsWriter.writeSummary({
      startedAt: stats.startedAt,
      endedAt,
      mode: opts.mode,
      target,
      modelPool: pool.models,
      modelSource: pool.source,
      requests: { sent: stats.sent, ok: stats.ok, failed: stats.failed },
      servedBy: { mesh: stats.mesh, fallback: stats.fallback },
      tokens: stats.tokens,
      avgTtftMs: avg(stats.ttfts),
      p50TtftMs: pct(stats.ttfts, 50),
      avgTps: avg(stats.tpsList),
      p50Tps: pct(stats.tpsList, 50),
      byModel,
      jsonl: statsWriter.jsonlPath,
    });
    console.log(C.dim(`  stats     : ${statsWriter.jsonlPath}`));
    console.log(C.dim(`  summary   : ${statsWriter.summaryPath}`));
  }

  if (opts.mode === "chat") {
    await showCredits(opts, "after ");
    console.log(C.dim(`  watch it land: ${opts.base ?? opts.site}/status`));
  }
}

main().catch((err) => {
  console.error(C.red(String(err?.stack ?? err)));
  process.exit(1);
});
