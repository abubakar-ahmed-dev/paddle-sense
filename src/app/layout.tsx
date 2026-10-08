import type { Metadata } from "next";
import Link from "next/link";
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
  title: "PaddleSense — When can I paddle?",
  description:
    "River level watcher for Pakistan's paddling waters — GloFAS data, open models.",
};

const NAV = [
  { href: "/", label: "Rivers" },
  { href: "/retro", label: "Retrodiction" },
  { href: "/about", label: "About the data" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bed text-silt">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ochre focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-bed"
        >
          Skip to content
        </a>
        <header className="border-b border-stone-edge">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
            <Link
              href="/"
              className="text-sm font-semibold tracking-tight hover:text-ochre"
            >
              PaddleSense
            </Link>
            <nav aria-label="Main" className="flex gap-4 text-sm text-silt-dim">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-ochre">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <footer className="border-t border-stone-edge px-4 py-4 text-center text-xs text-silt-dim">
          Grid-cell estimates, not gauges — always confirm with local sources
          before going on the water.
        </footer>
      </body>
    </html>
  );
}
