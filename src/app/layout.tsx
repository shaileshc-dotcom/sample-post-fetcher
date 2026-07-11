import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "GUESTPOSTLINKS — Internal Tools",
  description: "Internal tooling for GUESTPOSTLINKS: publisher scouting, link insertion, indexing, and doc workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${mono.variable}`}>
      {/* suppressHydrationWarning tolerates DOM tweaks from browser extensions */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
