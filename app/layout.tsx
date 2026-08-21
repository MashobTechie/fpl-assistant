import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";

import "./globals.css";

/**
 * Barlow is the closest widely available match to Premier Sans — the same
 * slightly squared, athletic geometry, and proper tabular figures, which
 * matters more here than it sounds: every screen in this app is a table of
 * numbers that has to line up.
 *
 * next/font self-hosts both faces at build time, so there is no request to
 * Google on page load and no flash of fallback text.
 */
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FPL Assistant — data-driven gameweek analysis",
  description:
    "Expected-points projections and analyst reasoning for your Fantasy Premier League squad.",
};

export const viewport: Viewport = {
  themeColor: "#16001a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
