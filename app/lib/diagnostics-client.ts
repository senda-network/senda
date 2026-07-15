/**
 * Client helper for sending an opt-in diagnostic report from the
 * dashboard to the local controller, which scrubs + forwards it to
 * senda.network. See `app/api/control/diagnostics/route.ts`.
 *
 * The controller enforces the opt-in for `trigger: "auto"`, so callers
 * can fire auto reports without knowing the setting — an opted-out
 * machine simply no-ops server-side.
 */

export type DiagnosticContext = {
  runtimeVersion?: string | null;
  backend?: string | null;
  vramGb?: number | null;
  startupModel?: string | null;
  loadedModels?: string[];
  serviceState?: string | null;
  runtimeReachable?: boolean;
  phase?: string | null;
};

export type DiagnosticSendResult = {
  ok: boolean;
  sent: boolean;
  id?: string | null;
  reason?: string;
  message?: string;
};

export async function sendDiagnostics(
  trigger: "auto" | "manual",
  context: DiagnosticContext,
): Promise<DiagnosticSendResult> {
  try {
    const res = await fetch("/api/control/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger, context }),
    });
    return (await res.json()) as DiagnosticSendResult;
  } catch (e) {
    return {
      ok: false,
      sent: false,
      message: e instanceof Error ? e.message : "request failed",
    };
  }
}
