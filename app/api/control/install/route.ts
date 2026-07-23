import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isPublic } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs the bundled `public/install.sh` for the current host. Streams stdout
 * and stderr back to the caller as newline-delimited JSON events so the
 * dashboard can show live progress without a second polling endpoint.
 *
 * Each line is one of:
 *
 *   {"kind":"stdout","text":"…"}
 *   {"kind":"stderr","text":"…"}
 *   {"kind":"done","ok":true,"code":0}
 *   {"kind":"error","message":"…"}
 *
 * The dashboard parses the stream and surfaces an in-app log pane. We
 * intentionally do *not* use SSE because the AI SDK's transport already
 * monopolises EventSource semantics for /api/chat; sticking to a plain
 * `text/plain` stream keeps the client wiring tiny.
 */
export async function POST(req: Request) {
  if (isPublic) {
    return new Response(
      JSON.stringify({
        ok: false,
        message:
          "The hosted public site can't install software on your machine. Download the desktop app first.",
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  // The Setup component sends { autoStart: boolean }. Default is false —
  // the runtime should only run while the desktop app is open unless the
  // user explicitly opts into login/background always-on.
  let autoStart = false;
  try {
    const body = (await req.json()) as { autoStart?: boolean };
    if (body && typeof body.autoStart === "boolean") {
      autoStart = body.autoStart;
    }
  } catch {
    // No body / not JSON — keep default (autoStart = false).
  }

  // We avoid `curl | sh` to keep the supply chain visible: the install
  // script is shipped inside this very controller bundle. If somebody
  // tampered with `public/install.{sh,ps1}` they already had write access.
  const scriptName =
    process.platform === "win32" ? "install.ps1" : "install.sh";
  const scriptPath = path.join(process.cwd(), "public", scriptName);
  try {
    await fs.access(scriptPath);
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        message: `${scriptName} not found at ${scriptPath}`,
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      };

      // Same shape across platforms: pass `--service` / `-Service` to
      // include the OS-native autostart unit so the runtime survives
      // logout/reboot. The desktop's first-launch Rust path also calls
      // this when the user is already past initial setup.
      let cmd: string;
      let args: string[];
      if (process.platform === "win32") {
        cmd = "powershell";
        args = [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
        ];
        if (autoStart) args.push("-Service");
        send({ kind: "stdout", text: `${cmd} ${args.join(" ")}` });
      } else {
        cmd = "bash";
        args = autoStart ? [scriptPath, "--service"] : [scriptPath];
        send({ kind: "stdout", text: `bash ${args.join(" ")}` });
      }

      const child = spawn(cmd, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        // Hide the powershell.exe console on Windows. The sub-processes
        // it launches (Invoke-WebRequest, schtasks, Register-ScheduledTask)
        // also inherit no-window via this flag.
        windowsHide: true,
      });

      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");

      child.stdout.on("data", (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.length > 0) send({ kind: "stdout", text: line });
        }
      });
      child.stderr.on("data", (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.length > 0) send({ kind: "stderr", text: line });
        }
      });

      child.on("error", (err) => {
        send({ kind: "error", message: err.message });
        controller.close();
      });
      child.on("close", (code) => {
        send({ kind: "done", ok: code === 0, code: code ?? -1 });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Hint to proxies that this is a long-lived response. (Vercel
      // wouldn't run the install endpoint anyway — see isPublic guard
      // above — but a corp proxy in front of a self-hosted controller
      // might.)
      "x-content-type-options": "nosniff",
    },
  });
}
