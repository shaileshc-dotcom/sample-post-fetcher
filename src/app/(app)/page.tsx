"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/profile";
import { Avatar } from "@/components/avatar";

interface HistoryRow {
  id: string;
  domain: string;
  articles_found: number;
  duration_ms: number;
  fetch_method: string | null;
  status: string;
  created_at: string;
}

export default function Dashboard() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("search_history")
        .select("*")
        .eq("user_id", user.id)   // dashboard shows only THIS user's activity
        .order("created_at", { ascending: false })
        .limit(500);
      setRows((data as HistoryRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  useEffect(() => { void getProfile().then(({ email, profile }) => { setEmail(email); setName(profile.display_name); setAvatar(profile.avatar); }); }, []);

  const today = new Date().toDateString();
  const todays = rows.filter((r) => new Date(r.created_at).toDateString() === today).length;
  const totalArticles = rows.reduce((s, r) => s + r.articles_found, 0);
  const successRate = rows.length
    ? Math.round((rows.filter((r) => r.status === "success").length / rows.length) * 100)
    : 0;
  const avgMs = rows.length ? Math.round(rows.reduce((s, r) => s + r.duration_ms, 0) / rows.length) : 0;

  const cards = [
    { label: "Domains Scouted", value: rows.length },
    { label: "Articles Found", value: totalArticles },
    { label: "Today", value: todays },
    { label: "Success Rate", value: `${successRate}%` },
    { label: "Avg Response", value: `${avgMs}ms` },
  ];

  return (
    <div>
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Avatar avatar={avatar} name={name || email} size={52} />
          <div>
            <div className="eyebrow">Overview</div>
            <h1 className="text-3xl mt-1">{name ? `Welcome, ${name}` : "Dashboard"}</h1>
            {name && <div className="text-xs text-[var(--muted)] mono mt-1">{email}</div>}
          </div>
        </div>
        <Link href="/search" className="btn-primary px-4 py-2 text-sm">New search</Link>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className="eyebrow">{c.label}</div>
            <div className="mono text-3xl font-semibold mt-2">{loading ? "—" : c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">Recent searches</h2>
        <Link href="/history" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
          View all →
        </Link>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-3 font-medium eyebrow">Domain</th>
              <th className="px-4 py-3 font-medium eyebrow">Found</th>
              <th className="px-4 py-3 font-medium eyebrow">Method</th>
              <th className="px-4 py-3 font-medium eyebrow">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
                <td className="px-4 py-3 mono">{r.domain}</td>
                <td className="px-4 py-3 mono text-[var(--muted)]">{r.articles_found}</td>
                <td className="px-4 py-3">
                  <span className="pill pill-mut mono">{r.fetch_method || "—"}</span>
                </td>
                <td className="px-4 py-3 text-[var(--muted)] text-xs mono">
                  {new Date(r.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[var(--muted)] text-sm">
                  No searches yet. Start with a single or bulk search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
