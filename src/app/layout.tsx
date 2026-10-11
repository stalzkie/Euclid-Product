import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted at build time rather than linked from fonts.googleapis.com: the
// glyphs are identical, but the browser makes no third-party request and no
// render-blocking stylesheet sits in front of the first paint.
const sans = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Euclid",
  description:
    "An embeddable feedback board that turns what users want into a prompt your coding agent can build.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
