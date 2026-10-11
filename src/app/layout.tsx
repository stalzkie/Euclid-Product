import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Euclid",
  description:
    "An embeddable feedback board that turns what users want into a prompt your coding agent can build.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
