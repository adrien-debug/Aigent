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
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white dark:bg-zinc-950">
        {children}
      </body>
    </html>
  );
}
