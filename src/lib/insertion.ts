import { collectPages, type PageCandidate } from "@/lib/fetchers/collect-pages";
import { fetchArticleMeta } from "@/lib/fetchers/article-meta";
import { normalizeDomain } from "@/lib/http";
import pLimit from "p-limit";

export interface InsertionMatch {
  url: string;
  title: string;
  reason: string;
  score: number;        // 0-100 relevance
  wordCount: number | null;
}

export interface InsertionResult {
  website: string;
  anchor: string;
  targetUrl: string;
  matches: InsertionMatch[];
  scanned: number;
  durationMs: number;
  note?: string;
}

const STOP = new Set([
  "the","and","for","with","that","this","from","your","are","how","best","top",
  "you","our","what","why","a","an","of","to","in","on","is","it","or","by",
]);

function keywords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function slugWords(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/[-_/]/g, " ");
  } catch {
    return "";
  }
}

function keywordScore(c: PageCandidate, kw: string[]): number {
  const hay = `${c.title || ""} ${slugWords(c.url)}`.toLowerCase();
  let hits = 0;
  for (const w of kw) if (hay.includes(w)) hits++;
  return hits;
}

/**
 * Given a website, anchor text and target URL, find the on-site pages that are
 * the best places to insert the link. Two stages: cheap keyword prefilter over
 * a wide candidate set, then AI ranking with a reason per pick.
 */
export async function findInsertionMatches(
  website: string,
  anchor: string,
  targetUrl: string,
  prompt: string,
  limit = 5,
  timeoutMs = 12000
): Promise<InsertionResult> {
  const started = Date.now();
  const site = normalizeDomain(website);
  const kw = [...new Set([...keywords(anchor), ...keywords(slugWords(targetUrl))])];

  const candidates = await collectPages(site, 250, timeoutMs);
  if (!candidates.length) {
    return { website: site, anchor, targetUrl, matches: [], scanned: 0, durationMs: Date.now() - started, note: "No pages found for this site." };
  }

  // Stage 1: keyword prefilter → top 15 (fall back to first 15 if nothing scores).
  const scored = candidates.map((c) => ({ c, s: keywordScore(c, kw) })).sort((a, b) => b.s - a.s);
  const anyHit = scored.some((x) => x.s > 0);
  const top = (anyHit ? scored.filter((x) => x.s > 0) : scored).slice(0, 15).map((x) => x.c);

  // Fetch real titles + word counts + verify live, bounded concurrency.
  const limiter = pLimit(5);
  const metas = await Promise.all(top.map((c) => limiter(() => fetchArticleMeta(c.url, "sitemap", timeoutMs))));
  const live = metas.filter((m) => m.title && m.statusCode && m.statusCode >= 200 && m.statusCode < 400);

  if (!live.length) {
    return { website: site, anchor, targetUrl, matches: [], scanned: candidates.length, durationMs: Date.now() - started, note: "Found pages, but none passed the live check." };
  }

  // Stage 2: AI ranking (falls back to keyword order if no OpenAI key).
  const { rankForAnchor } = await import("@/lib/ai/enrich");
  const matches = await rankForAnchor(
    live.map((m) => ({ url: m.url, title: m.title, metaDescription: m.metaDescription, wordCount: m.wordCount })),
    anchor,
    targetUrl,
    prompt,
    limit
  );

  return { website: site, anchor, targetUrl, matches, scanned: candidates.length, durationMs: Date.now() - started };
}
