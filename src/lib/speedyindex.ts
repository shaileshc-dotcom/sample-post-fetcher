/**
 * SpeedyIndex API v2 client (server-side only — keeps the key off the browser).
 * Docs: https://api.speedyindex.com
 * Auth: `Authorization: <API_KEY>` header (raw key, not "Bearer").
 * Index checking is task-based: create → poll status → fetch report.
 */
const BASE = "https://api.speedyindex.com";

export type SearchEngine = "google" | "yandex" | "bing";

function apiKey(): string {
  return process.env.SPEEDYINDEX_API_KEY || "";
}

interface SiResponse<T = Record<string, unknown>> {
  httpStatus: number;
  code: number; // 0 success, 1 insufficient/not found, 2 validation, 3 rate/server
  data: T;
  error?: string;
}

async function si<T = Record<string, unknown>>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<SiResponse<T>> {
  if (!apiKey()) return { httpStatus: 0, code: -1, data: {} as T, error: "SPEEDYINDEX_API_KEY is not set" };
  // Retry transient failures (503 service unavailable, 429 rate limit) with backoff.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: apiKey(),
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 503 || res.status === 429) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        httpStatus: res.status,
        code: typeof json.code === "number" ? (json.code as number) : res.ok ? 0 : 3,
        data: json as T,
        error: res.ok ? undefined : httpMessage(res.status),
      };
    } catch (e) {
      if (attempt < maxAttempts) { await new Promise((r) => setTimeout(r, attempt * 1500)); continue; }
      return { httpStatus: 0, code: 3, data: {} as T, error: (e as Error).message };
    }
  }
  return { httpStatus: 503, code: 3, data: {} as T, error: httpMessage(503) };
}

function httpMessage(status: number): string {
  switch (status) {
    case 401: return "Unauthorized — check SPEEDYINDEX_API_KEY";
    case 402: return "Insufficient SpeedyIndex balance";
    case 413: return "Too many URLs in one request";
    case 429: return "SpeedyIndex rate limit hit — retry shortly";
    case 503: return "SpeedyIndex is temporarily unavailable (503) — please retry in a minute";
    default: return `SpeedyIndex error (HTTP ${status})`;
  }
}

/** Account balance (tokens / indexer / checker). */
export function siAccount() {
  return si<{ balance?: { tokens?: number; indexer?: number; checker?: number } }>("/v2/account", "GET");
}

/** Create an index-check task. Returns task_id. */
export function siCreateCheck(urls: string[], engine: SearchEngine = "google") {
  return si<{ task_id?: string; type?: string }>(`/v2/task/${engine}/checker/create`, "POST", { urls });
}

/** Poll a task's status (is_completed, counts). */
export function siStatus(taskId: string, engine: SearchEngine = "google") {
  return si<{ result?: { is_completed?: boolean; size?: number; processed_count?: number } }>(
    `/v2/task/${engine}/checker/status`,
    "POST",
    { task_id: taskId }
  );
}

/** Fetch the report: which URLs are indexed vs not. */
export function siReport(taskId: string, engine: SearchEngine = "google") {
  return si<{ result?: { indexed_links?: string[]; unindexed_links?: string[]; processed_count?: number; size?: number } }>(
    `/v2/task/${engine}/checker/report`,
    "POST",
    { task_id: taskId }
  );
}

/**
 * Submit URLs for Google indexing.
 * SpeedyIndex has two currencies: `tokens` (pay-per-indexed, 100/URL, refunded
 * if not indexed in 7d) and `indexer` credits (standard indexing). We try
 * pay-per-indexed first; if the tokens pool is insufficient, we fall back to
 * standard indexing so the account's indexer credits can be used.
 */
export async function siSubmitIndex(urls: string[], engine: SearchEngine = "google") {
  const path = `/v2/task/${engine}/indexer/create`;
  const ppi = await si<{ task_id?: string; type?: string; pay_per_indexed?: boolean }>(path, "POST", {
    urls,
    pay_per_indexed: true,
  });
  if (ppi.code === 0 && ppi.data.task_id) return ppi;

  // Tokens insufficient (HTTP 402 or code 1) → try standard indexing (indexer credits).
  const insufficient = ppi.httpStatus === 402 || ppi.code === 1;
  if (insufficient) {
    const std = await si<{ task_id?: string; type?: string }>(path, "POST", { urls });
    if (std.code === 0 && std.data.task_id) return std;
    return {
      ...std,
      error:
        std.error ||
        "Insufficient balance: pay-per-indexed needs 'tokens', and standard indexing was unavailable. Top up tokens at speedyindex.com.",
    };
  }
  return ppi;
}

/** Status of an indexing task. */
export function siIndexStatus(taskId: string, engine: SearchEngine = "google") {
  return si<{ result?: { is_completed?: boolean; size?: number; indexed_count?: number; processed_count?: number } }>(
    `/v2/task/${engine}/indexer/status`,
    "POST",
    { task_id: taskId }
  );
}
