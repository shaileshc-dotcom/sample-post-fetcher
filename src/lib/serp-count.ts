/**
 * Approximate number of pages Google has indexed for a domain — the real
 * "About N results" count for a `site:domain` query — via SearchApi.io (a Google
 * SERP API). Server-side only so the key stays off the browser.
 *
 * Each lookup uses one SearchApi credit (100 free on signup, then paid plans).
 * The count is Google's own estimate, so it can drift a little run-to-run.
 *
 * Env: SEARCHAPI_KEY
 */
import { normalizeDomain } from "@/lib/http";

const BASE = "https://www.searchapi.io/api/v1/search";

export interface SiteCount {
  domain: string;
  count: number | null;
  error?: string;
}

export async function siteIndexCount(rawDomain: string): Promise<SiteCount> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { domain: rawDomain, count: null, error: "Empty domain" };

  const key = process.env.SEARCHAPI_KEY;
  if (!key) return { domain, count: null, error: "SEARCHAPI_KEY not set" };

  try {
    const url = `${BASE}?engine=google&num=10&q=${encodeURIComponent("site:" + domain)}&api_key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const j = (await res.json().catch(() => ({}))) as {
      error?: unknown;
      search_information?: { total_results?: number };
    };
    if (j.error) return { domain, count: null, error: typeof j.error === "string" ? j.error : "SearchApi error" };
    const total = Number(j.search_information?.total_results ?? 0);
    return { domain, count: Number.isFinite(total) ? total : 0 };
  } catch (e) {
    return { domain, count: null, error: (e as Error).message };
  }
}
