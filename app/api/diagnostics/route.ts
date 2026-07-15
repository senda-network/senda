/**
 * Opt-in diagnostic report ingest + triage read.
 *
 * The local controller (desktop sidecar) POSTs a small, scrubbed bundle
 * here when a machine looks stuck — either automatically (if the user
 * enabled "Help improve Senda" in Settings) or from an explicit "Send
 * diagnostic report" click. This is the classic "help us fix bugs by
 * sharing error reports" channel; it never contains chat content.
 *
 * ## Auth / abuse
 *
 * Ingest is unauthenticated (like `/api/peer-report`): there's no
 * privilege to gain by posting, and the payload is size-capped and the
 * store is capped + TTL'd. The *read* side is gated behind `CRON_SECRET`
 * because, unlike peer-reports, these blobs aren't meant for the public
 * status page — they're internal triage data.
 *
 * The controller talks to us server-to-server (Node `fetch`, no browser
 * Origin), so there's no CORS surface to manage here.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  MAX_REPORT_BYTES,
  listReports,
  putReport,
  storeBackend,
  type DiagnosticReportInput,
} from "./store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WireReport = Partial<{
  installId: unknown;
  trigger: unknown;
  os: unknown;
  arch: unknown;
  runtimeVersion: unknown;
  desktopVersion: unknown;
  backend: unknown;
  vramGb: unknown;
  startupModel: unknown;
  loadedModels: unknown;
  serviceState: unknown;
  runtimeReachable: unknown;
  phase: unknown;
  upgrade: unknown;
  stderrTail: unknown;
  note: unknown;
}>;

function clampString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  return value.length <= max ? value : value.slice(0, max);
}

function clampNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseUpgrade(raw: unknown): DiagnosticReportInput["upgrade"] {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  return {
    installed: clampString(u.installed, 64),
    latest: clampString(u.latest, 64),
    lastOutcome: clampString(u.lastOutcome, 64),
    lastError: clampString(u.lastError, 2048),
  };
}

function parseReport(raw: WireReport): DiagnosticReportInput | null {
  const installId = clampString(raw.installId, 128);
  if (!installId) return null;
  const trigger = raw.trigger === "manual" ? "manual" : "auto";
  return {
    installId,
    trigger,
    os: clampString(raw.os, 32) ?? "unknown",
    arch: clampString(raw.arch, 32) ?? "unknown",
    runtimeVersion: clampString(raw.runtimeVersion, 64),
    desktopVersion: clampString(raw.desktopVersion, 64),
    backend: clampString(raw.backend, 32),
    vramGb: clampNumber(raw.vramGb),
    startupModel: clampString(raw.startupModel, 256),
    loadedModels: Array.isArray(raw.loadedModels)
      ? raw.loadedModels
          .map((s) => clampString(s, 256))
          .filter((s): s is string => !!s)
          .slice(0, 16)
      : [],
    serviceState: clampString(raw.serviceState, 32),
    runtimeReachable: raw.runtimeReachable === true,
    phase: clampString(raw.phase, 256),
    upgrade: parseUpgrade(raw.upgrade),
    // Hard cap the log tail below the overall payload budget so a
    // pathological log can't blow the store row size.
    stderrTail: clampString(raw.stderrTail, 12_000) ?? "",
    note: clampString(raw.note, 1024),
  };
}

export async function POST(req: Request) {
  const lenHeader = req.headers.get("content-length");
  if (lenHeader) {
    const len = Number.parseInt(lenHeader, 10);
    if (Number.isFinite(len) && len > MAX_REPORT_BYTES) {
      return NextResponse.json({ error: "report too large" }, { status: 413 });
    }
  }

  let body: WireReport;
  try {
    const text = await req.text();
    if (text.length > MAX_REPORT_BYTES) {
      return NextResponse.json({ error: "report too large" }, { status: 413 });
    }
    body = JSON.parse(text) as WireReport;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const report = parseReport(body);
  if (!report) {
    return NextResponse.json({ error: "missing installId" }, { status: 400 });
  }

  const id = randomUUID();
  const stored = await putReport(report, id);
  return NextResponse.json({
    ok: true,
    id: stored.id,
    receivedAtUnix: stored.receivedAtUnix,
  });
}

/**
 * Internal triage read. Gated behind `CRON_SECRET` (same secret used by
 * the KPI cron) via either `?secret=` or `Authorization: Bearer`.
 *
 *   GET /api/diagnostics?secret=…&limit=100
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, message: "Diagnostics read is not configured." },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret")?.trim() ||
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (provided !== secret) {
    return NextResponse.json({ ok: false, message: "unauthorized" }, {
      status: 401,
    });
  }

  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200;
  const reports = await listReports(limit);
  return NextResponse.json({
    ok: true,
    backend: storeBackend(),
    count: reports.length,
    reports,
  });
}
