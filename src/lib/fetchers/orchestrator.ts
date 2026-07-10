import pLimit from "p-limit";
import { httpGet, httpStatus, toBaseUrl, normalizeDomain, detectBlock, isRootUrl } from "@/lib/http";
import { discoverFeeds } from "./discover";
import { fetchFeed } from "./rss";
import { fetchSitemapUrls } from "./sitemap";
import { extractArticleLinks } from "./homepage";
import { fetchArticleMeta } from "./article-meta";
import type { Article, FetchOptions, FetchResult, FetchMethod } from "@/lib/types";

const CATEGORY_PATHS = ["/blog", "/news", "/articles", "/category/blog"];

/**
 * Core orchestrator. Tries methods cheapest-first and stops as soon as it has
 * `limit` quality articles. Ordering reflects cost & reliability:
 *   RSS  ->  Sitemap  ->  Homepage  ->  Category pages
 * (Puppeteer / Jina / Firecrawl are phase-2 fallbacks — see README roadmap.)
 */
export async function fetchSamplePosts(
  rawDomain: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const started = Date.now();
  const domain = normalizeDomain(rawDomain);
  const base = toBaseUrl(domain);
  const {
    limit = 20,
    timeoutMs = 12000,
    enrichWithAI = false,
    enrichLimit = 5,
  } = options;

  const collected = new Map<string, Article>();
  const methodUsed: FetchMethod[] = [];
  const errors: string[] = [];

  const enough = () => collected.size >= limit;
  const merge = (arr: Article[], method: FetchMethod) => {
    let added = 0;
    for (const a of arr) {
      if (!a.url || collected.has(a.url) || isRootUrl(a.url)) continue;
      collected.set(a.url, a);
      added++;
    }
    if (added > 0) methodUsed.push(method);
  };

  // ---- Pull homepage once (used for feed discovery + homepage method) ----
  const home = await httpGet(base, { timeoutMs });
  if (home.error) errors.push(`homepage: ${home.error}`);
  const block = detectBlock(home);
  if (block) errors.unshift(block);

  // ---- Method 1: RSS / Atom ----
  try {
    const feeds = discoverFeeds(home.data || "", base);
    for (const feed of feeds) {
      if (enough()) break;
      try {
        const items = await fetchFeed(feed);
        if (items.length) {
          merge(items, "rss");
          break; // first working feed is enough
        }
      } catch {
        /* try next feed */
      }
    }
  } catch (e) {
    errors.push(`rss: ${(e as Error).message}`);
  }

  // ---- Method 2: Sitemap ----
  if (!enough()) {
    try {
      const entries = await fetchSitemapUrls(domain, { limit: limit * 2, timeoutMs });
      if (entries.length) {
        const metas = await enrichLinks(
          entries.map((e) => ({ url: e.url, lastmod: e.lastmod })),
          "sitemap",
          limit - collected.size,
          timeoutMs
        );
        merge(metas, "sitemap");
      }
    } catch (e) {
      errors.push(`sitemap: ${(e as Error).message}`);
    }
  }

  // ---- Method 3: Homepage parse ----
  if (!enough() && home.data) {
    try {
      const links = extractArticleLinks(home.data, base);
      const metas = await enrichLinks(
        links.map((l) => ({ url: l.url, lastmod: null })),
        "homepage",
        limit - collected.size,
        timeoutMs
      );
      merge(metas, "homepage");
    } catch (e) {
      errors.push(`homepage: ${(e as Error).message}`);
    }
  }

  // ---- Method 4: Category pages ----
  if (!enough()) {
    for (const path of CATEGORY_PATHS) {
      if (enough()) break;
      try {
        const res = await httpGet(base + path, { timeoutMs });
        if (!res.ok) continue;
        const links = extractArticleLinks(res.data, base);
        const metas = await enrichLinks(
          links.map((l) => ({ url: l.url, lastmod: null })),
          "category",
          limit - collected.size,
          timeoutMs
        );
        merge(metas, "category");
      } catch {
        /* next path */
      }
    }
  }

  // ---- Apply advanced filters ----
  const filtered = applyFilters([...collected.values()], options);

  // ---- Verify liveness: drop dead links (404/5xx) before returning ----
  const hasPrompt = !!(options.prompt && options.prompt.trim());
  // A prompt means "pick the best" — pull a wider pool so selection has real choice.
  const poolTarget = hasPrompt ? Math.max(limit * 4, limit) : limit;
  const pool = await selectLive(filtered, poolTarget, timeoutMs);

  // ---- Prompt-based selection (one cheap AI call; independent of full enrichment) ----
  let articles: Article[];
  if (hasPrompt && pool.length > limit) {
    const { selectByPrompt } = await import("@/lib/ai/enrich");
    articles = await selectByPrompt(pool, options.prompt!, limit);
  } else {
    articles = pool.slice(0, limit);
  }

  // ---- Optional full AI enrichment (per-article scores; cost-capped) ----
  if (enrichWithAI && articles.length) {
    const { enrichArticles } = await import("@/lib/ai/enrich");
    articles = await enrichArticles(articles, enrichLimit);
  }

  return {
    domain,
    articles,
    methodUsed: [...new Set(methodUsed)],
    durationMs: Date.now() - started,
    errors,
    truncated: filtered.length > articles.length,
  };
}

/**
 * Verify candidate URLs are live (HTTP 2xx/3xx) and return the first `target`
 * that pass, in order. Articles already fetched via GET (sitemap/homepage/
 * category) carry a real status and skip re-checking; RSS items are HEAD-checked.
 * This is what eliminates the 404s that used to slip through from stale feeds.
 */
async function selectLive(
  candidates: Article[],
  target: number,
  timeoutMs: number
): Promise<Article[]> {
  const live: Article[] = [];
  const limiter = pLimit(5);
  let idx = 0;

  while (idx < candidates.length && live.length < target) {
    const chunk = candidates.slice(idx, idx + 8);
    idx += 8;
    const checked = await Promise.all(
      chunk.map((a) =>
        limiter(async () => {
          if (a.statusCode && a.statusCode >= 200 && a.statusCode < 400) return a;
          const status = await httpStatus(a.url, timeoutMs);
          a.statusCode = status;
          return status >= 200 && status < 400 ? a : null;
        })
      )
    );
    for (const a of checked) if (a && live.length < target) live.push(a);
  }
  return live;
}

/** Fetch metadata for a batch of links with bounded concurrency. */
async function enrichLinks(
  links: { url: string; lastmod: string | null }[],
  method: FetchMethod,
  need: number,
  timeoutMs: number
): Promise<Article[]> {
  const slice = links.slice(0, Math.max(need, 0) + 5); // small buffer for filtered-out
  const limit = pLimit(5);
  const results = await Promise.all(
    slice.map((l) =>
      limit(async () => {
        const meta = await fetchArticleMeta(l.url, method, timeoutMs);
        if (!meta.lastModified && l.lastmod) meta.lastModified = l.lastmod;
        if (!meta.publishedDate && l.lastmod) meta.publishedDate = l.lastmod;
        return meta;
      })
    )
  );
  return results.filter((a) => a.title);
}

function applyFilters(articles: Article[], o: FetchOptions): Article[] {
  let out = articles;
  if (o.hasImage) out = out.filter((a) => !!a.featuredImage);
  if (o.hasAuthor) out = out.filter((a) => !!a.author);
  if (o.englishOnly) out = out.filter((a) => !a.language || a.language === "en");
  if (o.minWords) out = out.filter((a) => (a.wordCount ?? 0) >= o.minWords!);
  if (o.maxWords) out = out.filter((a) => (a.wordCount ?? Infinity) <= o.maxWords!);
  if (o.sinceDays) {
    const cutoff = Date.now() - o.sinceDays * 86400000;
    out = out.filter((a) => {
      if (!a.publishedDate) return false;
      const t = Date.parse(a.publishedDate);
      return !isNaN(t) && t >= cutoff;
    });
  }
  return out;
}
