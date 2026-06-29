#!/usr/bin/env node
/**
 * Production API consumer — generate real inference traffic so token
 * consumption shows up across the stack (mesh_share_pct, the credits
 * ledger, the /status per-model TPS/TTFT catalog, KPI snapshots).
 *
 * Two modes:
 *
 *   chat    (default) → POST https://closedmesh.com/api/chat
 *           The public website surface. No auth. This is the path that
 *           records served_by (mesh vs fallback), mints mesh credits from
 *           completion tokens, and feeds the runtime's catalog samples —
 *           i.e. the one that makes the website dashboards move.
 *
 *   openai  → POST https://mesh.closedmesh.com/v1/chat/completions
 *           The raw OpenAI-compatible runtime API (the "real API" a paid
 *           customer would call in Phase 5). Needs the bearer token
 *           (CLOSEDMESH_RUNTIME_TOKEN). Bypasses the website's mesh-share
 *           / credits bookkeeping — the runtime still records its own
 *           per-model TPS/TTFT catalog, visible on /status.
 *
 * Usage:
 *   node scripts/api-consumer.mjs                       # loop forever, website chat
 *   node scripts/api-consumer.mjs --count 20            # 20 requests then stop
 *   node scripts/api-consumer.mjs --interval 5000       # 5s between requests
 *   node scripts/api-consumer.mjs --concurrency 3       # 3 in flight
 *   node scripts/api-consumer.mjs --model Qwen3-8B      # pin a model
 *   node scripts/api-consumer.mjs --mode openai --token $CLOSEDMESH_RUNTIME_TOKEN
 *
 * Ctrl-C prints a summary and exits.
 */

const DEFAULTS = {
  mode: "chat",
  site: "https://closedmesh.com",
  runtime: "https://mesh.closedmesh.com/v1",
  interval: 2000,
  concurrency: 1,
  count: 0, // 0 = run until Ctrl-C
  maxTokens: 256,
};

// Latency-tolerant prompts — the work ClosedMesh actually targets
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
  const opts = { ...DEFAULTS, token: process.env.CLOSEDMESH_RUNTIME_TOKEN ?? "", model: null, base: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--mode": opts.mode = next(); break;
      case "--base": opts.base = next(); break;
      case "--model": opts.model = next(); break;
      case "--token": opts.token = next(); break;
      case "--interval": opts.interval = Number(next()); break;
      case "--concurrency": opts.concurrency = Number(next()); break;
      case "--count": opts.count = Number(next()); break;
      case "--max-tokens": opts.maxTokens = Number(next()); break;
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
  return opts;
}

function printHelp() {
  console.log(`closedmesh production API consumer

  --mode chat|openai     surface to drive (default: chat / the website)
  --base URL             override the base URL
  --model NAME           pin a model (default: let the server pick)
  --token TOKEN          bearer token for openai mode (or CLOSEDMESH_RUNTIME_TOKEN)
  --count N              stop after N requests (default: 0 = run until Ctrl-C)
  --interval MS          delay between requests per worker (default: 2000)
  --concurrency N        concurrent workers (default: 1)
  --max-tokens N         cap output length (default: 256)
  -h, --help             this help
`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const approxTokens = (text) => Math.max(1, Math.round(text.length / 4));

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
async function runChatRequest(opts, prompt) {
  const base = opts.base ?? opts.site;
  const body = {
    messages: [{ id: cryptoId(), role: "user", parts: [{ type: "text", text: prompt }] }],
  };
  if (opts.model) body.model = opts.model;

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

  const servedBy = res.headers.get("x-closedmesh-served-by") ?? "?";
  const slaTps = res.headers.get("x-closedmesh-sla-best-tps");
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
    model: opts.model ?? "(server-picked)",
    ttftMs: ttft,
    totalMs,
    tokens,
    tokensExact: false,
    tps: ttft != null && totalMs > ttft ? tokens / ((totalMs - ttft) / 1000) : null,
    slaTps: slaTps ? Number(slaTps) : null,
    preview: text.slice(0, 80).replace(/\s+/g, " ").trim(),
  };
}

/** One request against the runtime /v1/chat/completions (OpenAI stream). */
async function runOpenAIRequest(opts, prompt) {
  const base = opts.base ?? opts.runtime;
  if (!opts.model) throw new Error("openai mode needs --model (run with --mode openai once to see the model list)");
  const headers = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const body = {
    model: opts.model,
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
    servedBy: res.headers.get("x-closedmesh-served-by") ?? "runtime",
    model: opts.model,
    ttftMs: ttft,
    totalMs,
    tokens,
    tokensExact: usageTokens != null,
    tps: ttft != null && totalMs > ttft ? tokens / ((totalMs - ttft) / 1000) : null,
    slaTps: null,
    preview: text.slice(0, 80).replace(/\s+/g, " ").trim(),
  };
}

function cryptoId() {
  return "msg_" + Math.random().toString(36).slice(2, 10);
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 200); } catch { return ""; }
}

/** Pre-flight: show what the mesh can serve right now. */
async function showMeshStatus(opts) {
  const site = opts.mode === "chat" ? (opts.base ?? opts.site) : opts.site;
  try {
    const res = await fetch(`${site}/api/status`, { cache: "no-store" });
    if (!res.ok) return;
    const s = await res.json();
    const models = (s.models ?? []).join(", ") || "(none routable)";
    console.log(C.dim(`  mesh: ${s.online ? "online" : "offline"} · ${s.nodeCount ?? 0} node(s) · models: ${models}`));
    if (opts.mode === "openai" && !opts.model) {
      console.log(C.yellow(`  pick one with --model, e.g. --model ${(s.models ?? [])[0] ?? "Qwen3-8B"}`));
    }
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();

  const target =
    opts.mode === "chat"
      ? `${opts.base ?? opts.site}/api/chat`
      : `${opts.base ?? opts.runtime}/chat/completions`;

  console.log(C.bold(`ClosedMesh API consumer`));
  console.log(`  mode      : ${C.cyan(opts.mode)}`);
  console.log(`  target    : ${target}`);
  console.log(`  model     : ${opts.model ?? "(server-picked)"}`);
  console.log(`  rate      : ${opts.concurrency} worker(s), ${opts.interval}ms apart`);
  console.log(`  count     : ${opts.count === 0 ? "until Ctrl-C" : opts.count}`);
  if (opts.mode === "openai" && !opts.token) {
    console.log(C.yellow("  warning   : no token — gated endpoints will 401 (set --token or CLOSEDMESH_RUNTIME_TOKEN)"));
  }
  await showMeshStatus(opts);
  if (opts.mode === "chat") await showCredits(opts, "before");
  console.log("");

  const runOne = opts.mode === "chat" ? runChatRequest : runOpenAIRequest;
  const stats = { sent: 0, ok: 0, failed: 0, mesh: 0, fallback: 0, tokens: 0, ttfts: [], tpsList: [] };
  let stopping = false;
  let nextIndex = 0;

  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log(C.yellow("\nstopping after in-flight requests…"));
  });

  async function worker(workerId) {
    while (!stopping && (opts.count === 0 || nextIndex < opts.count)) {
      const reqNum = ++nextIndex;
      const prompt = PROMPTS[(reqNum - 1) % PROMPTS.length];
      stats.sent++;
      const tag = C.dim(`#${String(reqNum).padStart(3, " ")}`);
      try {
        const r = await runOne(opts, prompt);
        stats.ok++;
        if (r.servedBy === "mesh") stats.mesh++;
        else if (r.servedBy === "fallback") stats.fallback++;
        stats.tokens += r.tokens;
        if (r.ttftMs != null) stats.ttfts.push(r.ttftMs);
        if (r.tps != null) stats.tpsList.push(r.tps);
        const served =
          r.servedBy === "mesh" ? C.green("mesh")
          : r.servedBy === "fallback" ? C.yellow("fallback")
          : C.dim(r.servedBy);
        console.log(
          `${tag} ${served.padEnd(8)} ` +
          `${C.cyan(fmt(r.tokens) + (r.tokensExact ? "tok" : "~tok")).padEnd(18)} ` +
          `ttft ${fmt(r.ttftMs, "ms").padStart(7)} ` +
          `total ${fmt(r.totalMs, "ms").padStart(7)} ` +
          `${fmt(r.tps)} tok/s  ` +
          C.dim(`"${r.preview}…"`),
        );
      } catch (err) {
        stats.failed++;
        console.log(`${tag} ${C.red("FAILED")}   ${C.dim(String(err.message ?? err))}`);
      }
      if (!stopping && (opts.count === 0 || nextIndex < opts.count)) {
        await sleep(opts.interval);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, (_, i) => worker(i));
  await Promise.all(workers);

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  console.log("");
  console.log(C.bold("summary"));
  console.log(`  requests  : ${stats.ok} ok, ${stats.failed} failed (${stats.sent} sent)`);
  console.log(`  served by : ${C.green(String(stats.mesh) + " mesh")}, ${C.yellow(String(stats.fallback) + " fallback")}`);
  console.log(`  tokens    : ~${stats.tokens} output tokens generated`);
  console.log(`  avg ttft  : ${fmt(avg(stats.ttfts), "ms")}`);
  console.log(`  avg tok/s : ${fmt(avg(stats.tpsList))}`);
  if (opts.mode === "chat") {
    await showCredits(opts, "after ");
    console.log(C.dim(`  watch it land: ${opts.base ?? opts.site}/status`));
  }
}

main().catch((err) => {
  console.error(C.red(String(err?.stack ?? err)));
  process.exit(1);
});
