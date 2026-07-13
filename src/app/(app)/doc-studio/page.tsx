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
  const [tab, setTab] = useState<"convert" | "format" | "html">("format");

  return (
    <div>
      <header className="mb-6">
        <div className="eyebrow">Workspace</div>
        <h1 className="text-3xl mt-1">Doc Studio</h1>
        <p className="text-[var(--muted)] text-sm mt-2 max-w-2xl">
          Convert Word files or pasted HTML into Google Docs, and auto-format client
          docs to the house style (Outfit · H1 23 · H2 18 · H3 15 · body 14 · justified) using AI.
        </p>
      </header>

      <div className="inline-flex p-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] mb-6">
        {(["format", "convert", "html"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm transition ${tab === t ? "text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            style={tab === t ? { background: "var(--grad)", fontWeight: 600 } : undefined}>
            {t === "format" ? "Doc Formatter" : t === "convert" ? "Word → Google Doc" : "HTML → Google Doc"}
          </button>
        ))}
      </div>

      {tab === "format" ? <Formatter /> : tab === "convert" ? <Converter /> : <HtmlConverter />}
    </div>
  );
}

/* ---------------- HTML → Google Doc ---------------- */
function HtmlConverter() {
  const [html, setHtml] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/doc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert-html", html, name: name || "Untitled" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Convert failed");
      setResult({ url: data.url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <label className="eyebrow">Doc title</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Guest Post — Example Site"
        className="input w-full px-4 py-2.5 text-sm mt-1.5 mb-4" />

      <label className="eyebrow">Paste HTML</label>
      <textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={12}
        placeholder="<h1>Title</h1>&#10;<p>Paragraph with <b>bold</b> and <a href=&quot;...&quot;>a link</a>.</p>&#10;<ul><li>List item</li></ul>"
        className="input w-full px-4 py-3 text-sm mono resize-y mt-1.5" />
      <p className="text-[11px] text-[var(--muted)] mt-2">
        Headings, lists, tables, links, and bold/italic are preserved by Google Drive&apos;s import,
        then the house style is applied automatically — same as the other tabs.
      </p>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={run} disabled={busy || !html.trim()} className="btn-primary px-5 py-2.5 text-sm">
          {busy ? "Converting…" : "Convert to Google Doc"}
        </button>
        {result && <a href={result.url} target="_blank" rel="noreferrer" className="pill pill-pos mono">Open Doc ↗</a>}
        {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
      </div>
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
                className={`px-3 py-2 rounded-lg text-sm border transition ${mode === m ? "border-[var(--accent-strong)]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}
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
  const [dragOver, setDragOver] = useState(false);

  function addFiles(list: FileList | File[]) {
    const next = Array.from(list).filter((f) => /\.docx?$/i.test(f.name));
    setFiles((prev) => [...prev, ...next]);
  }
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  function exportCsv() {
    const header = ["Source Filename", "Google Doc URL", "Status"];
    const csv = [header, ...rows.map((r) => [r.name || r.input, r.url || "", r.status])]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `word-to-doc-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
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
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`mt-2 rounded-xl border-2 border-dashed p-6 text-center transition ${dragOver ? "border-[var(--accent-strong)] bg-[var(--accent-soft)]" : "border-[var(--border)]"}`}
        >
          <p className="text-sm text-[var(--muted)] mb-2">Drag &amp; drop .docx files here, or</p>
          <label className="btn-ghost px-4 py-2 text-sm cursor-pointer inline-block">
            Choose files<input type="file" accept=".docx,.doc" multiple onChange={pick} className="hidden" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--muted)] mono">{files.length} file(s) selected</span>
          {files.length > 0 && (
            <button onClick={() => setFiles([])} className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline">clear</button>
          )}
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer ml-auto">
            <input type="checkbox" checked={alsoFormat} onChange={(e) => setAlsoFormat(e.target.checked)} />
            Auto-format after convert
          </label>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button onClick={run} disabled={busy || !files.length} className="btn-primary px-5 py-2.5 text-sm">{busy ? "Converting…" : "Convert to Google Docs"}</button>
          <button onClick={exportCsv} disabled={!rows.length} className="btn-ghost px-4 py-2 text-sm">Export CSV</button>
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
