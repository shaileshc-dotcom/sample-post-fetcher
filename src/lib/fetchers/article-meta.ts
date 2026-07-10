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
  base.publishedDate =
    meta("article:published_time") || meta("datePublished") || ldDate($) || null;
  base.language = $("html").attr("lang")?.split("-")[0] || null;

  const articleText = $("article").text() || $("main").text() || $("body").text();
  const words = articleText.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
  base.wordCount = words || null;
  base.readingTimeMin = words ? Math.max(1, Math.round(words / 220)) : null;

  return base;
}

function ldDate($: cheerio.CheerioAPI): string | null {
  let date: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (date) return;
    try {
      const data = JSON.parse($(el).contents().text());
      const items = Array.isArray(data) ? data : [data["@graph"] ? data["@graph"] : data].flat();
      for (const it of items) {
        if (it?.datePublished) {
          date = it.datePublished;
          break;
        }
      }
    } catch {
      /* skip */
    }
  });
  return date;
}
