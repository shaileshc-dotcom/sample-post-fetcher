/**
 * "How many pages does Google index for this domain" — the real site:domain
 * "About N results" count, across time windows. Server-side only.
 *
 * Two interchangeable providers (chosen in Settings, passed per request):
 *   - "searchapi" → SearchApi.io   (env SEARCHAPI_KEY, ~100 free)
 *   - "serpapi"   → SerpApi.com     (env SERPAPI_KEY, ~250/mo free)
 * Both return an estimated total-results count and support Google time filters.
 * Each window is one API call, so a full breakdown = 5 credits per domain.
 */
import { normalizeDomain } from "@/lib/http";

export const SITE_WINDOWS = ["any", "last_day", "last_week", "last_month", "last_year"] as const;
export type SiteWindow = (typeof SITE_WINDOWS)[number];

export const WINDOW_LABEL: Record<SiteWindow, string> = {
  any: "Any time",
  last_day: "Past 24h",
  last_week: "Past week",
  last_month: "Past month",
  last_year: "Past year",
};

export const SERP_PROVIDERS = ["searchapi", "serpapi"] as const;
export type SerpProvider = (typeof SERP_PROVIDERS)[number];

export interface SiteCoverage {
  domain: string;
  counts: Partial<Record<SiteWindow, number | null>>;
  error?: string;
}

// Google tbs value per window (used by SerpApi; SearchApi uses its own token).
const TBS: Record<Exclude<SiteWindow, "any">, string> = {
  last_day: "qdr:d",
  last_week: "qdr:w",
  last_month: "qdr:m",
  last_year: "qdr:y",
};

const isNoResults = (msg: string) => /didn'?t return any results|hasn'?t returned any results|no results/i.test(msg);

/** SearchApi.io — time_period token. */
async function searchApiCount(domain: string, key: string, w: SiteWindow): Promise<number | null> {
  let url = `https://www.searchapi.io/api/v1/search?engine=google&num=1&q=${encodeURIComponent("site:" + domain)}&api_key=${encodeURIComponent(key)}`;
  if (w !== "any") url += `&time_period=${w}`;
  try {
    const res = await fetch(url);
    const j = (await res.json().catch(() => ({}))) as { error?: unknown; search_information?: { total_results?: number } };
    if (j.error) return isNoResults(String(j.error)) ? 0 : null;
    const t = Number(j.search_information?.total_results ?? 0);
    return Number.isFinite(t) ? t : 0;
  } catch {
    return null;
  }
}

/** SerpApi.com — Google tbs token. */
async function serpApiCount(domain: string, key: string, w: SiteWindow): Promise<number | null> {
  let url = `https://serpapi.com/search.json?engine=google&num=1&q=${encodeURIComponent("site:" + domain)}&api_key=${encodeURIComponent(key)}`;
  if (w !== "any") url += `&tbs=${encodeURIComponent(TBS[w])}`;
  try {
    const res = await fetch(url);
    const j = (await res.json().catch(() => ({}))) as { error?: unknown; search_information?: { total_results?: number } };
    if (j.error) return isNoResults(String(j.error)) ? 0 : null;
    const t = Number(j.search_information?.total_results ?? 0);
    return Number.isFinite(t) ? t : 0;
  } catch {
    return null;
  }
}

function providerKey(provider: SerpProvider): string | undefined {
  return provider === "serpapi" ? process.env.SERPAPI_KEY : process.env.SEARCHAPI_KEY;
}
function providerEnvName(provider: SerpProvider): string {
  return provider === "serpapi" ? "SERPAPI_KEY" : "SEARCHAPI_KEY";
}

/** Indexed-page counts for a domain across the requested windows, via `provider`. */
export async function siteCoverage(
  rawDomain: string,
  windows: readonly SiteWindow[],
  provider: SerpProvider = "searchapi",
): Promise<SiteCoverage> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { domain: rawDomain, counts: {}, error: "Empty domain" };
  const key = providerKey(provider);
  if (!key) return { domain, counts: {}, error: `${providerEnvName(provider)} not set` };

  const fn = provider === "serpapi" ? serpApiCount : searchApiCount;
  const counts: Partial<Record<SiteWindow, number | null>> = {};
  await Promise.all(windows.map(async (w) => { counts[w] = await fn(domain, key, w); }));
  const allFailed = windows.length > 0 && windows.every((w) => counts[w] == null);
  return { domain, counts, error: allFailed ? `${provider} request failed (key/quota?)` : undefined };
}

/** Back-compat single any-time count. */
export interface SiteCount {
  domain: string;
  count: number | null;
  error?: string;
}
export async function siteIndexCount(rawDomain: string, provider: SerpProvider = "searchapi"): Promise<SiteCount> {
  const cov = await siteCoverage(rawDomain, ["any"], provider);
  return { domain: cov.domain, count: cov.counts.any ?? null, error: cov.error };
}
