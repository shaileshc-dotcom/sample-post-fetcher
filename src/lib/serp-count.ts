/**
 * "How many pages does Google index for this domain" — the real site:domain
 * "About N results" count, via SearchApi.io (a Google SERP API). Server-side
 * only so the key stays off the browser.
 *
 * Supports time windows (Google's Tools → time filter): any time, past 24h,
 * week, month, 3 months, year. Each window is a separate SearchApi call, so a
 * full breakdown = 6 credits per domain (vs 1 for any-time only).
 *
 * Env: SEARCHAPI_KEY
 */
import { normalizeDomain } from "@/lib/http";

const BASE = "https://www.searchapi.io/api/v1/search";

// SearchApi's supported Google time filters (matches Google's own presets — note
// there is no 3-month preset; Google only offers 24h/week/month/year + custom).
export const SITE_WINDOWS = ["any", "last_day", "last_week", "last_month", "last_year"] as const;
export type SiteWindow = (typeof SITE_WINDOWS)[number];

export const WINDOW_LABEL: Record<SiteWindow, string> = {
  any: "Any time",
  last_day: "Past 24h",
  last_week: "Past week",
  last_month: "Past month",
  last_year: "Past year",
};

export interface SiteCoverage {
  domain: string;
  counts: Partial<Record<SiteWindow, number | null>>;
  error?: string;
}

async function countForWindow(domain: string, key: string, w: SiteWindow): Promise<number | null> {
  let params = `engine=google&num=1&q=${encodeURIComponent("site:" + domain)}&api_key=${encodeURIComponent(key)}`;
  if (w !== "any") params += `&time_period=${w}`;
  try {
    const res = await fetch(`${BASE}?${params}`);
    const j = (await res.json().catch(() => ({}))) as { error?: unknown; search_information?: { total_results?: number } };
    if (j.error) {
      // SearchApi returns an error string when Google has ZERO results — that's a
      // real count of 0 for this window, not a failure.
      if (/didn'?t return any results|no results/i.test(String(j.error))) return 0;
      return null;
    }
    const t = Number(j.search_information?.total_results ?? 0);
    return Number.isFinite(t) ? t : 0;
  } catch {
    return null;
  }
}

/** Indexed-page counts for a domain across the requested time windows. */
export async function siteCoverage(rawDomain: string, windows: readonly SiteWindow[]): Promise<SiteCoverage> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { domain: rawDomain, counts: {}, error: "Empty domain" };
  const key = process.env.SEARCHAPI_KEY;
  if (!key) return { domain, counts: {}, error: "SEARCHAPI_KEY not set" };

  const counts: Partial<Record<SiteWindow, number | null>> = {};
  await Promise.all(windows.map(async (w) => { counts[w] = await countForWindow(domain, key, w); }));
  // Surface an error only if EVERY window failed (likely a key/quota problem).
  const allFailed = windows.length > 0 && windows.every((w) => counts[w] == null);
  return { domain, counts, error: allFailed ? "SearchApi request failed (key/quota?)" : undefined };
}

/** Back-compat single any-time count. */
export interface SiteCount {
  domain: string;
  count: number | null;
  error?: string;
}
export async function siteIndexCount(rawDomain: string): Promise<SiteCount> {
  const cov = await siteCoverage(rawDomain, ["any"]);
  return { domain: cov.domain, count: cov.counts.any ?? null, error: cov.error };
}
