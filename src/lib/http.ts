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
    return await attempt();
  } catch (err) {
    // Retry once on transient network errors (DNS hiccup, reset, timeout).
    const e = err as AxiosError;
    const transient =
      e.code === "ECONNABORTED" ||
      e.code === "ECONNRESET" ||
      e.code === "ETIMEDOUT" ||
      e.code === "EAI_AGAIN";
    if (transient) {
      try {
        return await attempt();
      } catch (err2) {
        return failure(url, err2 as AxiosError);
      }
    }
    return failure(url, e);
  }
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
