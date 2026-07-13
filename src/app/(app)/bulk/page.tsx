"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useBulkRun, type BulkItem } from "@/lib/bulk-run-context";
import { toDomainCSV, toJSON, download, type DomainGroup } from "@/lib/export";
import { getSettings } from "@/lib/settings";
import { getMyPrompt } from "@/lib/app-settings";
import { submitForIndexing } from "@/lib/hooks/useIndexCheck";
import { CategorySelect } from "@/components/category-select";
import { DATE_PRESETS } from "@/lib/categories";

const VISIBLE_CAP = 500; // render cap so huge runs stay smooth; export has everything

export default function BulkPage() {
  const [raw, setRaw] = useState("");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("");
  const [sinceDays, setSinceDays] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "found" | "failed">("all");
  const [q, setQ] = useState("");
  const { items, state, startedAt, start, pause, resume, cancel, retryFailed, reset } = useBulkRun();

  useEffect(() => { void getMyPrompt().then(setPrompt); }, []);
  const postsPerDomain = getSettings().postsPerDomain;
  const busy = state === "running" || state === "paused";

  const stats = useMemo(() => {
    const done = items.filter((i) => i.status === "done").length;
    const failed = items.filter((i) => i.status === "failed").length;
    const running = items.filter((i) => i.status === "running").length;
    const total = items.length;
    const completed = done + failed;
    const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
    const speed = elapsed > 0 ? completed / elapsed : 0;
    const eta = speed > 0 ? Math.round((total - completed) / speed) : null;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    const totalPosts = items.reduce((s, i) => s + i.articles.length, 0);
    return { done, failed, running, total, completed, speed, eta, pct, totalPosts };
  }, [items, startedAt]);

  const groups: DomainGroup[] = useMemo(
    () => items.filter((i) => i.articles.length).map((i) => ({ domain: i.domain, articles: i.articles })),
    [items]
  );

  const filtered = useMemo(() => {
    let list = items;
    if (filter === "found") list = list.filter((i) => i.articles.length > 0);
    else if (filter === "failed") list = list.filter((i) => i.status === "failed");
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((i) => i.domain.toLowerCase().includes(term));
    return list;
  }, [items, filter, q]);

  const visible = filtered.slice(0, VISIBLE_CAP);

  function exportFullReport() {
    const header = ["Domain", "Status", "Posts Found", "Sample URLs", "Method", "Error"];
    const rows = items.map((it) => [
      it.domain,
      it.status === "done" ? "found" : it.status === "failed" ? "no posts / error" : it.status,
      String(it.articles.length),
      it.articles.slice(0, postsPerDomain).map((a) => a.url).join(" | "),
      it.method || "",
      it.error || "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    download(`bulk-report-all-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
  }

  const domainCount = raw.split(/[\n,]/).filter((d) => d.trim()).length;

  return (
    <div>
      <header className="mb-6">
        <div className="eyebrow">Scout at scale</div>
        <h1 className="text-3xl mt-1">Bulk Search</h1>
        <p className="text-[var(--muted)] text-sm mt-1">Paste domains (one per line). Each is fetched for {postsPerDomain} sample posts.</p>
      </header>

      {!busy && state !== "done" && (
        <div className="card p-5 mb-6">
          <label className="eyebrow">Domains</label>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={8}
            placeholder={"example.com\ntechcrunch.com\nmetapress.com"}
            className="input w-full px-4 py-3 text-sm mono resize-y mt-1.5" />
          <div className="mt-3">
            <label className="eyebrow">Prompt (applies to every domain)</label>
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. recent high-quality editorial posts" className="input w-full px-4 py-2.5 text-sm mt-1.5" />
          </div>
          <div className="grid md:grid-cols-2 gap-4 mt-3">
            <div>
              <label className="eyebrow">Category</label>
              <div className="mt-1.5"><CategorySelect value={category} onChange={setCategory} /></div>
            </div>
            <div>
              <label className="eyebrow">Date</label>
              <select value={sinceDays ?? 0} onChange={(e) => { const d = Number(e.target.value); setSinceDays(d === 0 ? null : d); }} className="input w-full px-3 py-2 text-sm mt-1.5">
                {DATE_PRESETS.map((d) => (<option key={d.label} value={d.days}>{d.label}</option>))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-[var(--muted)] mono">{domainCount} domains · concurrency {getSettings().concurrency}</span>
            <button onClick={() => start(raw, [category, prompt.trim()].filter(Boolean).join(". "), sinceDays)} disabled={!domainCount} className="btn-primary px-5 py-2.5 text-sm">Start Bulk Fetch</button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <>
          {/* Progress + controls */}
          <div className="card p-5 mb-5">
            <div className="flex items-center justify-between mb-3 text-sm flex-wrap gap-2">
              <div className="text-[var(--muted)]">
                <span className="text-[var(--text)] font-medium">{stats.completed}</span>/{stats.total} ·{" "}
                <span style={{ color: "var(--positive)" }}>{stats.done} found</span> ·{" "}
                <span style={{ color: "var(--danger)" }}>{stats.failed} no posts</span> ·{" "}
                {stats.running} running · <span className="mono">{stats.totalPosts} posts</span>
              </div>
              <div className="text-[var(--muted)] text-xs mono">{stats.speed.toFixed(1)}/s{stats.eta !== null && state === "running" ? ` · ETA ${stats.eta}s` : ""}</div>
            </div>
            <div className="h-2 rounded-full bg-[var(--panel-2)] overflow-hidden">
              <motion.div className="h-full" style={{ background: "var(--grad)" }} animate={{ width: `${stats.pct}%` }} transition={{ ease: "easeOut" }} />
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              {state === "running" && <Ctrl label="Pause" onClick={pause} />}
              {state === "paused" && <Ctrl label="Resume" onClick={resume} />}
              {busy && <Ctrl label="Cancel" onClick={cancel} />}
              {state === "done" && stats.failed > 0 && <Ctrl label="Retry failed" onClick={retryFailed} />}
              {(state === "done" || state === "idle") && <Ctrl label="New search" onClick={reset} />}
              <Ctrl label={`Export ALL domains (${items.length})`} onClick={exportFullReport} primary />
              {groups.length > 0 && <Ctrl label={`Export found only (${groups.length})`} onClick={() => download("bulk-found.csv", toDomainCSV(groups, postsPerDomain), "text/csv")} />}
              {groups.length > 0 && <Ctrl label="JSON" onClick={() => download("bulk-export.json", toJSON(groups), "application/json")} />}
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="inline-flex p-1 rounded-lg border border-[var(--border)] bg-[var(--panel)]">
              {(["all", "found", "failed"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-md text-xs transition ${filter === f ? "text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                  style={filter === f ? { background: "var(--grad)", fontWeight: 600 } : undefined}>
                  {f === "all" ? `All (${items.length})` : f === "found" ? `Found (${groups.length})` : `No posts (${stats.failed})`}
                </button>
              ))}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by domain…" className="input px-3 py-1.5 text-sm w-56" />
            <span className="text-xs text-[var(--muted)] mono ml-auto">
              {filtered.length > VISIBLE_CAP ? `Showing ${VISIBLE_CAP} of ${filtered.length} — export for all` : `${filtered.length} shown`}
            </span>
          </div>

          {/* Results — fixed layout so long URLs never overlap */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "22%" }} /><col style={{ width: "12%" }} /><col style={{ width: "8%" }} />
                <col style={{ width: "38%" }} /><col style={{ width: "20%" }} />
              </colgroup>
              <thead>
                <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="px-4 py-3 eyebrow">Domain</th>
                  <th className="px-4 py-3 eyebrow">Status</th>
                  <th className="px-4 py-3 eyebrow">Posts</th>
                  <th className="px-4 py-3 eyebrow">Sample URLs / Error</th>
                  <th className="px-4 py-3 eyebrow text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((it) => (
                  <tr key={it.domain} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)] align-top">
                    <td className="px-4 py-3 font-medium truncate" title={it.domain}>{it.domain}</td>
                    <td className="px-4 py-3"><StatusBadge status={it.status} /></td>
                    <td className="px-4 py-3 text-[var(--muted)] mono">{it.articles.length || "—"}</td>
                    <td className="px-4 py-3">
                      {it.articles.length ? (
                        <div className="space-y-0.5">
                          {it.articles.slice(0, postsPerDomain).map((a) => (
                            <div key={a.url} className="mono text-[11px] text-[var(--muted)] truncate" title={a.url}>{a.url}</div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] mono" style={{ color: it.status === "failed" ? "var(--danger)" : "var(--muted)" }}>{it.error || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {it.articles.length ? (
                        <>
                          <button onClick={() => navigator.clipboard.writeText(it.articles.slice(0, postsPerDomain).map((a) => a.url).join("\n"))} className="btn-ghost text-xs px-2 py-1 mr-1">Copy</button>
                          <button onClick={() => it.articles.slice(0, postsPerDomain).forEach((a) => window.open(a.url, "_blank", "noopener"))} className="btn-ghost text-xs px-2 py-1 mr-1">Open</button>
                          <button onClick={async () => { const r = await submitForIndexing(it.articles.slice(0, postsPerDomain).map((a) => a.url), "google", "bulk"); alert(r.ok ? "Submitted for indexing" : "Error: " + r.error); }} className="btn-ghost text-xs px-2 py-1">Index</button>
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)] text-sm">No rows match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { c: string; label: string }> = {
    queued: { c: "pill-mut", label: "queued" },
    running: { c: "pill-amber", label: "running" },
    done: { c: "pill-pos", label: "found" },
    failed: { c: "pill-warn", label: "no posts" },
  };
  const m = map[status] || { c: "pill-mut", label: status };
  return <span className={`pill ${m.c} mono`}>{m.label}</span>;
}

function Ctrl({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className={primary ? "btn-primary text-xs px-3 py-1.5" : "btn-ghost text-xs px-3 py-1.5"}>{label}</button>
  );
}
