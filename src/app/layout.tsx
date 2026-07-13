import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "GUESTPOSTLINKS — Internal Tools",
  description: "Internal tooling for GUESTPOSTLINKS: publisher scouting, link insertion, indexing, and doc workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning on <html>: the theme-init script below sets data-theme
  // before React hydrates, which is an intentional mismatch, not a bug.
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      {/* suppressHydrationWarning tolerates DOM tweaks from browser extensions */}
      <body suppressHydrationWarning>
        {/* Sets data-theme before paint so switching to dark mode never flashes light first. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`
            try {
              var raw = localStorage.getItem("sps_settings");
              var theme = (raw && JSON.parse(raw).theme) || "light";
              var resolved = theme === "system"
                ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
                : theme;
              document.documentElement.setAttribute("data-theme", resolved);
            } catch (e) {}
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
