"use client";

import { useState } from "react";

type Mode = "copy-format" | "format" | "copy";
interface Row { input: string; status: "queued" | "working" | "done" | "error"; url?: string; name?: string; error?: string; }

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = () => rej(new Error("read failed"));
  r.readAsDataURL(file);
});

export default function DocStudioPage() {
  const [tab, setTab] = useState<"convert" | "format">("format");

  return (
    <div>
      <header className="mb-6">
        <div className="eyebrow">Workspace</div>
        <h1 className="text-3xl mt-1">Doc Studio</h1>
        <p className="text-[var(--muted)] text-sm mt-2 max-w-2xl">
          Convert Word files into Google Docs, and auto-format client docs to the house style
          (Outfit · H1 23 · H2 18 · H3 15 · body 14 · justified) using AI.
        </p>
      </header>

      <div className="inline-flex p-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] mb-6">
        {(["format", "convert"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm transition ${tab === t ? "text-[#241300]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            style={tab === t ? { background: "var(--grad)", fontWeight: 600 } : undefined}>
            {t === "format" ? "Doc Formatter" : "Word → Google Doc"}
          </button>
        ))}
      </div>

      {tab === "format" ? <Formatter /> : <Converter />}
    </div>
  );
}

/* ---------------- Doc Formatter ---------------- */
function Formatter() {
  const [mode, setMode] = useState<Mode>("copy-format");
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  function loadPaste() {
    const urls = raw.split(/[\n,]/).map((u) => u.trim()).filter((u) => /\/d\/|[?&]id=/.test(u));
    setRows(urls.map((u) => ({ input: u, status: "queued" })));
  }
  function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => setRaw(String(r.result || ""));
    r.readAsText(file);
  }

  async function run() {
    if (!rows.length) return;
    setBusy(true);
    for (let i = 0; i < rows.length; i++) {
      setRows((prev) => prev.map((x, j) => (j === i ? { ...x, status: "working" } : x)));
      try {
        const res = await fetch("/api/doc", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: mode, url: rows[i].input }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        setRows((prev) => prev.map((x, j) => (j === i ? { ...x, status: "done", url: data.url, name: data.name } : x)));
      } catch (e) {
        setRows((prev) => prev.map((x, j) => (j === i ? { ...x, status: "error", error: (e as Error).message } : x)));
      }
    }
    setBusy(false);
  }

  function exportCsv() {
    const header = ["Input URL", "Status", "Result URL", "Error"];
    const csv = [header, ...rows.map((r) => [r.input, r.status, r.url || "", r.error || ""])]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `doc-formatter-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  return (
    <>
      <div className="card p-5 mb-5">
        <label className="eyebrow">Google Doc URLs — one per line (paste, or import CSV)</label>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5}
          placeholder={"https://docs.google.com/document/d/DOC_ID_1/edit\nhttps://docs.google.com/document/d/DOC_ID_2/edit"}
          className="input w-full px-4 py-3 text-sm mono resize-y mt-1.5" />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={loadPaste} disabled={!raw.trim()} className="btn-ghost px-3 py-2 text-sm">Load list</button>
          <label className="btn-ghost px-3 py-2 text-sm cursor-pointer">Import CSV<input type="file" accept=".csv,.tsv,.txt" onChange={importCsv} className="hidden" /></label>
          <span className="text-xs text-[var(--muted)] mono ml-auto">{rows.length} doc(s)</span>
        </div>

        <div className="mt-4">
          <div className="eyebrow mb-2">Mode</div>
          <div className="flex flex-wrap gap-2">
            {([["copy-format", "Copy client doc + Format"], ["format", "Format existing doc"], ["copy", "Copy only"]] as [Mode, string][]).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-2 rounded-lg text-sm border transition ${mode === m ? "border-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}
                style={mode === m ? { background: "var(--accent-soft)" } : undefined}>{label}</button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-2">
            “Copy” duplicates the client doc into your Shared Drive (anyone-with-link editor) so the original is never touched. “Format” applies the house style with AI heading detection.
          </p>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button onClick={run} disabled={busy || !rows.length} className="btn-primary px-5 py-2.5 text-sm">{busy ? "Processing…" : "Run"}</button>
          <button onClick={exportCsv} disabled={!rows.length} className="btn-ghost px-4 py-2 text-sm">Export CSV</button>
        </div>
      </div>

      {rows.length > 0 && <ResultTable rows={rows} />}
    </>
  );
}

/* ---------------- Word → Google Doc ---------------- */
function Converter() {
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [alsoFormat, setAlsoFormat] = useState(true);
  const [busy, setBusy] = useState(false);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files || []).filter((f) => /\.docx?$/i.test(f.name)));
  }

  async function run() {
    if (!files.length) return;
    setBusy(true);
    const init: Row[] = files.map((f) => ({ input: f.name, status: "queued" }));
    setRows(init);
    for (let i = 0; i < files.length; i++) {
      setRows((prev) => prev.map((x, j) => (j === i ? { ...x, status: "working" } : x)));
      try {
        const dataBase64 = await fileToBase64(files[i]);
        const res = await fetch("/api/doc", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "convert", name: files[i].name, dataBase64 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Convert failed");
        if (alsoFormat) {
          await fetch("/api/doc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "format", url: data.url }) });
        }
        setRows((prev) => prev.map((x, j) => (j === i ? { ...x, status: "done", url: data.url, name: data.name } : x)));
      } catch (e) {
        setRows((prev) => prev.map((x, j) => (j === i ? { ...x, status: "error", error: (e as Error).message } : x)));
      }
    }
    setBusy(false);
  }

  return (
    <>
      <div className="card p-5 mb-5">
        <label className="eyebrow">Upload Word files (.docx) — single or multiple</label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="btn-ghost px-4 py-2 text-sm cursor-pointer">Choose files<input type="file" accept=".docx,.doc" multiple onChange={pick} className="hidden" /></label>
          <span className="text-xs text-[var(--muted)] mono">{files.length} file(s) selected</span>
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer ml-auto">
            <input type="checkbox" checked={alsoFormat} onChange={(e) => setAlsoFormat(e.target.checked)} />
            Auto-format after convert
          </label>
        </div>
        <div className="mt-4">
          <button onClick={run} disabled={busy || !files.length} className="btn-primary px-5 py-2.5 text-sm">{busy ? "Converting…" : "Convert to Google Docs"}</button>
        </div>
      </div>

      {rows.length > 0 && <ResultTable rows={rows} />}
    </>
  );
}

function ResultTable({ rows }: { rows: Row[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "40%" }} /><col style={{ width: "14%" }} /><col style={{ width: "46%" }} /></colgroup>
        <thead>
          <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
            <th className="px-4 py-3 eyebrow">Input</th>
            <th className="px-4 py-3 eyebrow">Status</th>
            <th className="px-4 py-3 eyebrow">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--border)] last:border-0">
              <td className="px-4 py-3 mono text-xs truncate" title={r.input}>{r.input}</td>
              <td className="px-4 py-3">
                <span className={`pill mono ${r.status === "done" ? "pill-pos" : r.status === "error" ? "pill-warn" : r.status === "working" ? "pill-amber" : "pill-mut"}`}>{r.status}</span>
              </td>
              <td className="px-4 py-3">
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="pill pill-pos mono">Open Doc ↗</a>
                  : <span className="text-[11px] mono" style={{ color: "var(--danger)" }}>{r.error || "—"}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
