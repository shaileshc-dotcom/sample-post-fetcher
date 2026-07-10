import * as cheerio from "cheerio";

const FALLBACK_FEED_PATHS = [
  "/feed",
  "/feed/",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/?feed=rss2",
];

/** Discover feed URLs declared in <head> plus common fallback paths. */
export function discoverFeeds(html: string, baseUrl: string): string[] {
  const feeds = new Set<string>();
  try {
    const $ = cheerio.load(html);
    $('link[rel="alternate"]').each((_, el) => {
      const type = ($(el).attr("type") || "").toLowerCase();
      const href = $(el).attr("href");
      if (href && (type.includes("rss") || type.includes("atom") || type.includes("xml"))) {
        safeAdd(feeds, href, baseUrl);
      }
    });
  } catch {
    /* ignore parse errors, still return fallbacks */
  }
  for (const p of FALLBACK_FEED_PATHS) safeAdd(feeds, p, baseUrl);
  return [...feeds];
}

/** Detect CMS / WordPress signals from homepage HTML + headers. */
export function detectCms(html: string, headers: Record<string, string>): {
  wordpress: boolean;
  cms: string | null;
} {
  const h = html.toLowerCase();
  const wordpress =
    h.includes("/wp-content/") ||
    h.includes("/wp-includes/") ||
    (headers["link"]?.includes("wp-json") ?? false);
  let cms: string | null = wordpress ? "WordPress" : null;
  if (!cms) {
    if (h.includes("cdn.shopify.com")) cms = "Shopify";
    else if (h.includes("wix.com")) cms = "Wix";
    else if (h.includes("squarespace")) cms = "Squarespace";
    else if (h.includes("ghost") && h.includes("content/")) cms = "Ghost";
    else if (headers["x-drupal-cache"]) cms = "Drupal";
  }
  return { wordpress, cms };
}

function safeAdd(set: Set<string>, href: string, base: string) {
  try {
    set.add(new URL(href, base).toString());
  } catch {
    /* invalid url, skip */
  }
}
