import * as cheerio from "cheerio";
import { httpGet } from "@/lib/http";
import type { Article, FetchMethod } from "@/lib/types";

/**
 * Fetch a single article URL and extract rich metadata from OG/Twitter tags,
 * JSON-LD, and the document body. Used to enrich links found via homepage /
 * sitemap / category methods (RSS already carries most of this).
 */
export async function fetchArticleMeta(
  url: string,
  method: FetchMethod,
  timeoutMs = 12000
): Promise<Article> {
  const res = await httpGet(url, { timeoutMs });
  const base: Article = {
    url,
    title: "",
    publishedDate: null,
    author: null,
    category: null,
    featuredImage: null,
    wordCount: null,
    readingTimeMin: null,
    metaDescription: null,
    language: null,
    statusCode: res.status || null,
    lastModified: res.headers["last-modified"] || null,
    method,
  };
  if (!res.ok || !res.data) return base;

  const $ = cheerio.load(res.data);
  const meta = (name: string) =>
    $(`meta[property="${name}"]`).attr("content") ||
    $(`meta[name="${name}"]`).attr("content") ||
    null;

  base.title =
    meta("og:title") || $("title").first().text().trim() || $("h1").first().text().trim();
  base.metaDescription = (meta("description") || meta("og:description") || "")?.slice(0, 300) || null;
  base.featuredImage = meta("og:image") || meta("twitter:image");
  base.author =
    meta("article:author") || meta("author") || $('[rel="author"]').first().text().trim() || null;
  const ld = ldInfo($);
  base.publishedDate =
    meta("article:published_time") ||
    meta("og:article:published_time") ||
    meta("article:modified_time") ||
    meta("datePublished") ||
    meta("date") ||
    meta("dc.date") ||
    meta("dc.date.issued") ||
    meta("pubdate") ||
    meta("publishdate") ||
    meta("sailthru.date") ||
    meta("parsely-pub-date") ||
    $("time[datetime]").first().attr("datetime") ||
    $('[itemprop="datePublished"]').first().attr("content") ||
    $('[itemprop="datePublished"]').first().attr("datetime") ||
    ld.date ||
    null;
  base.language = $("html").attr("lang")?.split("-")[0] || null;

  // Article-type classification. JSON-LD Article types are authoritative;
  // otherwise og:type (website/product/profile => not an article). No signal
  // leaves it undefined so the URL heuristic upstream decides.
  const ogType = (meta("og:type") || "").toLowerCase();
  if (ld.isArticle) base.isArticle = true;
  else if (ogType) base.isArticle = /article/.test(ogType);

  const articleText = $("article").text() || $("main").text() || $("body").text();
  const words = articleText.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
  base.wordCount = words || null;
  base.readingTimeMin = words ? Math.max(1, Math.round(words / 220)) : null;

  return base;
}

/** Scan all JSON-LD blocks for a publish date and whether the page is an Article. */
function ldInfo($: cheerio.CheerioAPI): { date: string | null; isArticle: boolean } {
  let date: string | null = null;
  let isArticle = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const nodes: Array<Record<string, unknown>> = [];
      const push = (d: unknown): void => {
        if (!d) return;
        if (Array.isArray(d)) { d.forEach(push); return; }
        if (typeof d === "object") {
          const o = d as Record<string, unknown>;
          nodes.push(o);
          if (o["@graph"]) push(o["@graph"]);
        }
      };
      push(data);
      for (const node of nodes) {
        const t = node["@type"];
        const types = Array.isArray(t) ? t : [t];
        if (types.some((x) => /Article|BlogPosting|NewsArticle|Report|Review/i.test(String(x)))) isArticle = true;
        if (!date && node.datePublished) date = String(node.datePublished);
      }
    } catch {
      /* skip malformed ld+json */
    }
  });
  return { date, isArticle };
}
