"use client";

import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Detail { website: string; anchor: string; targetUrl: string; page: string; indexStatus: string; docUrl: string; }
interface Row {
  id: string; run_by: string | null; website: string; anchor: string; target_url: string;
  page_url: string; index_status: string; doc_url: string | null; created_at: string; details: Detail[] | null;
}

export default function InsertionLogPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    const supabase = createClient();
    const { data } = await supabase.from("insertion_history").select("*").order("created_at", { ascending: false }).limit(300);
    setRows((data as Row[]) ?? []); setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  async function del(id: string) {
    const supabase = createClient(); await supabase.from("insertion_history").delete().eq("id", id);
    setRows((p) => p.filter((r) => r.id !== id));
  }
  function toggle(id: string) { setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  function exportCsv() {
    const flat: string[][] = [["Run by", "Website", "Anchor", "Target URL", "Page", "Index", "Doc URL", "Date"]];
    for (const r of rows) {
      const d = new Date(r.created_at).toLocaleString();
      if (Array.isArray(r.details) && r.details.length) {
        for (const x of r.details) flat.push([r.run_by || "", x.website, x.anchor, x.targetUrl, x.page, x.indexStatus, x.docUrl, d]);
      } else flat.push([r.run_by || "", r.website, r.anchor, r.target_url, r.page_url, r.index_status, r.doc_url || "", d]);
    }
    const csv = flat.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `insertion-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  return (
    <div>
      <header className="mb-8 flex items-end justify-between">
        <div>
          <div className="eyebrow">Activity</div>
          <h1 className="text-3xl mt-1">Insertion Log</h1>
          <p className="text-[var(--muted)] text-sm mt-2">Every doc generated. Batch runs are one entry — click to expand.</p>
        </div>
        <button onClick={exportCsv} disabled={!rows.length} className="btn-ghost text-sm px-4 py-2">Export CSV</button>
      </header>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-3 eyebrow">Run by</th>
              <th className="px-4 py-3 eyebrow">Website / Batch</th>
              <th className="px-4 py-3 eyebrow">Anchor</th>
              <th className="px-4 py-3 eyebrow">Index</th>
              <th className="px-4 py-3 eyebrow">Doc</th>
              <th className="px-4 py-3 eyebrow">Date</th>
              <th className="px-4 py-3 eyebrow text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isBatch = Array.isArray(r.details) && r.details.length > 0;
              const open = expanded.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className="border-b border-[var(--border)] hover:bg-[var(--panel-2)]">
                    <td className="px-4 py-3">{r.run_by || "—"}</td>
                    <td className="px-4 py-3 font-medium">
                      {isBatch ? <button onClick={() => toggle(r.id)} className="flex items-center gap-2 hover:text-[var(--accent-strong)]"><span className="mono text-xs">{open ? "▾" : "▸"}</span>{r.website}</button> : r.website}
                    </td>
                    <td className="px-4 py-3">{r.anchor}</td>
                    <td className="px-4 py-3"><span className={`pill mono ${r.index_status.includes("indexed") && !r.index_status.includes("not") ? "pill-pos" : r.index_status === "batch" ? "pill-mut" : "pill-warn"}`}>{r.index_status}</span></td>
                    <td className="px-4 py-3">{r.doc_url ? <a href={r.doc_url} target="_blank" rel="noreferrer" className="pill pill-pos mono">Open ↗</a> : (isBatch ? <span className="text-[var(--muted)] text-xs">expand</span> : "—")}</td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs mono">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => del(r.id)} className="btn-ghost text-xs px-2 py-1" style={{ color: "var(--danger)" }}>Delete</button></td>
                  </tr>
                  {open && isBatch && (
                    <tr className="border-b border-[var(--border)] bg-black/20">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="space-y-1.5">
                          {r.details!.map((x, idx) => (
                            <div key={idx} className="flex items-center gap-3 text-xs">
                              <span className="w-44 truncate font-medium">{x.website}</span>
                              <span className="w-40 truncate text-[var(--muted)]">{x.anchor}</span>
                              <span className={`pill mono ${x.indexStatus.includes("indexed") && !x.indexStatus.includes("not") ? "pill-pos" : "pill-warn"}`}>{x.indexStatus}</span>
                              <span className="mono text-[var(--muted)] truncate flex-1">{x.page}</span>
                              {x.docUrl && <a href={x.docUrl} target="_blank" rel="noreferrer" className="btn-ghost px-2 py-0.5">Open ↗</a>}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--muted)] text-sm">No insertion docs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
