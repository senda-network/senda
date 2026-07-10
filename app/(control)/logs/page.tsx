"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { Input } from "../../components/ui/Input";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Switch } from "../../components/ui/Switch";

type LogsResp = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
};

type Stream = "stdout" | "stderr";

export default function LogsPage() {
  const [logs, setLogs] = useState<{ stdout: string; stderr: string }>({
    stdout: "",
    stderr: "",
  });
  const [stream, setStream] = useState<Stream>("stdout");
  const [autoFollow, setAutoFollow] = useState(true);
  const [query, setQuery] = useState("");
  const paneRef = useRef<HTMLPreElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/control/logs", { cache: "no-store" });
      const data = (await res.json()) as LogsResp;
      if (data.ok) {
        setLogs({
          stdout: data.stdout ?? "",
          stderr: data.stderr ?? "",
        });
      }
    } catch {
      // transient
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!autoFollow) return;
    const el = paneRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, stream, autoFollow]);

  const body = cleanLogBody(stream === "stdout" ? logs.stdout : logs.stderr);
  const errorCount = countLines(logs.stderr);

  const { display, matchCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { display: body, matchCount: null as number | null };
    const lines = body.split("\n").filter((l) => l.toLowerCase().includes(q));
    return { display: lines.join("\n"), matchCount: lines.length };
  }, [body, query]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Activity"
        subtitle="What Senda is doing on this machine — handy if something looks off."
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-elev)] px-6 py-2.5">
          <SegmentedControl<Stream>
            size="sm"
            value={stream}
            onChange={setStream}
            options={[
              { value: "stdout", label: "Activity" },
              {
                value: "stderr",
                label:
                  errorCount > 0 ? `Errors · ${errorCount}` : "Errors",
              },
            ]}
          />
          <div className="flex items-center gap-3">
            <div className="relative">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="h-8 w-44 py-1 text-[12px]"
              />
              {matchCount !== null && (
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--fg-subtle)]">
                  {matchCount}
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 text-[11px] text-[var(--fg-muted)]">
              <Switch
                checked={autoFollow}
                onChange={setAutoFollow}
                label="Follow latest"
              />
              Follow latest
            </label>
          </div>
        </div>

        <pre
          ref={paneRef}
          className="flex-1 overflow-auto bg-[#0a0e0c] px-6 py-4 font-mono text-[11px] leading-5 text-[#9db3a6] scrollbar-thin"
        >
{display ||
  (query.trim()
    ? "No lines match your filter."
    : stream === "stdout"
      ? "Quiet so far. Activity will show up here as the mesh runs."
      : "No errors. That's good.")}
        </pre>
      </main>
    </div>
  );
}

function countLines(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith("\n") ? n : n + 1;
}

// The runtime is a CLI app written for an interactive terminal: it emits
// ANSI control codes (CSI sequences like ESC[2K to erase a line, ESC[?25l
// to hide the cursor, ESC[<n>m for colors) and Braille-glyph spinners
// (U+2800–U+28FF, e.g. ⠧⠴⠦⠇) that overwrite the previous frame in place.
// In a real terminal this looks like a single animated line. Once it's
// captured to senda.out.log via VBS redirection, every redraw becomes
// a separate physical line and the user sees:
//
//   [2K⠧ Preparing download Mixtral-8x7B-Instruct-v0.1.q5_k_m.gguf
//   [2K⠴ Preparing download Mixtral-8x7B-Instruct-v0.1.q5_k_m.gguf
//   [2K⠦ Preparing download Mixtral-8x7B-Instruct-v0.1.q5_k_m.gguf
//   ... × 121
//
// which is what the user complained about ("they are one line logs,
// pretty annoying"). We post-process the buffer client-side: strip the
// escape sequences, then collapse consecutive lines whose only
// difference is the spinner glyph. Distinct progress samples
// ("Downloading 17%" → "Downloading 44%") survive because they differ
// after the spinner.
function cleanLogBody(body: string): string {
  if (!body) return body;
  const cleaned = body
    // CSI: ESC [ ... <final-byte>. Final byte is 0x40–0x7E.
    .replace(/\u001b\[[0-9;?]*[A-Za-z@`~^_]/g, "")
    // OSC: ESC ] ... BEL (and 7-bit ESC \). Used for window titles.
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    // Lone CRs from \r-only progress writes that didn't get split.
    .replace(/\r(?!\n)/g, "\n");
  const lines = cleaned.split(/\r?\n/);
  const out: string[] = [];
  let prevKey: string | null = null;
  for (const line of lines) {
    // The "key" is the line with the leading Braille spinner stripped.
    // Two consecutive frames of the same animation share a key; a
    // genuine new message (different text or different progress %) does
    // not.
    const key = line.replace(/^\s*[\u2800-\u28FF]\s*/, "").trimEnd();
    if (prevKey !== null && key === prevKey && key !== "") {
      // Same frame as the previous line — replace rather than append so
      // the latest spinner glyph wins (visual currency without the
      // duplication).
      out[out.length - 1] = line;
      continue;
    }
    out.push(line);
    prevKey = key;
  }
  return out.join("\n");
}
