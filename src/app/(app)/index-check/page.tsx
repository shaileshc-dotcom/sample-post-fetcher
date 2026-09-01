"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useIndexCheck, submitForIndexing, checkIndex } from "@/lib/hooks/useIndexCheck";
import { createClient } from "@/lib/supabase/client";
import { getSettings, saveSettings } from "@/lib/settings";
import { download } from "@/lib/export";

interface Task {
  id: string; url: string; task_id: string; source: string; status: string; created_at: string;
}

// Domain Pages: time windows shown as columns (values keyed by these in the API response).
const WINDOWS = [
  { key: "any", label: "Any time" },
  { key: "last_day", label: "Past 24h" },
  { key: "last_week", label: "Past week" },
  { key: "last_month", label: "Past month" },
  { key: "last_year", label: "Past year" },
] as const;
interface Coverage { domain: string; counts: Record<string, number | null>; error?: string }

const serpUrl = (u: string) => `https://www.google.com/search?q=${encodeURIComponent(`site:${u}`)}`;
const parseUrls = (raw: string) => [...new Set(raw.split(/[\n,]/).map((u) => u.trim()).filter(Boolean))];
const domainOf = (u: string) => {
  try { return new URL(u.startsWith("http") ? u : "https://" + u).hostname.replace(/^www\./, ""); }
  catch { return ""; }
};

const SOURCE_STYLE: Record<string, string> = {
  single: "pill-amber", bulk: "pill-warn", insertion: "pill-pos", manual: "pill-mut",
};

export default function IndexAndTasksPage() {
  const [tab, setTab] = useState<"check" | "submit" | "coverage">("check");
  const idx = useIndexCheck();

  // Domain Pages (SearchApi — indexed pages per domain, with time windows + eligibility)
  const [covRaw, setCovRaw] = useState("");
  const covDomains = parseUrls(covRaw);
  const [breakdown, setBreakdown] = useState(false);
  const [minPages, setMinPages] = useState(30);
  const [provider, setProvider] = useState<"searchapi" | "serpapi">("searchapi");
  const [covResults, setCovResults] = useState<Coverage[]>([]);
  const [covLoading, setCovLoading] = useState(false);
  const [covErr, setCovErr] = useState<string | null>(null);
  useEffect(() => { const s = getSettings(); setMinPages(s.minIndexedPages); setProvider(s.serpProvider); }, []);

  async function runCoverage() {
    if (!covDomains.length) return;
    setCovLoading(true); setCovResults([]); setCovErr(null);
    try {
      const res = await fetch("/api/index-check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "site-count", domains: covDomains, breakdown, provider }),
      });
      const data = await res.json();
      if (data?.error) setCovErr(data.error);
      else setCovResults((data.coverage as Coverage[]) || []);
    } catch (e) { setCovErr((e as Error).message); } finally { setCovLoading(false); }
  }
  const isEligible = (c: Coverage) => (c.counts?.any ?? 0) >= minPages;
  function saveMinPages(v: number) {
    setMinPages(v);
    saveSettings({ ...getSettings(), minIndexedPages: v });
  }
  function exportCoverage(which: "eligible" | "ineligible" | "all") {
    const rows = covResults.filter((c) => which === "all" ? true : which === "eligible" ? isEligible(c) : !isEligible(c));
    if (!rows.length) return;
    const header = ["Domain", ...WINDOWS.map((w) => w.label), "Eligible", `Min pages (${minPages})`];
    const lines = rows.map((c) =>
      [c.domain, ...WINDOWS.map((w) => c.counts?.[w.key] ?? ""), isEligible(c) ? "yes" : "no", minPages].join(","),
    );
    download(`domain-pages-${which}.csv`, [header.join(","), ...lines].join("\n"), "text/csv");
  }
  // Flow: carry the INDEXED domains from Check Index over to Domain Pages.
  function sendIndexedToCoverage() {
    const domains = [...new Set(idx.indexed.map(domainOf).filter(Boolean))];
    if (!domains.length) return;
    setCovRaw(domains.join("\n"));
    setTab("coverage");
  }

  // Balance
  const [balance, setBalance] = useState<{ tokens?: number; indexer?: number; checker?: number } | null>(null);
  const [balErr, setBalErr] = useState<string | null>(null);
  const [balLoading, setBalLoading] = useState(false);
  async function loadBalance() {
    setBalLoading(true); setBalErr(null);
    try {
      const res = await fetch("/api/index-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "account" }) });
      const data = await res.json();
      if (data?.error) { setBalErr(data.error); setBalance(null); } else setBalance(data?.data?.balance ?? null);
    } catch (e) { setBalErr((e as Error).message); } finally { setBalLoading(false); }
  }
  useEffect(() => { void loadBalance(); }, []);
  useEffect(() => { if (idx.phase === "done") void loadBalance(); }, [idx.phase]);

  // Check tab
  const [checkRaw, setCheckRaw] = useState("");
  const checkUrls = parseUrls(checkRaw);
  const busyCheck = idx.phase === "creating" || idx.phase === "polling";

  // Submit tab
  const [submitRaw, setSubmitRaw] = useState("");
  const submitUrls = parseUrls(submitRaw);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  async function doSubmit() {
    if (!submitUrls.length) return;
    setSubmitting(true); setSubmitMsg(null);
    const r = await submitForIndexing(submitUrls, "google", "manual");
    setSubmitting(false);
    if (r.ok) { setSubmitMsg(`Submitted ${submitUrls.length} URL(s) for indexing.`); setSubmitRaw(""); await loadTasks(); await loadBalance(); }
    else setSubmitMsg(`Error: ${r.error}`);
  }

  // Tasks (deduped to one row per URL — most recent kept)
  const [tasks, setTasks] = useState<Task[]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  async function loadTasks() {
    const supabase = createClient();
    const { data } = await supabase.from("index_tasks").select("*").order("created_at", { ascending: false }).limit(500);
    setTasks((data as Task[]) ?? []);
  }
  useEffect(() => { void loadTasks(); }, []);
  const dedupedTasks = useMemo(() => {
    const seen = new Set<string>(); const out: Task[] = [];
    for (const t of tasks) { if (!seen.has(t.url)) { seen.add(t.url); out.push(t); } }
    return out;
  }, [tasks]);

  // Refresh true index status via the SpeedyIndex CHECKER (not the indexer task).
  async function refreshTask(t: Task) {
    setRefreshing(t.id);
    try {
      const { indexed } = await checkIndex([t.url]);
      const status = indexed.includes(t.url) ? "indexed" : "not_indexed";
      const supabase = createClient();
      await supabase.from("index_tasks").update({ status }).eq("url", t.url);
      await loadTasks();
    } finally { setRefreshing(null); }
  }

  async function refreshAll() {
    const urls = dedupedTasks.map((t) => t.url);
    if (!urls.length) return;
    setRefreshingAll(true);
    try {
      const { indexed } = await checkIndex(urls);
      const idxSet = new Set(indexed);
      const supabase = createClient();
      await Promise.all(dedupedTasks.map((t) => supabase.from("index_tasks").update({ status: idxSet.has(t.url) ? "indexed" : "not_indexed" }).eq("url", t.url)));
      await loadTasks();
    } finally { setRefreshingAll(false); }
  }
  async function deleteTask(t: Task) {
    setTasks((p) => p.filter((x) => x.id !== t.id));
    const supabase = createClient();
    await supabase.from("index_tasks").delete().eq("url", t.url);
  }

  return (
    <div>
      <header className="mb-6">
        <div className="eyebrow">Verification · SpeedyIndex</div>
        <h1 className="text-3xl mt-1">Index Check &amp; Tasks</h1>
        <p className="text-[var(--muted)] text-sm mt-2 max-w-2xl">
          Check indexing (SpeedyIndex or live Google SERP), submit pages for indexing, and track every task.
        </p>
      </header>

      {/* Balance */}
      <div className="card p-4 mb-6 flex items-center gap-4 flex-wrap">
        <div className="eyebrow">SpeedyIndex balance</div>
        {balErr ? <span className="text-xs text-[var(--danger)] mono">{balErr}</span>
          : balance ? (
            <div className="flex items-center gap-3 flex-wrap">
              <Bal label="Tokens" value={balance.tokens} hint="pay-per-indexed" />
              <Bal label="Indexer" value={balance.indexer} hint="standard indexing" warn={(balance.indexer ?? 0) < 100} />
              <Bal label="Checker" value={balance.checker} hint="index checks" warn={(balance.checker ?? 0) < 100} />
            </div>
          ) : <span className="text-xs text-[var(--muted)] mono">{balLoading ? "Loading…" : "—"}</span>}
        <button onClick={loadBalance} disabled={balLoading} className="btn-ghost text-xs px-3 py-1.5 ml-auto">{balLoading ? "…" : "Refresh"}</button>
      </div>

      {/* Tabs */}
      <div className="inline-flex p-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] mb-5">
        {(["check", "submit", "coverage"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm transition ${tab === t ? "text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            style={tab === t ? { background: "var(--grad)", fontWeight: 600 } : undefined}>
            {t === "check" ? "Check Index" : t === "submit" ? "Submit for Indexing" : "Domain Pages"}
          </button>
        ))}
      </div>

      {/* Check tab */}
      {tab === "check" && (
        <div className="card p-5 mb-8">
          <textarea value={checkRaw} onChange={(e) => setCheckRaw(e.target.value)} rows={5}
            placeholder={"https://example.com/post-1\nhttps://example.com/post-2"}
            className="input w-full px-4 py-3 text-sm mono resize-y" disabled={busyCheck} />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="text-xs text-[var(--muted)] mono mr-auto">{checkUrls.length} URLs</span>
            <button onClick={() => checkUrls.forEach((u) => window.open(serpUrl(u), "_blank", "noopener"))} disabled={!checkUrls.length} className="btn-ghost text-sm px-4 py-2">
              Check on Google (SERP)
            </button>
            <button onClick={() => idx.run(checkUrls)} disabled={!checkUrls.length || busyCheck} className="btn-primary text-sm px-5 py-2">
              {busyCheck ? (idx.progress || "Checking…") : "Check via SpeedyIndex"}
            </button>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-2">SERP check opens a Google <span className="mono">site:</span> search per URL in new tabs — instant, no tokens. SpeedyIndex check is a background task.</p>

          {idx.phase === "error" && <div className="text-[var(--danger)] text-sm mt-4">{idx.error} <button onClick={idx.reset} className="btn-ghost text-xs px-3 py-1.5 ml-3">Reset</button></div>}
          {idx.phase === "done" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="pill pill-pos mono">{idx.indexed.length} indexed</span>
                <span className="pill pill-warn mono">{idx.unindexed.length} not indexed</span>
                <div className="ml-auto flex items-center gap-2">
                  {idx.indexed.length > 0 && (
                    <button onClick={sendIndexedToCoverage} className="btn-primary text-xs px-3 py-1.5">
                      Send {idx.indexed.length} indexed → Domain Pages →
                    </button>
                  )}
                  <button
                    onClick={() => download("index-check.csv",
                      ["URL,Status", ...idx.indexed.map((u) => `${u},indexed`), ...idx.unindexed.map((u) => `${u},not_indexed`)].join("\n"),
                      "text/csv")}
                    className="btn-ghost text-xs px-3 py-1.5">Export CSV</button>
                  <button onClick={idx.reset} className="btn-ghost text-xs px-3 py-1.5">Clear</button>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <UrlList title="Indexed" cls="pill-pos" urls={idx.indexed} />
                <UrlList title="Not indexed" cls="pill-warn" urls={idx.unindexed} />
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Submit tab */}
      {tab === "submit" && (
        <div className="card p-5 mb-8">
          <textarea value={submitRaw} onChange={(e) => setSubmitRaw(e.target.value)} rows={5}
            placeholder={"https://example.com/page-to-index-1\nhttps://example.com/page-to-index-2"}
            className="input w-full px-4 py-3 text-sm mono resize-y" />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-[var(--muted)] mono">{submitUrls.length} URLs · duplicates are ignored</span>
            <button onClick={doSubmit} disabled={!submitUrls.length || submitting} className="btn-primary px-5 py-2.5 text-sm">
              {submitting ? "Submitting…" : "Submit for indexing"}
            </button>
          </div>
          {submitMsg && <p className="text-xs mt-2 mono" style={{ color: submitMsg.startsWith("Error") ? "var(--danger)" : "var(--positive)" }}>{submitMsg}</p>}
        </div>
      )}

      {/* Domain Pages tab */}
      {tab === "coverage" && (
        <div className="card p-5 mb-8">
          <div className="eyebrow mb-2">Domain Pages · indexed page count (Google SERP)</div>
          <textarea value={covRaw} onChange={(e) => setCovRaw(e.target.value)} rows={4}
            placeholder={"guestpostlinks.net\nbulkdp.com\nexample.com"}
            className="input w-full px-4 py-3 text-sm mono resize-y" disabled={covLoading} />

          <div className="flex flex-wrap items-center gap-4 mt-3">
            <span className="text-xs text-[var(--muted)] mono">{covDomains.length} domains</span>
            <label className="flex items-center gap-1.5 text-xs">
              Min pages
              <input type="number" value={minPages} onChange={(e) => saveMinPages(Number(e.target.value) || 0)}
                className="input w-20 px-2 py-1 text-xs" title="Eligibility threshold — Any-time indexed pages" />
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={breakdown} onChange={(e) => setBreakdown(e.target.checked)} />
              Time breakdown <span className="text-[var(--muted)]">({WINDOWS.length} credits/domain)</span>
            </label>
            <button onClick={runCoverage} disabled={!covDomains.length || covLoading} className="btn-primary px-5 py-2 text-sm ml-auto">
              {covLoading ? "Checking…" : "Get indexed page count"}
            </button>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-2">
            Real Google <span className="mono">site:</span> counts via <strong>{provider === "serpapi" ? "SerpApi.com" : "SearchApi.io"}</strong> (switch in Settings). Any-time only = <strong>1 credit/domain</strong>; with time breakdown = <strong>{WINDOWS.length} credits/domain</strong>. No SpeedyIndex credits.
            Eligible = Any-time pages ≥ Min pages.
            {covDomains.length > 0 && <> · This run ≈ <strong>{covDomains.length * (breakdown ? WINDOWS.length : 1)} credits</strong>.</>}
          </p>

          {covErr && <div className="text-[var(--danger)] text-sm mt-4">{covErr}</div>}

          {covResults.length > 0 && (() => {
            const elig = covResults.filter(isEligible).length;
            const cols = breakdown ? WINDOWS : WINDOWS.slice(0, 1);
            return (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="pill pill-pos mono">{elig} eligible</span>
                  <span className="pill pill-warn mono">{covResults.length - elig} ineligible</span>
                  <span className="text-xs text-[var(--muted)]">(≥ {minPages} pages)</span>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => exportCoverage("eligible")} className="btn-ghost text-xs px-3 py-1.5">Export eligible</button>
                    <button onClick={() => exportCoverage("ineligible")} className="btn-ghost text-xs px-3 py-1.5">Export ineligible</button>
                    <button onClick={() => exportCoverage("all")} className="btn-ghost text-xs px-3 py-1.5">Export all</button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                        <th className="px-3 py-2 eyebrow">Domain</th>
                        {cols.map((w) => <th key={w.key} className="px-3 py-2 eyebrow text-right">{w.label}</th>)}
                        <th className="px-3 py-2 eyebrow text-center">Eligible</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {covResults.map((c, i) => {
                        const ok = isEligible(c);
                        return (
                          <tr key={i} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
                            <td className="px-3 py-2 mono truncate max-w-xs" title={c.domain}>{c.domain}</td>
                            {cols.map((w) => (
                              <td key={w.key} className="px-3 py-2 text-right mono">
                                {c.error ? "—" : (c.counts?.[w.key] ?? 0).toLocaleString()}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-center">
                              {c.error ? <span className="text-[var(--danger)] text-xs mono" title={c.error}>err</span>
                                : <span className={`pill mono ${ok ? "pill-pos" : "pill-warn"}`}>{ok ? "yes" : "no"}</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <a href={serpUrl(c.domain)} target="_blank" rel="noreferrer" className="btn-ghost text-xs px-2 py-1">SERP</a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            );
          })()}
        </div>
      )}

      {/* Tasks */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">Indexing tasks <span className="text-[var(--muted)] mono text-xs">· {dedupedTasks.length} unique URLs</span></h2>
        <div className="flex items-center gap-2">
          <button onClick={refreshAll} disabled={refreshingAll || !dedupedTasks.length} className="btn-ghost text-xs px-3 py-1.5">
            {refreshingAll ? "Re-checking…" : "Refresh all statuses"}
          </button>
          <button onClick={loadTasks} className="btn-ghost text-xs px-3 py-1.5">Reload</button>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-3 eyebrow">URL</th>
              <th className="px-4 py-3 eyebrow">Source</th>
              <th className="px-4 py-3 eyebrow">Status</th>
              <th className="px-4 py-3 eyebrow">Submitted</th>
              <th className="px-4 py-3 eyebrow text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {dedupedTasks.map((t) => (
              <tr key={t.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
                <td className="px-4 py-3 mono text-xs max-w-md truncate" title={t.url}>{t.url}</td>
                <td className="px-4 py-3"><span className={`pill ${SOURCE_STYLE[t.source] || "pill-mut"} mono`}>{t.source}</span></td>
                <td className="px-4 py-3"><span className={`pill mono ${t.status === "indexed" ? "pill-pos" : t.status === "not_indexed" ? "pill-warn" : "pill-amber"}`}>{t.status}</span></td>
                <td className="px-4 py-3 text-[var(--muted)] text-xs mono">{new Date(t.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <a href={serpUrl(t.url)} target="_blank" rel="noreferrer" className="btn-ghost text-xs px-2 py-1 mr-2">SERP</a>
                  <button onClick={() => refreshTask(t)} disabled={refreshing === t.id} className="btn-ghost text-xs px-2 py-1 mr-2">{refreshing === t.id ? "…" : "Refresh"}</button>
                  <button onClick={() => deleteTask(t)} className="btn-ghost text-xs px-2 py-1" style={{ color: "var(--danger)" }}>Delete</button>
                </td>
              </tr>
            ))}
            {dedupedTasks.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)] text-sm">No indexing tasks yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Bal({ label, value, hint, warn }: { label: string; value?: number; hint: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)]" title={hint}>
      <span className="eyebrow">{label}</span>
      <span className={`mono text-sm font-medium ${warn ? "text-[var(--warn)]" : "text-[var(--text)]"}`}>{value?.toLocaleString() ?? "—"}</span>
    </div>
  );
}

function UrlList({ title, cls, urls }: { title: string; cls: string; urls: string[] }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <div className="flex items-center gap-2 mb-3"><span className={`pill ${cls} mono`}>{title}</span><span className="text-xs text-[var(--muted)] mono">{urls.length}</span></div>
      <div className="space-y-1.5 max-h-72 overflow-auto">
        {urls.map((u) => (
          <div key={u} className="flex items-center gap-2 text-xs">
            <a href={`https://www.google.com/search?q=${encodeURIComponent(`site:${u}`)}`} target="_blank" rel="noreferrer" className="text-[var(--muted)] hover:text-[var(--accent-strong)]" title="Open SERP">⌕</a>
            <span className="mono text-[var(--muted)] truncate" title={u}>{u}</span>
          </div>
        ))}
        {!urls.length && <div className="text-xs text-[var(--muted)]">None</div>}
      </div>
    </div>
  );
}
