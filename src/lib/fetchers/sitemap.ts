import { XMLParser } from "fast-xml-parser";
import { httpGet, toBaseUrl } from "@/lib/http";

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

/**
 * Resolve a domain's sitemap into a list of URLs. Follows ONE level of
 * sitemap-index nesting (prioritizing post/blog/article child maps) so we
 * never explode on huge enterprise sitemaps.
 */
export async function fetchSitemapUrls(
  domain: string,
  opts: { limit?: number; timeoutMs?: number } = {}
): Promise<SitemapEntry[]> {
  const { limit = 50, timeoutMs = 12000 } = opts;
  const base = toBaseUrl(domain);
  const candidates = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/sitemap-index.xml`];

  for (const candidate of candidates) {
    const res = await httpGet(candidate, { timeoutMs, accept: "application/xml,text/xml" });
    if (!res.ok || !res.data.includes("<")) continue;

    const parsed = parseSitemapXml(res.data);
    if (parsed.urls.length > 0) {
      return prioritizeRecent(parsed.urls).slice(0, limit);
    }

    if (parsed.childSitemaps.length > 0) {
      // Prefer post/blog/article/news child sitemaps.
      const ranked = parsed.childSitemaps.sort(rankChild);
      const collected: SitemapEntry[] = [];
      for (const child of ranked.slice(0, 3)) {
        const childRes = await httpGet(child, { timeoutMs, accept: "application/xml,text/xml" });
        if (!childRes.ok) continue;
        collected.push(...parseSitemapXml(childRes.data).urls);
        if (collected.length >= limit) break;
      }
      if (collected.length) return prioritizeRecent(collected).slice(0, limit);
    }
  }
  return [];
}

export function parseSitemapXml(xml: string): {
  childSitemaps: string[];
  urls: SitemapEntry[];
} {
  const out = { childSitemaps: [] as string[], urls: [] as SitemapEntry[] };
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return out;
  }
  const index = doc.sitemapindex as { sitemap?: unknown } | undefined;
  if (index) {
    const maps = ([] as unknown[]).concat(index.sitemap ?? []);
    out.childSitemaps = maps
      .map((m) => (m as { loc?: string }).loc)
      .filter((x): x is string => Boolean(x));
  }
  const urlset = doc.urlset as { url?: unknown } | undefined;
  if (urlset) {
    const urls = ([] as unknown[]).concat(urlset.url ?? []);
    out.urls = urls
      .map((u) => {
        const o = u as { loc?: string; lastmod?: string };
        return { url: o.loc ?? "", lastmod: o.lastmod ?? null };
      })
      .filter((u) => u.url);
  }
  return out;
}

function rankChild(a: string, b: string): number {
  return childScore(b) - childScore(a);
}
function childScore(u: string): number {
  const s = u.toLowerCase();
  if (/post|article|blog|news/.test(s)) return 3;
  if (/page/.test(s)) return 1;
  return 2;
}
function prioritizeRecent(urls: SitemapEntry[]): SitemapEntry[] {
  return [...urls].sort((a, b) => {
    if (a.lastmod && b.lastmod) return b.lastmod.localeCompare(a.lastmod);
    if (a.lastmod) return -1;
    if (b.lastmod) return 1;
    return 0;
  });
}
