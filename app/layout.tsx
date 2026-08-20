import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FPL Assistant — data-driven gameweek analysis",
  description:
    "Expected-points projections and analyst reasoning for your Fantasy Premier League squad.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
