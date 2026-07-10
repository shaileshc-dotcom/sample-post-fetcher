import { httpGet, toBaseUrl, normalizeDomain } from "@/lib/http";
import { detectCms, discoverFeeds } from "./discover";
import type { DomainAnalysis } from "@/lib/types";

/** Lightweight technical fingerprint of a domain for the analysis panel. */
export async function analyzeDomain(rawDomain: string): Promise<DomainAnalysis> {
  const domain = normalizeDomain(rawDomain);
  const base = toBaseUrl(domain);

  const t0 = Date.now();
  const home = await httpGet(base, { timeoutMs: 12000 });
  const responseTimeMs = Date.now() - t0;

  const headers = home.headers;
  const { wordpress, cms } = detectCms(home.data || "", headers);

  // Probe robots.txt + sitemap presence cheaply.
  const [robots, sitemap] = await Promise.all([
    httpGet(`${base}/robots.txt`, { timeoutMs: 8000 }),
    httpGet(`${base}/sitemap.xml`, { timeoutMs: 8000, accept: "application/xml" }),
  ]);

  const feeds = discoverFeeds(home.data || "", base);

  return {
    domain,
    https: home.finalUrl.startsWith("https://"),
    robotsTxt: robots.ok && robots.data.length > 0,
    sitemap: sitemap.ok && sitemap.data.includes("<"),
    rss: feeds.length > 0,
    wordpress,
    cms,
    server: headers["server"] || null,
    ip: null, // resolved server-side via dns in route if needed
    cloudflare:
      (headers["server"] || "").toLowerCase().includes("cloudflare") ||
      "cf-ray" in headers,
    responseTimeMs,
    redirects: home.redirects,
    finalStatus: home.status || null,
  };
}
