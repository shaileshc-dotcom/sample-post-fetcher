import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";

// A realistic desktop UA improves success rate against basic bot filters.
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface HttpResult {
  ok: boolean;
  status: number;
  data: string;
  headers: Record<string, string>;
  redirects: number;
  finalUrl: string;
  error?: string;
}

/**
 * Hardened GET: timeout, single retry on transient errors, captures status
 * even on 4xx/5xx (we still want the status code for domain analysis).
 */
export async function httpGet(
  url: string,
  opts: { timeoutMs?: number; accept?: string } = {}
): Promise<HttpResult> {
  const { timeoutMs = 12000, accept = "text/html,application/xhtml+xml,application/xml" } = opts;

  const config: AxiosRequestConfig = {
    timeout: timeoutMs,
    maxRedirects: 5,
    responseType: "text",
    transformResponse: (d) => d, // keep raw string
    validateStatus: () => true,  // never throw on HTTP status
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: accept,
      "Accept-Language": "en-US,en;q=0.9",
    },
  };

  const attempt = async (): Promise<HttpResult> => {
    const res: AxiosResponse = await axios.get(url, config);
    const redirects =
      (res.request?._redirectable?._redirectCount as number | undefined) ?? 0;
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      data: typeof res.data === "string" ? res.data : String(res.data ?? ""),
      headers: normalizeHeaders(res.headers as Record<string, unknown>),
      redirects,
      finalUrl: (res.request?.res?.responseUrl as string) || url,
    };
  };

  try {
    const first = await attempt();
    // Retry once on rate-limit / temporary-unavailable — common when a bulk scan
    // hits several sites that share hosting (PBN networks). Honor Retry-After,
    // capped so we don't blow the function time budget.
    if (first.status === 429 || first.status === 503) {
      const wait = Math.min(retryAfterMs(first.headers) ?? 1500, 3000);
      await sleep(wait);
      try {
        const second = await attempt();
        return second.status === 429 || second.status === 503 ? first : second;
      } catch {
        return first;
      }
    }
    return first;
  } catch (err) {
    // Retry once on transient network errors (DNS hiccup, reset, timeout).
    const e = err as AxiosError;
    const transient =
      e.code === "ECONNABORTED" ||
      e.code === "ECONNRESET" ||
      e.code === "ETIMEDOUT" ||
      e.code === "EAI_AGAIN";
    if (transient) {
      await sleep(600);
      try {
        return await attempt();
      } catch (err2) {
        return failure(url, err2 as AxiosError);
      }
    }
    return failure(url, e);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse a Retry-After header (seconds, or HTTP-date) into milliseconds. */
function retryAfterMs(headers: Record<string, string>): number | null {
  const v = headers["retry-after"];
  if (!v) return null;
  const secs = Number(v);
  if (!isNaN(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(v);
  return isNaN(when) ? null : Math.max(0, when - Date.now());
}

function failure(url: string, e: AxiosError): HttpResult {
  return {
    ok: false,
    status: 0,
    data: "",
    headers: {},
    redirects: 0,
    finalUrl: url,
    error: `${e.code || "ERR"}: ${e.message}`,
  };
}

function normalizeHeaders(h: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h || {})) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  }
  return out;
}

/**
 * Detect Cloudflare / bot-protection / CAPTCHA challenge pages so we can report a
 * REAL error instead of a misleading "no articles found".
 */
export function detectBlock(res: HttpResult): string | null {
  const s = res.status;
  const server = (res.headers?.["server"] || "").toLowerCase();
  const body = (res.data || "").slice(0, 4000).toLowerCase();
  const cfMarkers = [
    "just a moment", "cf-chl", "cf-browser-verification", "attention required",
    "checking your browser", "__cf_chl", "challenge-platform", "enable javascript and cookies",
  ];
  if (cfMarkers.some((m) => body.includes(m)) || ((s === 403 || s === 503) && server.includes("cloudflare")))
    return "Blocked by Cloudflare / bot protection (challenge page)";
  if (body.includes("captcha") && (s === 403 || s === 200)) return "Blocked by CAPTCHA";
  if (s === 403) return "Access forbidden (403) — likely bot protection";
  if (s === 429) return "Rate limited (429)";
  if (s === 401) return "Authentication required (401)";
  if (s >= 500 && s !== 503) return `Server error (${s})`;
  if (s === 503) return "Service unavailable (503)";
  return null;
}

/** True when a URL points at the site root/homepage (no real article path). */
export function isRootUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return (path === "" || path === "/") && !u.search;
  } catch {
    return false;
  }
}

// Path segments that mark a listing / utility / non-article page. Matched against
// each path segment exactly (so "/category/x" is rejected but "/best-category-guide" is not).
const NON_ARTICLE_SEGMENT =
  /^(tag|tags|category|categories|cat|author|authors|topic|topics|section|sections|page|pages|amp|feed|feeds|rss|comment|comments|cart|account|accounts|login|signin|sign-in|register|signup|sign-up|privacy|privacy-policy|terms|terms-of-service|tos|contact|contact-us|about|about-us|search|product|products|shop|store|checkout|sitemap|event|events|job|jobs|wp-admin|wp-content|wp-login|wp-json|dashboard|profile|user|users|subscribe|newsletter|advertise|advertising|advertisement|disclaimer|cookie|cookies|faq|faqs|help|support|gallery|galleries|video|videos|podcast|podcasts|forum|forums|directory|listing|listings|pricing|plans|download|downloads|portfolio|team|careers|press)$/i;

const ASSET_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|mp4|mp3|wav|xml|json|css|js|txt|csv|xlsx?|docx?)$/i;

/**
 * Heuristic: does this URL look like a real article/blog post (vs. a homepage,
 * category/tag/author listing, pagination, product, or utility page)?
 *
 * Strategy: reject root, known listing/utility segments, pagination, and asset
 * files; then ACCEPT only when the path carries an article-like slug — a
 * hyphenated multi-word final segment, a date in the path (news style), or a
 * deep path ending in a wordy slug. Deliberately strict so the fetcher returns
 * publishable posts, not section pages.
 */
export function isArticleUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const path = u.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") return false;            // homepage
  if (ASSET_EXT.test(path)) return false;                   // asset file
  const segs = path.split("/").filter(Boolean);

  // Pagination like /page/2 or /blog/page/3
  for (let i = 0; i < segs.length; i++) {
    if (/^page$/i.test(segs[i]) && /^\d+$/.test(segs[i + 1] || "")) return false;
  }
  // Any listing/utility segment anywhere in the path.
  if (segs.some((s) => NON_ARTICLE_SEGMENT.test(s))) return false;

  const last = segs[segs.length - 1];
  const wordsIn = (s: string) => s.replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).filter(Boolean);

  // News-style date in the path (e.g. /2024/05/12/headline) is a strong article signal.
  if (segs.some((s) => /^(19|20)\d\d$/.test(s)) && wordsIn(last).length >= 1 && !/^\d+$/.test(last)) return true;

  // A hyphenated, multi-word final segment is the classic post slug.
  if (last.includes("-") && wordsIn(last).length >= 2) return true;

  // A long, wordy final segment (no hyphen but clearly a title slug).
  if (last.length >= 16 && /[a-z]/i.test(last) && !/^\d+$/.test(last)) return true;

  // Single-segment paths without a slug (e.g. /blog, /news, /pricing) are listings.
  if (segs.length === 1) return false;

  // Deeper path ending in a wordy slug (e.g. /finance/how-to-save-money).
  if (segs.length >= 2 && wordsIn(last).length >= 2 && !/^\d+$/.test(last)) return true;

  return false;
}

export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return d;
}

export function toBaseUrl(domain: string): string {
  return `https://${normalizeDomain(domain)}`;
}

/**
 * Lightweight liveness check. HEAD first (cheap); falls back to GET when a
 * server rejects HEAD (405/403). Returns the final HTTP status, or 0 on error.
 */
export async function httpStatus(url: string, timeoutMs = 8000): Promise<number> {
  const headers = { "User-Agent": DEFAULT_UA, "Accept-Language": "en-US,en;q=0.9" };
  try {
    const head = await axios.head(url, {
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers,
    });
    if (head.status === 405 || head.status === 403 || head.status === 501) {
      const get = await axios.get(url, {
        timeout: timeoutMs,
        maxRedirects: 5,
        validateStatus: () => true,
        responseType: "text",
        transformResponse: (d) => d,
        headers,
      });
      return get.status;
    }
    return head.status;
  } catch {
    return 0;
  }
}
