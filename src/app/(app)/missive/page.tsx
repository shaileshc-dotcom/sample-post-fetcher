"use client";

import { useEffect, useMemo, useState } from "react";
import { DATE_PRESETS } from "@/lib/categories";

interface Conversation {
  id: string;
  subject: string | null;
  latest_message_subject: string | null;
  last_activity_at: number;
  users?: { name?: string; email?: string }[];
}
interface SearchResult { conversation: Conversation; matchedIn: "subject" | "preview"; }
interface Org { id: string; name: string; }
interface SharedLabel { id: string; name: string; organization: string; }
interface SendResult { email: string; ok: boolean; error?: string; conversationId?: string; }
interface SendLogRow {
  id: string;
  run_by: string | null;
  recipient: string;
  subject: string;
  conversation_id: string | null;
  label_applied: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

// Missive's own web-app conversation URL scheme — not returned by the API,
// so this is the standard pattern, not a value confirmed by the docs.
const missiveUrl = (id: string) => `https://mail.missiveapp.com/#inbox/conversations/${id}`;

export default function MissivePage() {
  const [tab, setTab] = useState<"search" | "send" | "history">("search");
  return (
    <div>
      <header className="mb-6">
        <div className="eyebrow">Order Processing</div>
        <h1 className="text-3xl mt-1">Missive</h1>
      </header>

      <div className="inline-flex p-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] mb-6">
        {(["search", "send", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm transition ${tab === t ? "text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            style={tab === t ? { background: "var(--grad)", fontWeight: 600 } : undefined}>
            {t === "search" ? "Missive Search" : t === "send" ? "Send Email" : "Send History"}
          </button>
        ))}
      </div>

      {tab === "search" ? <MissiveSearch /> : tab === "send" ? <SendEmail /> : <SendHistory />}
    </div>
  );
}

type SendStatusFilter = "all" | "sent" | "failed";

function SendHistory() {
  const [rows, setRows] = useState<SendLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sinceDays, setSinceDays] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SendStatusFilter>("all");

  useEffect(() => {
    void fetch("/api/missive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "history" }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed to load history");
        setRows(d.rows || []);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const cutoff = sinceDays ? Date.now() - sinceDays * 86400000 : null;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (cutoff && new Date(r.created_at).getTime() < cutoff) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !r.recipient.toLowerCase().includes(q) && !r.subject.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, sinceDays, query, statusFilter]);

  return (
    <div>
      {error && <div className="rounded-xl border border-[var(--danger)]/30 text-[var(--danger)] text-sm px-4 py-3 mb-5">{error}</div>}
      {!rows && !error && <div className="text-sm text-[var(--muted)]">Loading…</div>}
      {rows && (
        <>
        <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
          <div>
            <div className="eyebrow mb-1">Sent</div>
            <select value={sinceDays} onChange={(e) => setSinceDays(Number(e.target.value))} className="input px-3 py-2 text-sm">
              {DATE_PRESETS.map((d) => (<option key={d.label} value={d.days}>{d.label}</option>))}
            </select>
          </div>
          <div>
            <div className="eyebrow mb-1">Recipient / subject</div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. jane@publisher.com" className="input px-3 py-2 text-sm w-56" />
          </div>
          <div>
            <div className="eyebrow mb-1">Status</div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SendStatusFilter)} className="input px-3 py-2 text-sm">
              <option value="all">All</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="ml-auto text-xs text-[var(--muted)]">{filtered.length} of {rows.length}</div>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                <th className="px-4 py-3 eyebrow">Recipient</th>
                <th className="px-4 py-3 eyebrow">Subject</th>
                <th className="px-4 py-3 eyebrow">Label</th>
                <th className="px-4 py-3 eyebrow">Sent by</th>
                <th className="px-4 py-3 eyebrow">When</th>
                <th className="px-4 py-3 eyebrow">Status</th>
                <th className="px-4 py-3 eyebrow text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
                  <td className="px-4 py-3 mono text-xs">{r.recipient}</td>
                  <td className="px-4 py-3 truncate max-w-xs">{r.subject}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{r.label_applied || "—"}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{r.run_by || "—"}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)] mono">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={r.status === "sent" ? "pill pill-pos" : "pill pill-neg"} title={r.error || undefined}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.conversation_id && (
                      <a href={missiveUrl(r.conversation_id)} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent-strong)] hover:underline">Open ↗</a>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--muted)] text-sm">
                  {rows.length === 0 ? "No sends yet." : "No sends match the current filters."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

function MissiveSearch() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [exhaustive, setExhaustive] = useState(true);

  async function run() {
    if (!query.trim()) return;
    setBusy(true); setError(null); setResults(null);
    try {
      const res = await fetch("/api/missive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results); setScanned(data.scanned); setExhaustive(data.exhaustive);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card p-5 mb-5">
        <label className="eyebrow">Search for an exact email address, word, or phrase</label>
        <div className="flex gap-2 mt-1.5">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="e.g. jane@publisher.com  or  guest post rate" className="input flex-1 px-4 py-2.5 text-sm" />
          <button onClick={run} disabled={busy || !query.trim()} className="btn-primary px-5 py-2.5 text-sm">{busy ? "Searching…" : "Search"}</button>
        </div>
        <p className="text-[11px] text-[var(--muted)] mt-2">
          An exact email address uses Missive&apos;s contact filter (covers your whole inbox history).
          A word or phrase scans the most recent {scanned || "~100"} conversations&apos; subjects and message
          previews — Missive&apos;s API has no full-text search endpoint, so this isn&apos;t exhaustive
          against full message bodies or very old mail.
        </p>
      </div>

      {error && <div className="rounded-xl border border-[var(--danger)]/30 text-[var(--danger)] text-sm px-4 py-3 mb-5">{error}</div>}

      {results && (
        <>
          <div className="text-xs text-[var(--muted)] mb-3">
            {results.length} match{results.length === 1 ? "" : "es"} · scanned {scanned} conversation{scanned === 1 ? "" : "s"}
            {!exhaustive && " · more recent conversations weren't scanned (raise the cap in code if needed)"}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="px-4 py-3 eyebrow">Subject</th>
                  <th className="px-4 py-3 eyebrow">Participants</th>
                  <th className="px-4 py-3 eyebrow">Date</th>
                  <th className="px-4 py-3 eyebrow">Matched</th>
                  <th className="px-4 py-3 eyebrow text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {results.map(({ conversation: c, matchedIn }) => (
                  <tr key={c.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
                    <td className="px-4 py-3 truncate max-w-xs">{c.subject || c.latest_message_subject || "(no subject)"}</td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)] truncate max-w-xs">
                      {(c.users || []).map((u) => u.email || u.name).filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)] mono">{new Date(c.last_activity_at * 1000).toLocaleString()}</td>
                    <td className="px-4 py-3"><span className="pill pill-mut mono">{matchedIn}</span></td>
                    <td className="px-4 py-3 text-right">
                      <a href={missiveUrl(c.id)} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent-strong)] hover:underline">Open ↗</a>
                    </td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-[var(--muted)] text-sm">No matches.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SendEmail() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [labels, setLabels] = useState<SharedLabel[]>([]);
  const [emails, setEmails] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [labelName, setLabelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [results, setResults] = useState<SendResult[] | null>(null);

  useEffect(() => {
    void fetch("/api/missive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "meta" }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed to load organizations/labels");
        setOrgs(d.organizations || []);
        if (d.organizations?.[0]) setOrganizationId(d.organizations[0].id);
        setLabels(d.sharedLabels || []);
        const vendor = (d.sharedLabels || []).find((l: SharedLabel) => l.name.toLowerCase() === "vendor response");
        setLabelName(vendor?.name || d.sharedLabels?.[0]?.name || "");
      })
      .catch((e) => setMetaError((e as Error).message));
  }, []);

  const recipientList = emails.split(/[\n,]/).map((e) => e.trim()).filter(Boolean);

  async function send() {
    setBusy(true); setError(null); setResults(null);
    try {
      const res = await fetch("/api/missive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send", emails: recipientList, subject, message,
          fromName, fromAddress, organizationId, labelName: labelName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setResults(data.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 max-w-2xl">
      <p className="text-xs text-[var(--muted)] mb-4">
        Sends one <span className="font-medium">separate</span> email per recipient (not one email with
        everyone in To) and applies the shared label below to each. This sends real email — double-check
        the recipient list before hitting send.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="eyebrow">From name</label>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="GUESTPOSTLINKS Team" className="input w-full px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label className="eyebrow">From address</label>
          <input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="team@guestpostlinks.com" className="input w-full px-3 py-2 text-sm mt-1" />
        </div>
      </div>
      <p className="text-[11px] text-[var(--muted)] mb-3">
        Must be an alias already configured under Missive → Settings → Accounts → Aliases for this
        connected account (and verified on that mailbox&apos;s email server) — Missive has no API to
        look these up, so a typo or unconfigured address will fail with a 400 at send time.
      </p>

      {metaError && (
        <div className="rounded-xl border border-[var(--danger)]/30 text-[var(--danger)] text-xs px-3 py-2 mb-3">
          Couldn&apos;t load organizations/labels from Missive: {metaError}. You can still paste an
          organization ID directly below (find it in Missive under Settings → API → Resource IDs).
        </div>
      )}

      <label className="eyebrow">Organization</label>
      {orgs.length > 0 ? (
        <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className="input w-full px-3 py-2 text-sm mt-1 mb-3">
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      ) : (
        <input value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}
          placeholder="Paste organization ID (Settings → API → Resource IDs)"
          className="input w-full px-3 py-2 text-sm mono mt-1 mb-3" />
      )}

      <label className="eyebrow">Recipients — one per line or comma-separated</label>
      <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={4}
        placeholder={"jane@publisher.com\njohn@site.com"} className="input w-full px-3 py-2 text-sm mono resize-y mt-1 mb-3" />
      <div className="text-xs text-[var(--muted)] mb-3">{recipientList.length} recipient(s)</div>

      <label className="eyebrow">Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input w-full px-3 py-2 text-sm mt-1 mb-3" />

      <label className="eyebrow">Message</label>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className="input w-full px-3 py-2 text-sm resize-y mt-1 mb-3" />

      <label className="eyebrow">Apply shared label</label>
      <select value={labelName} onChange={(e) => setLabelName(e.target.value)} className="input w-full px-3 py-2 text-sm mt-1 mb-4">
        <option value="">No label</option>
        {labels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
      </select>

      <button onClick={send} disabled={busy || !recipientList.length || !subject || !message || !fromName || !fromAddress || !organizationId}
        className="btn-primary px-5 py-2.5 text-sm">
        {busy ? "Sending…" : `Send to ${recipientList.length} recipient(s)`}
      </button>

      {error && <p className="text-xs mt-3" style={{ color: "var(--danger)" }}>{error}</p>}

      {results && (
        <div className="mt-4 space-y-1.5">
          {results.map((r) => (
            <div key={r.email} className="flex items-center justify-between text-xs">
              <span className="mono">{r.email}</span>
              <span className={r.ok ? "text-[var(--positive)]" : "text-[var(--danger)]"}>{r.ok ? "sent" : r.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
