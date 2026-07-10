import * as cheerio from "cheerio";

interface LinkCandidate {
  url: string;
  title: string;
}

const JUNK_PATH = /\/(tag|category|author|page|wp-|feed|comment|cart|account|login|privacy|terms|contact|about)\b/i;

/**
 * Extract likely-article links from a homepage or category page using three
 * stacked heuristics: JSON-LD structured data, <article> blocks, and heading
 * anchors. Filtered to same-origin, non-junk, titled links.
 */
export function extractArticleLinks(html: string, baseUrl: string): LinkCandidate[] {
  const found = new Map<string, string>();
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }

  // 1) JSON-LD Article / BlogPosting / NewsArticle
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const items = Array.isArray(data) ? data : [data];
      for (const it of items) {
        const graph = (it["@graph"] as unknown[]) || [it];
        for (const node of graph as Array<Record<string, unknown>>) {
          const t = node["@type"];
          const types = Array.isArray(t) ? t : [t];
          if (types.some((x) => /Article|BlogPosting|NewsArticle/i.test(String(x))) && node.url) {
            add(found, String(node.url), String(node.headline || ""), baseUrl);
          }
        }
      }
    } catch {
      /* skip malformed ld+json */
    }
  });

  // 2) <article> / .post / .entry anchors  3) Heading anchors (strong signal)
  const selectors =
    'article a[href], .post a[href], .entry a[href], .post-title a[href], ' +
    "h1 a[href], h2 a[href], h3 a[href]";
  $(selectors).each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().trim();
    if (href && title.length > 15) add(found, href, title, baseUrl);
  });

  // Filter to same-origin, non-junk, with a real path.
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const results: LinkCandidate[] = [];
  for (const [url, title] of found) {
    try {
      const u = new URL(url);
      if (u.origin !== origin) continue;
      if (u.pathname === "/" || u.pathname === "") continue;
      if (JUNK_PATH.test(u.pathname)) continue;
      results.push({ url, title });
    } catch {
      /* skip */
    }
  }
  return results;
}

function add(found: Map<string, string>, href: string, title: string, baseUrl: string) {
  try {
    found.set(new URL(href, baseUrl).toString(), title);
  } catch {
    /* skip invalid */
  }
}
