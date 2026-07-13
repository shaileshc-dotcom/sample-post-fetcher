"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { download } from "@/lib/export";
import { DATE_PRESETS } from "@/lib/categories";
import { getGlobalSettings } from "@/lib/app-settings";
import { getProfile } from "@/lib/profile";
import { normalizeDomain } from "@/lib/http";

interface Row {
  id: string;
  website: string;
  page_url: string;
  anchor: string;
  target_url: string;
  index_status: string | null;
  link_present: boolean | null;
  link_dofollow: boolean | null;
  last_checked_at: string | null;
  created_at: string;
}

type LinkFilter = "all" | "unchecked" | "live" | "not_found";
type IndexFilter = "all" | "indexed" | "not_indexed" | "unknown";

const isIndexed = (status: string | null) => !!status && status.includes("indexed") && !status.includes("not");

/** Runs `fn` over `items` with at most `n` in flight — bulk re-check without hammering target sites or our own function timeout. */
async function runPooled<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const item = items[idx++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export default function BacklinkMonitorPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [sinceDays, setSinceDays] = useState(0);
  const [siteQuery, setSiteQuery] = useState("");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [indexFilter, setIndexFilter] = useState<IndexFilter>("all");

  // Bulk checker
  const [bulkChecking, setBulkChecking] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  // Sync state + CSV import
  const [autoSync, setAutoSync] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const [{ data, error }, settings] = await Promise.all([
      supabase
        .from("insertion_history")
        .select("id, website, page_url, anchor, target_url, index_status, link_present, link_dofollow, last_checked_at, created_at")
        .eq("backlink_tracked", true)
        .order("created_at", { ascending: false })
        .limit(500),
      getGlobalSettings(),
    ]);
    if (error) setError(error.message);
    setRows((data as Row[]) ?? []);
    setAutoSync(settings.backlinkAutoSync);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  /** Parses a simple CSV (Site,Target Page,Our URL,Anchor — header row required) and inserts each row directly, regardless of the sync setting. */
  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportMsg(null); setError(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error("CSV needs a header row plus at least one data row.");
      const parseLine = (line: string) =>
        line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.slice(0, -1).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
      const dataRows = lines.slice(1).map(parseLine).filter((c) => c.some(Boolean));
      if (!dataRows.length) throw new Error("No data rows found after the header.");

      const supa = createClient();
      const { data: { user } } = await supa.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { profile } = await getProfile();
      const runBy = profile.display_name || user.email || "";

      const inserts = dataRows.map(([site, pageUrl, ourUrl, anchor]) => ({
        user_id: user.id,
        run_by: runBy,
        website: site || (pageUrl ? normalizeDomain(pageUrl) : ""),
        page_url: pageUrl || "",
        target_url: ourUrl || "",
        anchor: anchor || "",
        backlink_tracked: true,
      })).filter((r) => r.page_url && r.target_url);

      if (!inserts.length) throw new Error("No valid rows — each needs at least a Target Page and Our URL.");
      const { error: insErr } = await supa.from("insertion_history").insert(inserts);
      if (insErr) throw insErr;
      setImportMsg(`Imported ${inserts.length} link(s).`);
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function checkOne(row: Row) {
    try {
      const res = await fetch("/api/backlink-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, pageUrl: row.page_url, targetUrl: row.target_url }),
      });
      const data = await res.json();
      setRows((prev) => prev.map((r) => r.id === row.id
        ? { ...r, link_present: data.error ? null : data.present, link_dofollow: data.error ? null : data.dofollow, last_checked_at: new Date().toISOString() }
        : r));
    } catch {
      /* leave row as-is on network failure — bulk run continues with the rest */
    }
  }

  async function recheck(row: Row) {
    setCheckingId(row.id);
    try {
      await checkOne(row);
    } finally {
      setCheckingId(null);
    }
  }

  async function checkAllFiltered() {
    if (!filtered.length || bulkChecking) return;
    setBulkChecking(true);
    setBulkProgress({ done: 0, total: filtered.length });
    let done = 0;
    await runPooled(filtered, 3, async (row) => {
      await checkOne(row);
      done++;
      setBulkProgress({ done, total: filtered.length });
    });
    setBulkChecking(false);
    setBulkProgress(null);
  }

  const filtered = useMemo(() => {
    const cutoff = sinceDays ? Date.now() - sinceDays * 86400000 : null;
    const q = siteQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (cutoff && new Date(r.created_at).getTime() < cutoff) return false;
      if (q && !r.website.toLowerCase().includes(q) && !r.target_url.toLowerCase().includes(q)) return false;
      if (linkFilter === "unchecked" && r.link_present !== null) return false;
      if (linkFilter === "live" && r.link_present !== true) return false;
      if (linkFilter === "not_found" && r.link_present !== false) return false;
      if (indexFilter === "indexed" && !isIndexed(r.index_status)) return false;
      if (indexFilter === "not_indexed" && (isIndexed(r.index_status) || !r.index_status)) return false;
      if (indexFilter === "unknown" && r.index_status) return false;
      return true;
    });
  }, [rows, sinceDays, siteQuery, linkFilter, indexFilter]);

  function exportCsv() {
    const head = "Site,Target Page,Our URL,Anchor,Link Present,Dofollow,Index Status,Last Checked";
    const body = filtered.map((r) => [
      r.website, r.page_url, r.target_url, r.anchor,
      r.link_present === null ? "unchecked" : r.link_present ? "yes" : "no",
      r.link_dofollow === null ? "unchecked" : r.link_dofollow ? "yes" : "no",
      r.index_status || "unknown",
      r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : "never",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    download("backlink-monitor.csv", `${head}\r\n${body}`, "text/csv");
  }

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <div className="eyebrow">SEO</div>
          <h1 className="text-3xl mt-1">Backlink Monitor</h1>
          <p className="text-[var(--muted)] text-sm mt-2 max-w-2xl">
            Tracks every link placed via Link Insertion. Re-check confirms whether the
            link is still live and whether it&apos;s dofollow — some publisher sites block
            automated fetches, which shows up as an unchecked/error result rather than
            &quot;removed.&quot; Index status comes from the last Indexing run, not a live check.
          </p>
          {!autoSync && (
            <p className="text-xs mt-2" style={{ color: "var(--warn)" }}>
              Auto-sync from Link Insertion is currently OFF (Team &amp; Access) — new links only
              appear here via Import CSV below.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="btn-ghost px-4 py-2 text-sm whitespace-nowrap cursor-pointer">
            {importing ? "Importing…" : "Import CSV"}
            <input ref={importInputRef} type="file" accept=".csv" onChange={importCsv} disabled={importing} className="hidden" />
          </label>
          <button onClick={exportCsv} disabled={!filtered.length} className="btn-ghost px-4 py-2 text-sm whitespace-nowrap">Export CSV</button>
        </div>
      </header>

      {importMsg && <p className="text-xs mb-4" style={{ color: "var(--positive)" }}>{importMsg}</p>}
      {error && <div className="rounded-xl border border-[var(--danger)]/30 text-[var(--danger)] text-sm px-4 py-3 mb-6">{error}</div>}

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <div className="eyebrow mb-1">Placed since</div>
          <select value={sinceDays} onChange={(e) => setSinceDays(Number(e.target.value))} className="input px-3 py-2 text-sm">
            {DATE_PRESETS.map((d) => (<option key={d.label} value={d.days}>{d.label}</option>))}
          </select>
        </div>
        <div>
          <div className="eyebrow mb-1">Site / target URL</div>
          <input value={siteQuery} onChange={(e) => setSiteQuery(e.target.value)} placeholder="e.g. amrytt.com" className="input px-3 py-2 text-sm w-48" />
        </div>
        <div>
          <div className="eyebrow mb-1">Link</div>
          <select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value as LinkFilter)} className="input px-3 py-2 text-sm">
            <option value="all">All</option>
            <option value="unchecked">Unchecked</option>
            <option value="live">Live</option>
            <option value="not_found">Not found</option>
          </select>
        </div>
        <div>
          <div className="eyebrow mb-1">Index</div>
          <select value={indexFilter} onChange={(e) => setIndexFilter(e.target.value as IndexFilter)} className="input px-3 py-2 text-sm">
            <option value="all">All</option>
            <option value="indexed">Indexed</option>
            <option value="not_indexed">Not indexed</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {bulkProgress && (
            <span className="text-xs text-[var(--muted)] mono">{bulkProgress.done}/{bulkProgress.total} checked…</span>
          )}
          <button onClick={checkAllFiltered} disabled={bulkChecking || !filtered.length} className="btn-primary px-4 py-2 text-sm whitespace-nowrap">
            {bulkChecking ? "Checking…" : `Check all (${filtered.length})`}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-3 eyebrow">Site</th>
              <th className="px-4 py-3 eyebrow">Target Page</th>
              <th className="px-4 py-3 eyebrow">Our URL</th>
              <th className="px-4 py-3 eyebrow">Link</th>
              <th className="px-4 py-3 eyebrow">Follow</th>
              <th className="px-4 py-3 eyebrow">Index</th>
              <th className="px-4 py-3 eyebrow">Last checked</th>
              <th className="px-4 py-3 eyebrow text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
                <td className="px-4 py-3 mono truncate max-w-[10rem] text-[var(--muted)]" title={r.website}>{r.website}</td>
                <td className="px-4 py-3 mono truncate max-w-xs" title={r.page_url}>
                  <a href={r.page_url} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-strong)]">{r.page_url}</a>
                </td>
                <td className="px-4 py-3 mono truncate max-w-xs text-[var(--muted)]" title={r.target_url}>{r.target_url}</td>
                <td className="px-4 py-3">
                  <span className={`pill mono ${r.link_present === null ? "pill-mut" : r.link_present ? "pill-pos" : "pill-warn"}`}>
                    {r.link_present === null ? "unchecked" : r.link_present ? "live" : "not found"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`pill mono ${r.link_dofollow === null ? "pill-mut" : r.link_dofollow ? "pill-pos" : "pill-warn"}`}>
                    {r.link_dofollow === null ? "—" : r.link_dofollow ? "dofollow" : "nofollow"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`pill mono ${isIndexed(r.index_status) ? "pill-pos" : "pill-warn"}`}>{r.index_status || "unknown"}</span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)] mono">
                  {r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : "never"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => recheck(r)} disabled={checkingId === r.id || bulkChecking} className="btn-ghost text-xs px-3 py-1.5">
                    {checkingId === r.id ? "Checking…" : "Re-check"}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--muted)] text-sm">
                {rows.length === 0 ? "No placed links yet — they'll show up here after Link Insertion runs." : "No links match the current filters."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
