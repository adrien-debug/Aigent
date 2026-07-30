import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// ONE typeface across the whole product — Satoshi Variable, for EVERYTHING
// including KPIs and numbers. The former rule that held numeric/tabular values
// in a monospace face (Geist Mono) was dropped: `--font-mono` now also resolves
// to Satoshi (globals.css), so the mono load is gone and every surface reads in
// a single voice. See README → "Typography".
const satoshi = localFont({
  variable: "--font-satoshi",
  src: [
    {
      path: "../../public/fonts/satoshi/Satoshi-Variable.woff2",
      style: "normal",
    },
    {
      path: "../../public/fonts/satoshi/Satoshi-VariableItalic.woff2",
      style: "italic",
    },
  ],
});

export const metadata: Metadata = {
  title: "Agent Mission Control",
  description:
    "Central console to manage copilot agents across platforms — manifests, tools, tests, benchmarks, replay, shadow mode and promotion gates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // `dark` is what activates every `dark:` utility in the design system —
      // globals.css binds the variant to the CLASS, not to prefers-color-scheme,
      // so dark is the product's identity rather than the reader's OS setting.
      className={`dark ${satoshi.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white dark:bg-surface-app">
        {children}
      </body>
    </html>
  );
}
