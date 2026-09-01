import pLimit from "p-limit";
import { httpGet, httpStatus, toBaseUrl, normalizeDomain, detectBlock, isRootUrl, isArticleUrl } from "@/lib/http";
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

  // Always OVER-collect. Article-URL filtering, liveness checks, date/attribute
  // filters and prompt selection all discard candidates downstream, so gathering
  // exactly `limit` reliably returns fewer than `limit` (the "asked for 5, got 3"
  // bug). Buffer generously so the final result actually reaches `limit`.
  const hasFilters = !!(
    options.sinceDays || options.hasImage || options.hasAuthor ||
    options.englishOnly || options.minWords || options.maxWords
  );
  const hasPromptOption = !!(options.prompt && options.prompt.trim());
  // Big buffer ONLY when date/attribute filters discard candidates. A prompt on
  // its own (e.g. "Latest" + prompt) must NOT trigger a deep, slow crawl that
  // drags in stale posts — it should just rank among the newest RSS posts. Small
  // buffer here also lets RSS satisfy the target and skip the slow sitemap on
  // fresh sites (the 104s + 2020-posts bug).
  const collectTarget = hasFilters
    ? Math.max(limit * 6, limit + 20)
    : Math.max(limit * 2, 10);

  const enough = () => collected.size >= collectTarget;
  const merge = (arr: Article[], method: FetchMethod) => {
    let added = 0;
    for (const a of arr) {
      if (!a.url || collected.has(a.url) || isRootUrl(a.url)) continue;
      // Reject listing / category / tag / author / pagination / utility URLs.
      // RSS items come from the site's own post feed, so trust those.
      if (method !== "rss" && !isArticleUrl(a.url)) continue;
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
      const entries = await fetchSitemapUrls(domain, { limit: collectTarget * 2, timeoutMs });
      if (entries.length) {
        const metas = await enrichLinks(
          entries.map((e) => ({ url: e.url, lastmod: e.lastmod })),
          "sitemap",
          collectTarget - collected.size,
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
        collectTarget - collected.size,
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
          collectTarget - collected.size,
          timeoutMs
        );
        merge(metas, "category");
      } catch {
        /* next path */
      }
    }
  }

  // ---- Apply advanced filters + sort newest-first ----
  // Recency-first ordering is what makes "Latest" mean latest: the candidate pool
  // (and any prompt ranking over it) starts from the newest posts, so stale posts
  // can't outrank fresh ones.
  const filtered = applyFilters([...collected.values()], options)
    .sort((a, b) => dateVal(b.publishedDate) - dateVal(a.publishedDate));

  // ---- Verify liveness: drop dead links (404/5xx) before returning ----
  // A prompt means "pick the best" — pull a wider pool so selection has real choice.
  const poolTarget = hasPromptOption ? Math.max(limit * 4, limit) : limit;
  const pool = await selectLive(filtered, poolTarget, timeoutMs);

  // ---- Date-spread: when a date window is set (and no prompt) but the pool is
  // clustered on the newest few days (typical of daily-posting sites, where RSS
  // dominates), pull DEEPER from the sitemap and return a chronological spread
  // across the whole window — so "Last 6 months" actually shows 6 months of the
  // publisher's history, not just this week. Falls back to the normal pool if the
  // site has no usable dated sitemap history. ----
  let articles: Article[];
  let spread: Article[] = [];
  if (options.sinceDays && poolIsClustered(pool, options.sinceDays)) {
    // With a prompt we sample MORE spread points so the ranker has real choice
    // across the window; the date window still decides the eligible SET.
    const spreadCount = hasPromptOption ? Math.max(limit * 3, 12) : limit;
    spread = await buildDateSpread(domain, options.sinceDays, spreadCount, timeoutMs);
    if (spread.length) methodUsed.push("sitemap");
  }

  if (spread.length >= Math.min(limit, 3)) {
    // Date window controls the candidate set (spread across the period); a prompt
    // just ranks WITHIN it, so results stay in-window AND relevant.
    if (hasPromptOption && spread.length > limit) {
      const { selectByPrompt } = await import("@/lib/ai/enrich");
      articles = await selectByPrompt(spread, options.prompt!, limit);
    } else {
      articles = spread.slice(0, limit);
    }
  } else if (hasPromptOption) {
    // No date-window spread → rank with the prompt. When there's no date filter
    // ("Latest"), restrict candidates to the NEWEST posts (pool is date-sorted)
    // so the prompt can't drag in stale content; with a window, the pool is
    // already the in-window set.
    const cand = options.sinceDays ? pool : pool.slice(0, Math.max(limit * 2, 8));
    if (cand.length > limit) {
      const { selectByPrompt } = await import("@/lib/ai/enrich");
      articles = await selectByPrompt(cand, options.prompt!, limit);
    } else {
      articles = cand.slice(0, limit);
    }
  } else {
    articles = pool.slice(0, limit);
  }

  // ---- Optional full AI enrichment (per-article scores; cost-capped) ----
  if (enrichWithAI && articles.length) {
    const { enrichArticles } = await import("@/lib/ai/enrich");
    articles = await enrichArticles(articles, enrichLimit);
  }

  // ---- Present newest-first ----
  // The prompt (if any) already SELECTED which posts to keep by relevance; the
  // table should still read chronologically. Dated posts sort newest→oldest;
  // undated ones fall to the end.
  articles.sort((a, b) => dateVal(b.publishedDate) - dateVal(a.publishedDate));

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
  // Drop pages that explicitly identify as non-articles (og:type=website,
  // JSON-LD without an Article type). `undefined` (no signal, e.g. RSS items)
  // is kept — the URL heuristic already vetted those.
  let out = articles.filter((a) => a.isArticle !== false);
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

/** Parse a date string to epoch ms for sorting; undated/invalid sort last. */
function dateVal(d: string | null): number {
  if (!d) return -Infinity;
  const t = Date.parse(d);
  return isNaN(t) ? -Infinity : t;
}

function parseTime(d: string | null): number {
  if (!d) return 0;
  const t = Date.parse(d);
  return isNaN(t) ? 0 : t;
}

/**
 * True when the collected pool covers less than half the requested date window —
 * i.e. it's clustered on the newest posts and a deep date-spread would surface
 * older in-window history the pool is missing.
 */
function poolIsClustered(pool: Article[], sinceDays: number): boolean {
  const dated = pool.map((a) => parseTime(a.publishedDate)).filter((t) => t > 0);
  if (dated.length === 0) return true;
  const oldest = Math.min(...dated);
  const windowMs = sinceDays * 86400000;
  return Date.now() - oldest < windowMs * 0.5;
}

/**
 * Read deep into the sitemap, keep in-window article URLs, and return a
 * chronological SPREAD of up to `limit` live posts evenly sampled from newest to
 * oldest across the window. Returns [] when the site lacks a usable dated sitemap
 * range (caller then falls back to the normal newest-first pool).
 */
async function buildDateSpread(
  domain: string,
  sinceDays: number,
  limit: number,
  timeoutMs: number
): Promise<Article[]> {
  let entries: { url: string; lastmod: string | null }[];
  try {
    entries = await fetchSitemapUrls(domain, { limit: 500, timeoutMs, deep: true });
  } catch {
    return [];
  }
  const cutoff = Date.now() - sinceDays * 86400000;
  const inWin = entries
    .filter((e) => e.lastmod && !isRootUrl(e.url) && isArticleUrl(e.url) && parseTime(e.lastmod) >= cutoff)
    .sort((a, b) => parseTime(b.lastmod) - parseTime(a.lastmod));
  if (inWin.length < 3) return [];
  // Require a real spread of dates (>3 days), else the normal path is fine.
  if (parseTime(inWin[0].lastmod) - parseTime(inWin[inWin.length - 1].lastmod) < 3 * 86400000) return [];

  // Sample ~limit evenly-spaced points across the sorted (newest→oldest) list.
  const want = Math.min(inWin.length, Math.max(limit, 1));
  const step = inWin.length / want;
  const seen = new Set<number>();
  const picks: { url: string; lastmod: string | null }[] = [];
  for (let i = 0; i < want; i++) {
    const idx = Math.min(inWin.length - 1, Math.floor(i * step));
    if (!seen.has(idx)) { seen.add(idx); picks.push(inWin[idx]); }
  }
  const metas = await enrichLinks(picks, "sitemap", picks.length, timeoutMs);
  const articles = metas.filter((a) => a.isArticle !== false);
  return selectLive(articles, limit, timeoutMs);
}
