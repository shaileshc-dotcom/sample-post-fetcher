"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { getSettings } from "@/lib/settings";
import { normalizeDomain } from "@/lib/http";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/profile";
import type { Article, FetchResult } from "@/lib/types";

export type BulkStatus = "queued" | "running" | "done" | "failed";

export interface BulkItem {
  domain: string;
  status: BulkStatus;
  articles: Article[];
  method?: string;
  durationMs?: number;
  error?: string;
}

export type RunnerState = "idle" | "running" | "paused" | "done";

export interface CompletedSummary { total: number; domainsFound: number; articlesFound: number; failed: number; at: number; }

interface BulkRunContextValue {
  items: BulkItem[];
  state: RunnerState;
  startedAt: number | null;
  completedSummary: CompletedSummary | null;
  start: (raw: string, promptOverride?: string, sinceDays?: number | null) => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  retryFailed: () => void;
  reset: () => void;
  dismissCompletedSummary: () => void;
}

const BulkRunContext = createContext<BulkRunContextValue | null>(null);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lives in a Provider wrapping the whole authenticated app shell (not the
 * /bulk page itself) so a running bulk scan — and the "it's done" toast —
 * survives navigating to another page and back.
 */
export function BulkRunProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<BulkItem[]>([]);
  const [state, setState] = useState<RunnerState>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [completedSummary, setCompletedSummary] = useState<CompletedSummary | null>(null);

  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const promptRef = useRef("");
  const sinceDaysRef = useRef<number | null>(null);
  const controllers = useRef<Set<AbortController>>(new Set());

  const update = useCallback((domain: string, patch: Partial<BulkItem>) => {
    setItems((prev) => prev.map((it) => (it.domain === domain ? { ...it, ...patch } : it)));
  }, []);

  const processOne = useCallback(
    async (domain: string, enrich: boolean, postsPerDomain: number, prompt: string, sinceDays: number | null) => {
      update(domain, { status: "running" });
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const res = await fetch("/api/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain,
            options: { limit: postsPerDomain, enrichWithAI: enrich, enrichLimit: postsPerDomain, prompt: prompt || undefined, sinceDays: sinceDays ?? undefined, skipHistory: true },
          }),
          signal: controller.signal,
        });
        const data = (await res.json()) as FetchResult & { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const foundCount = data.articles.length;
        const realError = foundCount
          ? undefined
          : (data.errors && data.errors.length ? data.errors[0] : "No articles found");
        update(domain, {
          status: foundCount ? "done" : "failed",
          articles: data.articles,
          method: data.methodUsed.join(", "),
          durationMs: data.durationMs,
          error: realError,
        });
      } catch (e) {
        if (cancelledRef.current) return;
        update(domain, { status: "failed", error: (e as Error).message });
      } finally {
        controllers.current.delete(controller);
      }
    },
    [update]
  );

  const runQueue = useCallback(
    async (domains: string[]) => {
      const { concurrency, aiDefault, postsPerDomain } = getSettings();
      const prompt = promptRef.current;
      const nextIndex = { i: 0 };
      const worker = async () => {
        while (true) {
          if (cancelledRef.current) return;
          while (pausedRef.current && !cancelledRef.current) await sleep(150);
          if (cancelledRef.current) return;
          const idx = nextIndex.i++;
          if (idx >= domains.length) return;
          await processOne(domains[idx], aiDefault, postsPerDomain, prompt, sinceDaysRef.current);
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
      if (!cancelledRef.current) {
        setState("done");
        void writeBulkSummary(domains.length);
      }
    },
    [processOne]
  );

  const start = useCallback(
    (raw: string, promptOverride?: string, sinceDays?: number | null) => {
      promptRef.current = promptOverride ?? "";
      sinceDaysRef.current = sinceDays ?? null;
      const domains = [
        ...new Set(
          raw
            .split(/[\n,]/)
            .map((d) => normalizeDomain(d))
            .filter(Boolean)
        ),
      ];
      if (!domains.length) return;
      cancelledRef.current = false;
      pausedRef.current = false;
      setItems(domains.map((domain) => ({ domain, status: "queued", articles: [] })));
      setStartedAt(Date.now());
      setCompletedSummary(null);
      setState("running");
      void runQueue(domains);
    },
    [runQueue]
  );

  const pause = useCallback(() => {
    pausedRef.current = true;
    setState("paused");
  }, []);
  const resume = useCallback(() => {
    pausedRef.current = false;
    setState("running");
  }, []);
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setState("done");
  }, []);

  const retryFailed = useCallback(() => {
    setItems((prev) => {
      const failed = prev.filter((it) => it.status === "failed").map((it) => it.domain);
      if (failed.length) {
        cancelledRef.current = false;
        pausedRef.current = false;
        setState("running");
        void runQueue(failed);
      }
      return prev.map((it) => (it.status === "failed" ? { ...it, status: "queued", error: undefined } : it));
    });
  }, [runQueue]);

  const writeBulkSummary = useCallback(async (count: number) => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { profile } = await getProfile();
      const runBy = profile.display_name || user.email || "";
      // Read the current items reliably from inside the state updater.
      const snapshot = await new Promise<BulkItem[]>((resolve) => {
        setItems((prev) => { resolve(prev); return prev; });
      });
      const articlesFound = snapshot.reduce((s, it) => s + it.articles.length, 0);
      const failed = snapshot.filter((it) => it.status === "failed").length;
      const domainsFound = snapshot.length - failed;
      const details = snapshot.map((it) => ({
        domain: it.domain,
        count: it.articles.length,
        urls: it.articles.map((a) => a.url),
      }));
      await supabase.from("search_history").insert({
        user_id: user.id,
        run_by: runBy,
        domain: `Bulk run · ${count} domains`,
        articles_found: articlesFound,
        duration_ms: 0,
        fetch_method: "bulk",
        status: "success",
        details,
      });
      setCompletedSummary({ total: count, domainsFound, articlesFound, failed, at: Date.now() });
    } catch { /* non-critical */ }
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    pausedRef.current = false;
    setItems([]);
    setStartedAt(null);
    setState("idle");
    // allow a fresh run
    setTimeout(() => { cancelledRef.current = false; }, 0);
  }, []);

  const dismissCompletedSummary = useCallback(() => setCompletedSummary(null), []);

  return (
    <BulkRunContext.Provider value={{ items, state, startedAt, completedSummary, start, pause, resume, cancel, retryFailed, reset, dismissCompletedSummary }}>
      {children}
    </BulkRunContext.Provider>
  );
}

export function useBulkRun(): BulkRunContextValue {
  const ctx = useContext(BulkRunContext);
  if (!ctx) throw new Error("useBulkRun must be used within BulkRunProvider");
  return ctx;
}
