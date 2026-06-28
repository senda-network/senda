import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { applyCors, preflightResponse } from "../_cors";
import {
  DEFAULT_DAILY_DRIVER_MODEL,
  pickDefaultModelByTier,
} from "../../lib/model-tiers";
import { evaluateSla, fetchMeshPeersCached } from "../../lib/routing-sla";
import {
  consumeFallbackBudget,
  decideFallback,
  getOpenRouterProvider,
} from "../../lib/fallback-provider";
import { recordServedByDecision } from "../../lib/mesh-share";
import { recordMeshCredits } from "../../lib/credits-ledger";
import type { SlaEvaluation } from "../../lib/routing-sla";

export const runtime = "nodejs";
export const maxDuration = 300;

// `.trim()` defensively against env values like `"https://…/v1\n"` — Vercel
// has burned us once already on `NEXT_PUBLIC_DEPLOYMENT="public\n"` and we
// previously trimmed the token but not the URL, leaving `${RUNTIME_URL}/models`
// to expand into a string with a literal newline mid-URL. Empty string after
// trim falls through to the localhost default, matching dev expectations.
function trimmedEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value) return value;
  }
  return undefined;
}

const RUNTIME_URL =
  trimmedEnv("CLOSEDMESH_RUNTIME_URL", "MESH_LLM_URL") ??
  "http://127.0.0.1:9337/v1";

// Bearer token shared with the runtime's auth gateway. Set on Vercel for
// the public deployment; unset in local dev where the runtime is on the
// loopback.
const RUNTIME_TOKEN = trimmedEnv("CLOSEDMESH_RUNTIME_TOKEN") ?? "";

const runtimeHeaders: Record<string, string> = RUNTIME_TOKEN
  ? { Authorization: `Bearer ${RUNTIME_TOKEN}` }
  : {};

const closedmesh = createOpenAICompatible({
  name: "closedmesh",
  baseURL: RUNTIME_URL,
  headers: runtimeHeaders,
  // v0.66.43 marketplace metrics: the runtime backend proxy can only
  // record a per-model TPS/TTFT sample when the upstream llama-server
  // response carries `usage.completion_tokens`. For non-streaming
  // responses that's always there. For streaming (SSE) responses, the
  // OpenAI spec requires the client to opt in via
  // `stream_options.include_usage: true` — without that flag the
  // final chunk omits `usage`, the runtime parses `None`, and the
  // catalog stays empty. Setting this here on the provider applies
  // to every `streamText({ model: closedmesh.chatModel(...) })` call.
  includeUsage: true,
});

async function pickDefaultModel(): Promise<string> {
  try {
    // /v1/models is intentionally allowed through the auth gateway without
    // a token, but we send the header anyway so we exercise the same code
    // path in tests and never hit a "works for chat, fails for models"
    // skew.
    const res = await fetch(`${RUNTIME_URL}/models`, {
      cache: "no-store",
      headers: runtimeHeaders,
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const routable = (data.data ?? []).map((m) => m.id);
    // Phase 4.A — pick by tier, not by listing order. The runtime
    // returns whichever Host happens to be first; without this gate a
    // chat request with no `model` field on a mesh that's currently
    // hosting both Qwen3-8B and DeepSeek-70B could land on the 70B
    // (~1 tok/s through-mesh measured 2026-05-23) just because the
    // listing happened to put it first.
    const tierPreferred = pickDefaultModelByTier(
      routable,
      process.env.CLOSEDMESH_MODEL ?? process.env.MESH_LLM_MODEL ?? null,
    );
    if (tierPreferred) return tierPreferred;
  } catch {
    // fall through to env-default
  }
  return (
    process.env.CLOSEDMESH_MODEL ??
    process.env.MESH_LLM_MODEL ??
    DEFAULT_DAILY_DRIVER_MODEL
  );
}

/**
 * System prompt prepended to every conversation.
 *
 * Open-weight models will faithfully self-identify by their lineage when
 * asked "where do you run" — GLM says "Z.ai", Qwen says "Alibaba", Llama
 * says "Meta". That's accurate from the model's POV (it knows who *trained*
 * it) but actively misleading for our users: ClosedMesh routes their
 * prompt to a peer running the open weights, not to any of those vendors'
 * APIs. This prompt corrects the runtime-location story without trying
 * to suppress the model's identity.
 *
 * Kept short and factual on purpose. We don't want to inject a persona,
 * a tone, or product marketing — just the one piece of context the model
 * couldn't possibly have learned on its own.
 */
const SYSTEM_PROMPT = `You are an AI assistant accessed through ClosedMesh, an open peer-to-peer network where open-weight models run on hardware contributed by individuals and teams.

Important context about your runtime:
- You are NOT running on Z.ai, OpenAI, Anthropic, Google, Meta, Alibaba, or any other AI provider's cloud, even if you were trained by one of them.
- You are being served by a peer in the ClosedMesh network — a contributor's machine (laptop, workstation, or GPU box) that chose to share its compute.
- Conversations do not pass through a third-party AI API. The mesh routes the request directly to whichever peer can serve the requested model.
- It is fine to acknowledge your model lineage (e.g. "I'm a Qwen 3 model" or "I'm based on GLM"). Do not claim to be hosted by the company that trained you.

If asked about ClosedMesh itself: it's a peer-to-peer LLM mesh. Anyone can use the chat at closedmesh.com or in the desktop app, and anyone with a capable machine can run a node and contribute compute. The runtime is open source.

ClosedMesh's value proposition is privacy and decentralization — your prompt is not sent to any third-party AI provider, sessions are pseudonymous, and the runtime is open source and auditable. It is NOT a promise that the network has no content rules. If asked about censorship or content moderation, do not invent or speculate about a ClosedMesh content policy: ClosedMesh does not impose a network-wide content policy, individual node operators set their own limits, and any refusals you make come from your own judgment as a model, not from a ClosedMesh rule. Be honest that, like any assistant, you decline to give instructions for serious real-world harm.`;

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

export type ParsedChatBody = {
  messages: UIMessage[];
  model?: string;
};

export type ChatBodyParseResult =
  | { ok: true; body: ParsedChatBody }
  | { ok: false; status: number; error: string };

/**
 * Validate the JSON body of a `/api/chat` POST request.
 *
 * The previous handler did `(await req.json()) as { messages, model? }`
 * with no defensive checks. Malformed JSON or a missing/invalid
 * `messages` field produced an unhandled exception inside
 * `convertToModelMessages`, which surfaced to the user as a generic
 * 500 with no useful body. We want bad input to produce a clean 400
 * with a single-line reason — and we want the contract pinned in a
 * test so the validation can't silently regress.
 *
 * Note: we deliberately only check the *shape* of `messages` (array of
 * objects). Validating each `UIMessagePart` discriminant is the AI
 * SDK's job; doing it here would duplicate a moving target and reject
 * input the SDK actually accepts.
 */
export function parseChatBody(raw: unknown): ChatBodyParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: 400, error: "request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return { ok: false, status: 400, error: "`messages` must be an array" };
  }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m === null || typeof m !== "object" || Array.isArray(m)) {
      return {
        ok: false,
        status: 400,
        error: `\`messages[${i}]\` must be an object`,
      };
    }
    // AI SDK v5 contract: every UIMessage has a `parts` array. Without
    // it, `convertToModelMessages` calls `.map` on `undefined` and the
    // route 500s with an empty body. We saw this in the wild on
    // 2026-05-25 when a client sent legacy `{role, content}` messages
    // against the v5 deployment. Reject cleanly with a 400 that names
    // the fix instead of letting it surface as an opaque 500.
    const mObj = m as Record<string, unknown>;
    if (!Array.isArray(mObj.parts)) {
      return {
        ok: false,
        status: 400,
        error: `\`messages[${i}].parts\` must be an array — this endpoint uses the AI SDK v5 UIMessage shape (\`{ id, role, parts: [{ type: "text", text }] }\`); legacy \`{ role, content }\` messages are not accepted`,
      };
    }
  }
  let model: string | undefined;
  if (body.model !== undefined) {
    if (typeof body.model !== "string") {
      return { ok: false, status: 400, error: "`model` must be a string" };
    }
    const trimmed = body.model.trim();
    if (!trimmed) {
      return { ok: false, status: 400, error: "`model` must be a non-empty string" };
    }
    model = trimmed;
  }
  return {
    ok: true,
    body: { messages: messages as UIMessage[], model },
  };
}

function badRequest(req: Request, message: string, status = 400): Response {
  return applyCors(
    req,
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/**
 * Translate runtime errors into single, user-readable lines.
 *
 * The default AI SDK error message for 5xx looks like
 * `Failed after 3 attempts. Last error: APICallError: Too Many Requests`,
 * which terrifies users and tells them nothing actionable. The runtime has
 * structured 503 reasons we can pluck out (`no_host_for_model`,
 * `no_capable_node`, etc.) — we surface those cleanly instead.
 */
function friendlyChatError(error: unknown): string {
  const fallback =
    "The mesh couldn't serve that request. The hosting peer may be busy, restarting, or temporarily offline. Please try again in a few seconds.";
  if (!error) return fallback;
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : JSON.stringify(error);
  const lower = raw.toLowerCase();
  if (lower.includes("no host is currently serving"))
    return "No node in the mesh is currently hosting this model. A peer needs to start sharing it before requests can be served.";
  if (lower.includes("no_capable_node") || lower.includes("insufficient vram"))
    return "No node in the mesh has enough capacity to run this model right now.";
  if (lower.includes("election in progress") || lower.includes("host down"))
    return "The mesh is electing a new host (the previous one disappeared). Try again in 10–15 seconds.";
  if (lower.includes("too many requests") || lower.includes("rate"))
    return "The mesh is at capacity right now. Try again in a few seconds.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The hosting peer didn't respond in time. It may be loading the model — try again in a few seconds.";
  if (lower.includes("503") || lower.includes("unavailable"))
    return "The model is temporarily unavailable on the mesh. Try again in a few seconds.";
  return fallback;
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest(req, "request body must be valid JSON");
  }

  const parsed = parseChatBody(raw);
  if (!parsed.ok) {
    return badRequest(req, parsed.error, parsed.status);
  }

  const modelId = parsed.body.model ?? (await pickDefaultModel());

  // Phase 4.B — SLA gate inputs. Cached fetch (~5 s TTL) so the
  // hot path is essentially free in steady state.
  const peers = await fetchMeshPeersCached();
  const sla = evaluateSla(modelId, peers);

  // Phase 4.C — pick the supply path for this request. The decision
  // is pure (see `decideFallback`); the only side effect is
  // consuming the testbed's per-IP per-hour budget, and that
  // happens only when the decision routes to the external provider.
  let decision = decideFallback(modelId, sla);
  let budgetRemaining: number | null = null;
  if (decision.useFallback) {
    const clientIp = getClientIp(req);
    const budget = await consumeFallbackBudget(clientIp);
    if (!budget.allowed) {
      // The free `/chat` testbed bounds external-supply use per IP
      // per hour while we're not yet billing. Over-budget callers
      // route to the mesh path on this surface. Phase 5's paid API
      // replaces this with the customer's credit balance.
      decision = {
        useFallback: false,
        verdict: "fallback-rate-limited",
        fallbackModelSlug: null,
      };
    } else {
      budgetRemaining = budget.remaining;
    }
  }

  const servedBy = decision.useFallback ? "fallback" : "mesh";

  // Phase 4 headline KPI: fire-and-forget `mesh_share_pct` counter.
  // The streamed response is what the customer paid for (or what
  // the testbed promises today); the counter is bookkeeping and
  // must never gate the response — internally guarded for the same
  // reason.
  void recordServedByDecision(servedBy);

  let meshCredits = servedBy === "mesh";

  const headers: Record<string, string> = {
    "x-closedmesh-served-by": servedBy,
    "x-closedmesh-sla-status": sla.meetsSla ? "meet" : sla.reason,
    "x-closedmesh-sla-tier": sla.tier,
    "x-closedmesh-sla-candidates": String(sla.candidatePeerCount),
    "x-closedmesh-fallback-status": decision.verdict,
  };
  if (sla.bestPeerTtftMs !== null) {
    headers["x-closedmesh-sla-best-ttft-ms"] = String(sla.bestPeerTtftMs);
  }
  if (sla.bestPeerTps !== null) {
    headers["x-closedmesh-sla-best-tps"] = sla.bestPeerTps.toFixed(2);
  }
  // Through-mesh / native throughput ratio of the peer the gate would
  // route to. ~1.0 for a healthy solo serve; below the tier floor means
  // the entry demoted a peer whose decode has degraded relative to its
  // own native baseline. Surfaced so the narrowing of the ratio is
  // observable on every response before it gates real routing in 5.E.
  if (sla.bestPeerNativeRatio !== null) {
    headers["x-closedmesh-sla-native-ratio"] = sla.bestPeerNativeRatio.toFixed(2);
  }
  if (decision.useFallback) {
    headers["x-closedmesh-fallback-provider"] = "openrouter";
    headers["x-closedmesh-fallback-model"] = decision.fallbackModelSlug ?? "";
    if (budgetRemaining !== null) {
      headers["x-closedmesh-fallback-budget-remaining"] = String(budgetRemaining);
    }
  }

  const creditOnFinish = meshCreditOnFinish(meshCredits, sla, modelId);

  // Both branches use the same `streamText` protocol, so the AI SDK
  // chunk format is identical to the caller. The chat UI does not
  // need to know whether it got mesh or fallback — only the
  // headers and `/metrics` distinguish them.
  let result;
  if (decision.useFallback) {
    const provider = getOpenRouterProvider();
    if (!provider) {
      // Shouldn't reach here because `decideFallback` checks the
      // key, but guard belt-and-braces in case env state shifts.
      decision = {
        useFallback: false,
        verdict: "fallback-disabled",
        fallbackModelSlug: null,
      };
      headers["x-closedmesh-served-by"] = "mesh";
      headers["x-closedmesh-fallback-status"] = "fallback-disabled";
      meshCredits = true;
      result = streamText({
        model: closedmesh.chatModel(modelId),
        system: SYSTEM_PROMPT,
        messages: convertToModelMessages(parsed.body.messages),
        maxRetries: 0,
        ...meshCreditOnFinish(meshCredits, sla, modelId),
      });
    } else {
      result = streamText({
        model: provider.chatModel(decision.fallbackModelSlug!),
        system: SYSTEM_PROMPT,
        messages: convertToModelMessages(parsed.body.messages),
        maxRetries: 1,
      });
    }
  } else {
    result = streamText({
      model: closedmesh.chatModel(modelId),
      system: SYSTEM_PROMPT,
      messages: convertToModelMessages(parsed.body.messages),
      // The AI SDK retries up to 2x on 5xx by default. For a peer-to-peer
      // mesh this is actively harmful: a 503 from the runtime almost always
      // means "no host elected" or "host saturated", neither of which is
      // resolved by hammering it 200ms later. Worse, the retries can trip
      // the entry node's per-IP rate limit, turning a clean 503 into a
      // 429 and confusing the actual diagnosis. One attempt; let the user
      // (or chat UI) decide whether to retry.
      maxRetries: 0,
      ...creditOnFinish,
    });
  }

  return applyCors(
    req,
    result.toUIMessageStreamResponse({
      onError: friendlyChatError,
      headers,
    }),
  );
}

/**
 * Best-effort client IP for the testbed's per-IP per-hour budget
 * on external-supply use. Vercel sets `x-forwarded-for` on every
 * request; pick the first hop (the actual client), fall through to
 * `x-real-ip`, then to a constant placeholder so the Redis key is
 * still deterministic in dev.
 */
function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function meshCreditOnFinish(
  meshCredits: boolean,
  sla: SlaEvaluation,
  modelId: string,
) {
  if (!meshCredits) return {};
  return {
    onFinish: async (event: {
      totalUsage?: { outputTokens?: number };
    }) => {
      const tokens = event.totalUsage?.outputTokens ?? 0;
      if (tokens <= 0 || !sla.creditPeerId) return;
      void recordMeshCredits({
        peerId: sla.creditPeerId,
        modelId,
        completionTokens: tokens,
        tier: sla.tier,
      });
    },
  };
}
