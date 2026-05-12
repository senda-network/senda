import { Sidebar } from "../components/Sidebar";
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
  // The shell is pinned to the viewport — `h-dvh` + `overflow-hidden` on the
  // outer flex row stops the document body from ever scrolling. The sidebar
  // then naturally fills the full viewport height (default flex stretch),
  // and the right pane is the lone scroll container so the page header on
  // each route stays sticky to its own pane instead of disappearing off the
  // top of the document with the sidebar in tow.
  //
  // `DownloadsProvider` wraps every control route so that an in-flight
  // model download stays alive when the user hops between Models, Mesh,
  // Status, etc. The previous setup kept `downloads` state inside
  // `models/page.tsx` and lost it on every navigation; see
  // `app/lib/downloads-context.tsx` for the full rationale.
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <DownloadsProvider>{children}</DownloadsProvider>
      </div>
    </div>
  );
}
