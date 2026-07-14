import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const images = message.parts.filter(
    (p): p is { type: "file"; mediaType: string; url: string; filename?: string } =>
      p.type === "file" &&
      typeof (p as { mediaType?: string }).mediaType === "string" &&
      (p as { mediaType: string }).mediaType.startsWith("image/"),
  );

  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-left text-[15px] leading-relaxed",
          isUser
            ? "bg-[var(--bg-elev-2)] text-[var(--fg)] whitespace-pre-wrap"
            : "bg-transparent text-[var(--fg)]",
        ].join(" ")}
      >
        {!isUser && (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            Senda
          </div>
        )}
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img.url}
                alt={img.filename ?? "attached image"}
                className="max-h-64 rounded-lg border border-[var(--border)] object-contain"
              />
            ))}
          </div>
        )}
        {!text && images.length === 0 && !isUser ? (
          <span className="inline-flex items-center gap-1 text-[var(--fg-muted)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--fg-muted)] pulse-soft" />
            <span className="text-xs">thinking…</span>
          </span>
        ) : text ? (
          isUser ? (
            text
          ) : (
            <div className="senda-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
