"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface BulkDetail { domain: string; count: number; urls: string[]; }
interface HistoryRow {
  id: string;
  domain: string;
  articles_found: number;
  duration_ms: number;
  fetch_method: string | null;
  status: string;
  is_favorite: boolean;
  created_at: string;
  details: BulkDetail[] | null;
  run_by: string | null;
}

export default function HistoryPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [onlyFav, setOnlyFav] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    setEmail(user?.email ?? "");
    const { data } = await supabase.from("search_history").select("*").order("created_at", { ascending: false }).limit(500);
    setRows((data as HistoryRow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function remove(id: string) {
    setRows((p) => p.filter((r) => r.id !== id));
    await supabase.from("search_history").delete().eq("id", id);
  }
  async function toggleFav(row: HistoryRow) {
    const next = !row.is_favorite;
    setRows((p) => p.map((r) => (r.id === row.id ? { ...r, is_favorite: next } : r)));
    await supabase.from("search_history").update({ is_favorite: next }).eq("id", row.id);
  }
  function toggleExpand(id: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function exportCsv() {
    const header = ["Run by", "Domain", "Posts Found", "Method", "Status", "Date", "Bulk domains"];
    const out = rows.map((r) => [
      r.run_by || "", r.domain, String(r.articles_found), r.fetch_method || "", r.status,
      new Date(r.created_at).toLocaleString(),
      Array.isArray(r.details) ? r.details.map((d) => `${d.domain}(${d.count})`).join(" | ") : "",
    ]);
    const csv = [header, ...out].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const visible = onlyFav ? rows.filter((r) => r.is_favorite) : rows;

  return (
    <div>
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="eyebrow">Activity</div>
          <h1 className="text-3xl mt-1">History</h1>
          <p className="text-[var(--muted)] text-sm mt-1">Every search you&apos;ve run. Click a bulk run to see its domains.</p>
        </div>
        <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
          <input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} />
          Favorites only
        </label>
        <button onClick={exportCsv} disabled={!rows.length} className="btn-ghost text-xs px-3 py-1.5">Export CSV</button>
        </div>
      </header>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)] border-b border-[var(--border)] bg-[var(--panel)]">
              <th className="px-4 py-3 font-medium">Domain</th>
              <th className="px-4 py-3 font-medium">Run by</th>
              <th className="px-4 py-3 font-medium">Found</th>
              <th className="px-4 py-3 font-medium">Method</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isBulk = r.fetch_method === "bulk";
              const hasDetails = isBulk && Array.isArray(r.details) && r.details.length > 0;
              const open = expanded.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className="border-b border-[var(--border)] hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium">
                      {hasDetails ? (
                        <button onClick={() => toggleExpand(r.id)} className="flex items-center gap-2 hover:text-[var(--accent)]">
                          <span className="mono text-xs">{open ? "▾" : "▸"}</span>{r.domain}
                        </button>
                      ) : r.domain}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs">{r.run_by || email || "—"}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{r.articles_found}</td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs">{r.fetch_method || "—"}</td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => toggleFav(r)} title="Favorite" className="mr-2 text-sm">{r.is_favorite ? "★" : "☆"}</button>
                      {!isBulk && (
                        <Link href={`/search?d=${encodeURIComponent(r.domain)}`} className="text-xs px-2 py-1 rounded-md border border-[var(--border)] hover:bg-white/5 mr-2">Re-run</Link>
                      )}
                      <button onClick={() => remove(r.id)} className="text-xs px-2 py-1 rounded-md border border-[var(--border)] hover:bg-white/5 text-red-400/80">Delete</button>
                    </td>
                  </tr>
                  {open && hasDetails && (
                    <tr className="border-b border-[var(--border)] bg-black/20">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="eyebrow">{r.details!.length} domains</span>
                          <button
                            onClick={() => {
                              const header = ["Domain", "Posts", "URLs"];
                              const csv = [header, ...r.details!.map((d) => [d.domain, String(d.count), d.urls.join(" | ")])]
                                .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
                              const a = document.createElement("a");
                              a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                              a.download = `bulk-run-${r.id.slice(0, 8)}.csv`;
                              a.click();
                            }}
                            className="btn-ghost text-xs px-3 py-1">Export this run</button>
                        </div>
                        <div className="space-y-1.5">
                          {r.details!.map((d, i) => (
                            <div key={i} className="flex items-center gap-3 text-xs">
                              <span className="font-medium w-56 truncate">{d.domain}</span>
                              <span className="pill pill-mut mono">{d.count}</span>
                              <span className="text-[var(--muted)] mono truncate flex-1">{d.urls.join(", ") || "—"}</span>
                              {d.urls.length > 0 && (
                                <>
                                  <button onClick={() => navigator.clipboard.writeText(d.urls.join("\n"))} className="btn-ghost px-2 py-0.5">Copy</button>
                                  <button onClick={() => d.urls.forEach((u) => window.open(u, "_blank", "noopener"))} className="btn-ghost px-2 py-0.5">Open</button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted)] text-sm">Nothing here yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
