import Image from "next/image";
import Link from "next/link";

/**
 * Product screenshots for the marketing site. Real captures of the Senda
 * desktop shell (chat, first-run setup) and the public web chat — framed
 * in minimal macOS-style chrome so they read as product shots, not raw
 * browser grabs pasted into the page.
 */
export function AppShowcase() {
  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <ShowcaseCard
        label="Chat"
        title="Private LLM, right in the app"
        body="Stream answers from the mesh with model selection, thread history, and no account."
        href="/download"
        cta="Get the app"
        src="/screenshots/app-chat.png"
        alt="Senda desktop app chat with sidebar navigation and a streamed mesh response"
        priority
      />
      <ShowcaseCard
        label="Setup"
        title="One click to join the mesh"
        body="Install the runtime, opt into staying live on login, and start contributing capacity."
        href="/contribute"
        cta="How to contribute"
        src="/screenshots/app-setup.png"
        alt="Senda first-run setup screen with Install and join the mesh call to action"
      />
      <ShowcaseCard
        label="Web"
        title="Try it in the browser first"
        body="No install required — chat at senda.network, then graduate to the desktop app when you want to run a node."
        href="#top"
        cta="Try the mesh"
        src="/screenshots/app-chat-web.png"
        alt="Senda web chat at senda.network with a streamed response"
      />
    </div>
  );
}

function ShowcaseCard({
  label,
  title,
  body,
  href,
  cta,
  src,
  alt,
  priority,
}: {
  label: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  src: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <MacWindow title={`Senda — ${label}`}>
        <Image
          src={src}
          alt={alt}
          width={1440}
          height={900}
          priority={priority}
          className="h-auto w-full"
          sizes="(max-width: 1024px) 100vw, 33vw"
        />
      </MacWindow>
      <div className="mt-5 flex flex-1 flex-col px-1">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {label}
        </div>
        <div className="mt-1.5 text-lg font-semibold tracking-tight">{title}</div>
        <p className="mt-2 flex-1 text-[14px] leading-relaxed text-[var(--fg-muted)]">
          {body}
        </p>
        <Link
          href={href}
          className="mt-4 text-[13px] text-[var(--accent)] hover:underline"
        >
          {cta} →
        </Link>
      </div>
    </div>
  );
}

function MacWindow({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] shadow-[0_24px_60px_-28px_rgba(17,32,26,0.22)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 truncate text-center text-[11px] font-medium text-[var(--fg-muted)]">
          {title}
        </div>
        <div className="w-[52px]" aria-hidden />
      </div>
      <div className="bg-[var(--bg)]">{children}</div>
    </div>
  );
}
