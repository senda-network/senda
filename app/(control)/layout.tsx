import { AppShell } from "../components/AppShell";
import { DownloadsProvider } from "../lib/downloads-context";

// Don't statically prerender the control surface. The desktop app's
// bundled sidecar serves these pages, and prerendered HTML carries
// `Cache-Control: s-maxage=31536000` plus build-pinned `<link href>`s
// to chunk hashes. When users upgrade the .app, those hashes change but
// WKWebView happily serves the year-old cached HTML, which then 404s on
// CSS/JS chunks that no longer exist on disk — leaving them with an
// unstyled dashboard. Force dynamic rendering + the `no-store` headers
// in next.config.ts together keep every load honest.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // AppShell is the chat-first control shell: a slim top bar (brand, global
  // Sharing control, quiet icon rail, Cmd-K palette) over a single bounded
  // scroll area that renders the active route. It pins itself to the viewport
  // (`h-dvh` + `overflow-hidden`) so the page is the lone scroll container.
  //
  // `DownloadsProvider` wraps every control route so that an in-flight model
  // download stays alive when the user moves between surfaces. The previous
  // setup kept `downloads` state inside `models/page.tsx` and lost it on every
  // navigation; see `app/lib/downloads-context.tsx` for the full rationale.
  return (
    <DownloadsProvider>
      <AppShell>{children}</AppShell>
    </DownloadsProvider>
  );
}
