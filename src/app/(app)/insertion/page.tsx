"use client";

import { useState } from "react";
import { checkIndex, submitForIndexing } from "@/lib/hooks/useIndexCheck";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/profile";
import { getSettings } from "@/lib/settings";

interface Candidate { url: string; title: string; reason: string; score: number; wordCount: number | null; }
type IdxMap = Record<string, "indexed" | "not indexed" | "unknown">;

interface Order {
  id: string;
  website: string;
  anchor: string;
  targetUrl: string;
  instruction: string;
  articlePage: string; // client-provided page (optional) → generate directly
  status: "idle" | "finding" | "found" | "checking" | "generating" | "submitting" | "error";
  candidates: Candidate[];
  chosen: string | null;
  index: IdxMap;
  docUrl?: string;
  error?: string;
}
interface ReportRow { website: string; anchor: string; targetUrl: string; page: string; indexStatus: string; docUrl: string; }

let uid = 0;
const newOrder = (o: Partial<Order> = {}): Order => ({
  id: `o${uid++}`, website: "", anchor: "", targetUrl: "", instruction: "", articlePage: "",
  status: "idle", candidates: [], chosen: null, index: {}, ...o,
});

export default function InsertionPage() {
  const [orders, setOrders] = useState<Order[]>([newOrder()]);
  const [paste, setPaste] = useState("");
  const [busyAll, setBusyAll] = useState<null | string>(null);
  const [report, setReport] = useState<ReportRow[]>([]);
  const [logMsg, setLogMsg] = useState<string | null>(null);

  const patch = (id: string, p: Partial<Order>) => setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } : o)));

  function loadFromPaste() {
    // website ⇥ anchor ⇥ targetUrl ⇥ [instruction] ⇥ [article page]
    const rows = paste.split("\n").map((l) => l.trim()).filter(Boolean)
      .map((line) => (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim()));
    const parsed = rows
      .map((c) => newOrder({ website: c[0] || "", anchor: c[1] || "", targetUrl: c[2] || "", instruction: c[3] || "", articlePage: c[4] || "" }))
      .filter((o) => o.website || o.anchor || o.targetUrl || o.articlePage);
    if (parsed.length) { setOrders(parsed); setPaste(""); }
  }

  function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPaste(String(reader.result || ""));
    reader.readAsText(file);
  }

  // Merge index results into an order (functional so concurrent checks don't clobber).
  async function runCheck(orderId: string, urls: string[]) {
    if (!urls.length) return;
    patch(orderId, { status: "checking" });
    const { indexed, unindexed, error } = await checkIndex(urls);
    setOrders((prev) => prev.map((o) => {
      if (o.id !== orderId) return o;
      if (error) return { ...o, status: "found", error };
      const map: IdxMap = { ...o.index };
      for (const u of indexed) map[u] = "indexed";
      for (const u of unindexed) map[u] = "not indexed";
      return { ...o, status: "found", index: map };
    }));
  }

  async function find(order: Order): Promise<void> {
    if (!order.website || !order.anchor || !order.targetUrl) {
      patch(order.id, { status: "error", error: "Fill website, anchor and target URL." }); return;
    }
    patch(order.id, { status: "finding", error: undefined, candidates: [], chosen: null, index: {}, docUrl: undefined });
    try {
      const res = await fetch("/api/insertion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: order.website, anchor: order.anchor, targetUrl: order.targetUrl, prompt: order.instruction, limit: 4 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const cands: Candidate[] = data.matches || [];
      patch(order.id, { status: "found", candidates: cands, chosen: cands[0]?.url ?? null });
      // Auto index-check the results so badges show without a click.
      if (cands.length && getSettings().autoIndexCheck) void runCheck(order.id, cands.map((c) => c.url));
    } catch (e) {
      patch(order.id, { status: "error", error: (e as Error).message });
    }
  }

  async function findAll() {
    setBusyAll("Finding pages for all orders…");
    for (const o of orders) if (!o.articlePage.trim()) await find(o);
    setBusyAll(null);
  }

  async function submitIndex(order: Order, page: string) {
    patch(order.id, { status: "submitting" });
    const r = await submitForIndexing([page], "google", "insertion");
    patch(order.id, { status: "found", error: r.ok ? undefined : r.error });
    if (r.ok) setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, index: { ...o.index, [page]: "not indexed" } } : o));
  }

  async function generateFor(order: Order, page: string, logMode: "single" | "skip"): Promise<ReportRow | null> {
    patch(order.id, { status: "generating", error: undefined });
    try {
      const res = await fetch("/api/generate-doc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl: page, anchor: order.anchor, targetUrl: order.targetUrl,
          instruction: order.instruction, website: order.website,
          indexStatus: order.index[page] || "unknown",
          autoSubmit: getSettings().autoIndexSubmit,
          docTitle: `Link Insertion — ${order.website || page} — ${order.anchor}`,
          logMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Doc generation failed");
      patch(order.id, { status: "found", docUrl: data.docUrl });
      return { website: order.website, anchor: order.anchor, targetUrl: order.targetUrl, page,
        indexStatus: data.submittedForIndexing ? "submitted for indexing" : (order.index[page] || "unknown"), docUrl: data.docUrl };
    } catch (e) {
      patch(order.id, { status: "error", error: (e as Error).message });
      return null;
    }
  }
  const generate = (o: Order) => o.chosen && generateFor(o, o.chosen, "single");
  const generateDirect = (o: Order) => o.articlePage.trim() && generateFor(o, o.articlePage.trim(), "single");

  async function generateAll() {
    setBusyAll("Generating docs…"); setLogMsg(null);
    const rows: ReportRow[] = [];
    for (const o of orders) {
      const page = o.articlePage.trim() || o.chosen;
      if (page) { const r = await generateFor(o, page, "skip"); if (r) rows.push(r); }
    }
    setReport(rows);
    if (rows.length) await writeBatchLog(rows);
    setBusyAll(null);
  }

  async function writeBatchLog(rows: ReportRow[]) {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { profile } = await getProfile();
      await supabase.from("insertion_history").insert({
        user_id: user.id,
        run_by: profile.display_name || user.email || "",
        website: `Batch · ${rows.length} docs`, anchor: `${rows.length} orders`,
        target_url: "", page_url: "", index_status: "batch", doc_url: null,
        details: rows,
      });
      setLogMsg(`Saved 1 batch log with ${rows.length} docs to the Insertion Log.`);
    } catch { /* non-critical */ }
  }

  function exportReport() {
    if (!report.length) return;
    const header = ["Website", "Anchor", "Target URL", "Chosen Page", "Index Status", "Doc URL"];
    const csv = [header, ...report.map((r) => [r.website, r.anchor, r.targetUrl, r.page, r.indexStatus, r.docUrl])]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `insertion-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const readyCount = orders.filter((o) => o.articlePage.trim() || o.chosen).length;

  return (
    <div>
      <header className="mb-8">
        <div className="eyebrow">Placement</div>
        <h1 className="text-3xl mt-1">Link Insertion Finder</h1>
        <p className="text-[var(--muted)] text-sm mt-2 max-w-2xl">
          Import orders (website, anchor, target URL, optional instruction, optional client page).
          Find pages or use a client-provided page, then generate Google Docs and export a report.
        </p>
      </header>

      {/* Bulk paste / import */}
      <div className="card p-5 mb-6">
        <label className="eyebrow">Paste from spreadsheet — website, anchor, target URL, [instruction], [client article page]</label>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4}
          placeholder={"publisher.com\tbest crypto wallets\thttps://client.com/wallets\tprefer recent\thttps://publisher.com/exact-page"}
          className="input w-full px-4 py-3 text-sm mono resize-y mt-1.5" />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={loadFromPaste} disabled={!paste.trim()} className="btn-primary px-4 py-2 text-sm">Load orders</button>
          <label className="btn-ghost px-3 py-2 text-sm cursor-pointer">Import CSV/TSV<input type="file" accept=".csv,.tsv,.txt" onChange={importFile} className="hidden" /></label>
          <button onClick={() => setOrders((p) => [...p, newOrder()])} className="btn-ghost px-3 py-2 text-sm">+ Add row</button>
          <span className="text-xs text-[var(--muted)] ml-auto mono">{orders.length} order(s)</span>
        </div>
      </div>

      {/* Batch actions */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button onClick={findAll} disabled={!!busyAll} className="btn-primary px-4 py-2 text-sm">Find all pages</button>
        <button onClick={generateAll} disabled={!!busyAll || readyCount === 0} className="btn-primary px-4 py-2 text-sm">Generate all docs ({readyCount})</button>
        <button onClick={exportReport} disabled={!report.length} className="btn-ghost px-4 py-2 text-sm">Export report ({report.length})</button>
        {busyAll && <span className="text-xs text-[var(--accent-strong)] mono ml-2">{busyAll}</span>}
        {logMsg && <span className="text-xs text-[var(--positive)] mono ml-2">{logMsg}</span>}
      </div>

      {/* Orders */}
      <div className="space-y-4">
        {orders.map((order, i) => {
          const hasClientPage = !!order.articlePage.trim();
          return (
            <div key={order.id} className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="pill pill-amber mono">#{i + 1}</span>
                {order.docUrl && <a href={order.docUrl} target="_blank" rel="noreferrer" className="pill pill-pos mono">Doc ready ↗</a>}
                {orders.length > 1 && <button onClick={() => setOrders((p) => p.filter((o) => o.id !== order.id))} className="btn-ghost text-xs px-2 py-1 ml-auto">Remove</button>}
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                <input value={order.website} onChange={(e) => patch(order.id, { website: e.target.value })} placeholder="website.com" className="input px-3 py-2 text-sm mono" />
                <input value={order.anchor} onChange={(e) => patch(order.id, { anchor: e.target.value })} placeholder="anchor text" className="input px-3 py-2 text-sm" />
                <input value={order.targetUrl} onChange={(e) => patch(order.id, { targetUrl: e.target.value })} placeholder="https://client.com/target" className="input px-3 py-2 text-sm mono" />
              </div>
              <input value={order.instruction} onChange={(e) => patch(order.id, { instruction: e.target.value })} placeholder="Special instruction (optional)" className="input w-full px-3 py-2 text-sm mt-3" />
              <input value={order.articlePage} onChange={(e) => patch(order.id, { articlePage: e.target.value })} placeholder="Client-provided article page (optional) — if set, we generate the doc for this exact page" className="input w-full px-3 py-2 text-sm mono mt-3" />

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {hasClientPage ? (
                  <button onClick={() => generateDirect(order)} disabled={order.status === "generating"} className="btn-primary px-4 py-2 text-sm">
                    {order.status === "generating" ? "Generating…" : "Generate doc (client page)"}
                  </button>
                ) : (
                  <>
                    <button onClick={() => find(order)} disabled={order.status === "finding"} className="btn-primary px-4 py-2 text-sm">
                      {order.status === "finding" ? "Finding…" : "Find 4 pages"}
                    </button>
                    {order.candidates.length > 0 && (
                      <button onClick={() => runCheck(order.id, order.candidates.map((c) => c.url))} disabled={order.status === "checking"} className="btn-ghost px-3 py-2 text-sm">
                        {order.status === "checking" ? "Checking…" : "Re-check all"}
                      </button>
                    )}
                    {order.chosen && <button onClick={() => runCheck(order.id, [order.chosen!])} className="btn-ghost px-3 py-2 text-sm">Check selected</button>}
                    {order.chosen && <button onClick={() => submitIndex(order, order.chosen!)} disabled={order.status === "submitting"} className="btn-ghost px-3 py-2 text-sm">{order.status === "submitting" ? "Submitting…" : "Submit selected"}</button>}
                    {order.chosen && <button onClick={() => generate(order)} disabled={order.status === "generating"} className="btn-primary px-4 py-2 text-sm">{order.status === "generating" ? "Generating…" : "Generate Google Doc"}</button>}
                  </>
                )}
              </div>
              {order.error && <div className="text-xs text-[var(--danger)] mt-2 mono">{order.error}</div>}

              {!hasClientPage && order.candidates.length > 0 && (
                <div className="mt-4 space-y-2">
                  {order.candidates.map((c) => (
                    <label key={c.url} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${order.chosen === c.url ? "border-[var(--accent-strong)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"}`} style={order.chosen === c.url ? { background: "var(--accent-soft)" } : undefined}>
                      <input type="radio" name={`c-${order.id}`} checked={order.chosen === c.url} onChange={() => patch(order.id, { chosen: c.url })} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="pill pill-mut mono">{c.score}</span>
                          {order.index[c.url] === "indexed" && <span className="pill pill-pos mono">indexed</span>}
                          {order.index[c.url] === "not indexed" && <span className="pill pill-warn mono">not indexed</span>}
                          {c.wordCount ? <span className="pill pill-mut mono">{c.wordCount}w</span> : null}
                        </div>
                        <div className="font-medium mt-1 truncate">{c.title}</div>
                        <div className="text-xs text-[var(--muted)] mono truncate">{c.url}</div>
                        <div className="text-xs text-[var(--muted)] mt-1">{c.reason}</div>
                      </div>
                      <a href={c.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="btn-ghost text-xs px-2 py-1 shrink-0">Open</a>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
