import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://senda.network"),
  title: "Senda — open peer-to-peer LLM",
  description:
    "Chat with an LLM served by a peer-to-peer mesh of contributed compute. No third-party API behind it. Run a node yourself or just use the chat.",
  openGraph: {
    type: "website",
    siteName: "Senda",
    url: "https://senda.network",
    title: "Senda — open-source AI, served by the people",
    description:
      "A peer-to-peer network for open language models: use models other people serve, or run the app and serve them yourself. No third-party AI provider in between. Chat in your browser or run a node.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Senda — open-source AI, served by the people",
    description:
      "A peer-to-peer network for open language models: use models other people serve, or run the app and serve them yourself. No third-party AI provider in between.",
  },
};

// Runs before first paint to set the persisted theme, avoiding a light/dark
// flash. "system" (or unset) leaves the attribute off so the CSS
// prefers-color-scheme media query governs. Keep in sync with app/lib/theme.ts.
const themeScript = `(function(){try{var t=localStorage.getItem("senda:theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
