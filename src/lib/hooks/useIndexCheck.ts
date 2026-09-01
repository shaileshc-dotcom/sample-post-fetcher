"use client";

import { useCallback, useRef, useState } from "react";

type Phase = "idle" | "creating" | "polling" | "done" | "error";

interface State {
  phase: Phase;
  indexed: string[];
  unindexed: string[];
  error: string | null;
  progress: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives the SpeedyIndex checker task lifecycle from the browser:
 * create → poll status → fetch report. All calls go through /api/index-check
 * so the key stays server-side.
 */
export function useIndexCheck() {
  const [state, setState] = useState<State>({
    phase: "idle",
    indexed: [],
    unindexed: [],
    error: null,
    progress: "",
  });
  const cancelled = useRef(false);

  const call = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/index-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  };

  const run = useCallback(async (urls: string[], engine: "google" | "yandex" | "bing" = "google") => {
    cancelled.current = false;
    setState({ phase: "creating", indexed: [], unindexed: [], error: null, progress: "Creating task…" });
    try {
      const created = await call({ action: "create", urls, engine });
      const taskId = created?.data?.task_id || created?.task_id;
      if (created?.error || !taskId) throw new Error(created?.error || "Could not create index-check task");

      setState((s) => ({ ...s, phase: "polling", progress: "Checking with Google… (background task — can take a few minutes)" }));
      // SpeedyIndex's checker is a background job that queries Google per URL and
      // often takes several minutes; poll until it's actually done (generous cap),
      // surfacing the ETA it reports rather than giving up after ~80s.
      const deadline = Date.now() + 8 * 60 * 1000;
      let completed = false;
      while (Date.now() < deadline) {
        if (cancelled.current) return;
        await sleep(5000);
        const st = await call({ action: "status", taskId, engine });
        const result = st?.data?.result;
        if (result?.is_completed) { completed = true; break; }
        const eta = result?.eta_minutes;
        setState((s) => ({
          ...s,
          progress: `Checking… ${result?.processed_count ?? 0}/${result?.size ?? urls.length}${eta ? ` · ~${eta} min left` : ""}`,
        }));
      }

      const report = await call({ action: "report", taskId, engine });
      const r = report?.data?.result || {};
      setState({
        phase: "done",
        indexed: r.indexed_links || [],
        unindexed: r.unindexed_links || [],
        error: completed ? null : "Still processing on SpeedyIndex — showing partial results. Run the check again shortly for the full report.",
        progress: "",
      });
    } catch (e) {
      setState((s) => ({ ...s, phase: "error", error: (e as Error).message }));
    }
  }, []);

  const reset = useCallback(() => {
    cancelled.current = true;
    setState({ phase: "idle", indexed: [], unindexed: [], error: null, progress: "" });
  }, []);

  return { ...state, run, reset };
}

/**
 * Standalone index check (create → poll → report) usable outside React state,
 * e.g. per-order in the Link Insertion page.
 */
export async function checkIndex(
  urls: string[],
  engine: "google" | "yandex" | "bing" = "google"
): Promise<{ indexed: string[]; unindexed: string[]; error?: string }> {
  const call = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/index-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  };
  try {
    const created = await call({ action: "create", urls, engine });
    const taskId = created?.data?.task_id || created?.task_id;
    if (created?.error || !taskId) return { indexed: [], unindexed: [], error: created?.error || "create failed" };
    // SpeedyIndex checks run for minutes; poll until completed (generous cap).
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = await call({ action: "status", taskId, engine });
      if (st?.data?.result?.is_completed) break;
    }
    const report = await call({ action: "report", taskId, engine });
    const r = report?.data?.result || {};
    return { indexed: r.indexed_links || [], unindexed: r.unindexed_links || [] };
  } catch (e) {
    return { indexed: [], unindexed: [], error: (e as Error).message };
  }
}

/** Submit URLs to Google indexing (SpeedyIndex indexer) and log tasks. */
export async function submitForIndexing(
  urls: string[],
  engine: "google" | "yandex" | "bing" = "google",
  source: string = "manual"
): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  try {
    const res = await fetch("/api/index-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", urls, engine, source }),
    });
    const data = await res.json();
    const taskId = data?.data?.task_id || data?.task_id;
    if (data?.error || !taskId) return { ok: false, error: data?.error || "Submit failed" };
    return { ok: true, taskId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
