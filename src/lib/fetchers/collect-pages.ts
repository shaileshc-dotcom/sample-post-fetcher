import { httpGet, toBaseUrl, normalizeDomain } from "@/lib/http";
import { discoverFeeds } from "./discover";
import { fetchFeed } from "./rss";
import { fetchSitemapUrls } from "./sitemap";
import { extractArticleLinks } from "./homepage";

export interface PageCandidate {
  url: string;
  title: string | null;
  lastmod: string | null;
}

const JUNK = /\/(tag|category|author|page\/|wp-|feed|cart|checkout|account|login|privacy|terms|contact|about|advertise)\b/i;

/**
 * Gather many candidate pages from a site as fast as possible (no per-article
 * GET) — sitemap is the richest source, supplemented by homepage + RSS for
 * titles. Used by the Link Insertion matcher, which needs breadth to search.
 */
export async function collectPages(rawDomain: string, max = 200, timeoutMs = 12000): Promise<PageCandidate[]> {
  const domain = normalizeDomain(rawDomain);
  const base = toBaseUrl(domain);
  const map = new Map<string, PageCandidate>();
  const add = (url: string, title: string | null, lastmod: string | null) => {
    if (!url || map.has(url)) return;
    try {
      const u = new URL(url);
      if (JUNK.test(u.pathname)) return;
      if (u.pathname === "/" || u.pathname === "") return;
    } catch {
      return;
    }
    map.set(url, { url, title: title || null, lastmod: lastmod || null });
  };

  // 1) Sitemap — the widest net.
  try {
    const entries = await fetchSitemapUrls(domain, { limit: max, timeoutMs });
    for (const e of entries) add(e.url, null, e.lastmod);
  } catch {
    /* continue */
  }

  // 2) Homepage links + RSS titles.
  try {
    const home = await httpGet(base, { timeoutMs });
    if (home.data) {
      for (const l of extractArticleLinks(home.data, base)) add(l.url, l.title, null);
      const feeds = discoverFeeds(home.data, base);
      for (const f of feeds.slice(0, 2)) {
        try {
          const items = await fetchFeed(f);
          for (const it of items) add(it.url, it.title, it.publishedDate);
          if (items.length) break;
        } catch {
          /* next feed */
        }
      }
    }
  } catch {
    /* continue */
  }

  return [...map.values()].slice(0, max);
}
