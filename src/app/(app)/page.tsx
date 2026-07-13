"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/profile";
import { Avatar } from "@/components/avatar";
import type { Role } from "@/lib/roles";

interface HistoryRow {
  id: string;
  domain: string;
  articles_found: number;
  duration_ms: number;
  fetch_method: string | null;
  status: string;
  created_at: string;
}

interface InsertionRow {
  id: string;
  website: string;
  anchor: string;
  target_url: string;
  index_status: string | null;
  doc_url: string | null;
  created_at: string;
}

interface IndexTaskRow {
  id: string;
  url: string;
  status: string;
  created_at: string;
}

const isIndexed = (status: string | null) => !!status && status.includes("indexed") && !status.includes("not");

function last7Days(rows: { created_at: string }[]) {
  const out: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    out.push({
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: rows.filter((r) => new Date(r.created_at).toDateString() === key).length,
    });
  }
  return out;
}

const DONUT_COLORS = ["#047857", "#a16207", "#dc2626"];

export default function Dashboard() {
  const [role, setRole] = useState<Role | null>(null);
  const [routeAccess, setRouteAccess] = useState<Record<string, Role[]>>({});
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [insertions, setInsertions] = useState<InsertionRow[]>([]);
  const [indexTasks, setIndexTasks] = useState<IndexTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [{ data: prof }, { data: accessRows }] = await Promise.all([
        supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle(),
        supabase.from("route_access").select("route, roles"),
      ]);
      const myRole = (prof?.role as Role) ?? "content";
      setRole(myRole);
      const accessMap: Record<string, Role[]> = {};
      (accessRows ?? []).forEach((r) => { accessMap[r.route] = r.roles as Role[]; });
      setRouteAccess(accessMap);

      const wantsSearch = accessMap["/search"]?.includes(myRole) ?? false;
      const wantsInsertion = accessMap["/insertion"]?.includes(myRole) ?? false;
      const wantsIndexCheck = accessMap["/index-check"]?.includes(myRole) ?? false;

      const [searchRes, insertionRes, indexRes] = await Promise.all([
        wantsSearch
          ? supabase.from("search_history").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500)
          : Promise.resolve({ data: [] as HistoryRow[] }),
        wantsInsertion
          ? supabase.from("insertion_history").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500)
          : Promise.resolve({ data: [] as InsertionRow[] }),
        wantsIndexCheck
          ? supabase.from("index_tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500)
          : Promise.resolve({ data: [] as IndexTaskRow[] }),
      ]);

      setRows((searchRes.data as HistoryRow[]) ?? []);
      setInsertions((insertionRes.data as InsertionRow[]) ?? []);
      setIndexTasks((indexRes.data as IndexTaskRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  useEffect(() => { void getProfile().then(({ email, profile }) => { setEmail(email); setName(profile.display_name); setAvatar(profile.avatar); }); }, []);

  const today = new Date().toDateString();

  const showSearch = !!role && (routeAccess["/search"]?.includes(role) ?? false);
  const showInsertion = !!role && (routeAccess["/insertion"]?.includes(role) ?? false);
  const showIndexCheck = !!role && (routeAccess["/index-check"]?.includes(role) ?? false);
  const showSeoPlaceholder = role === "seo";

  const todaysSearches = rows.filter((r) => new Date(r.created_at).toDateString() === today).length;
  const totalArticles = rows.reduce((s, r) => s + r.articles_found, 0);
  const successRate = rows.length
    ? Math.round((rows.filter((r) => r.status === "success").length / rows.length) * 100)
    : 0;
  const avgMs = rows.length ? Math.round(rows.reduce((s, r) => s + r.duration_ms, 0) / rows.length) : 0;

  const searchCards = [
    { label: "Domains Scouted", value: rows.length },
    { label: "Articles Found", value: totalArticles },
    { label: "Today", value: todaysSearches },
    { label: "Success Rate", value: `${successRate}%` },
    { label: "Avg Response", value: `${avgMs}ms` },
  ];

  const searchSeries = useMemo(() => last7Days(rows), [rows]);
  const searchDonut = useMemo(() => {
    const success = rows.filter((r) => r.status === "success").length;
    const empty = rows.filter((r) => r.status === "empty").length;
    const other = rows.length - success - empty;
    return [
      { name: "Found posts", value: success },
      { name: "No posts found", value: empty },
      ...(other > 0 ? [{ name: "Other", value: other }] : []),
    ].filter((d) => d.value > 0);
  }, [rows]);

  const methodBars = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((r) => {
      const m = r.fetch_method || "unknown";
      counts.set(m, (counts.get(m) ?? 0) + 1);
    });
    const total = rows.length || 1;
    return [...counts.entries()]
      .map(([method, count]) => ({ method, count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [rows]);

  const indexedInsertions = insertions.filter((i) => isIndexed(i.index_status)).length;
  const todaysInsertions = insertions.filter((i) => new Date(i.created_at).toDateString() === today).length;
  const insertionCards = [
    { label: "Links Inserted", value: insertions.length },
    { label: "Indexed", value: indexedInsertions },
    { label: "Today", value: todaysInsertions },
  ];
  const insertionSeries = useMemo(() => last7Days(insertions), [insertions]);
  const insertionDonut = useMemo(() => {
    const indexed = insertions.filter((i) => isIndexed(i.index_status)).length;
    const pending = insertions.length - indexed;
    return [
      { name: "Indexed", value: indexed },
      { name: "Pending / not indexed", value: pending },
    ].filter((d) => d.value > 0);
  }, [insertions]);

  const indexedTasks = indexTasks.filter((t) => t.status === "indexed").length;
  const notIndexedTasks = indexTasks.filter((t) => t.status === "not_indexed").length;
  const pendingTasks = indexTasks.filter((t) => t.status === "submitted").length;
  const indexCards = [
    { label: "URLs Tracked", value: indexTasks.length },
    { label: "Indexed", value: indexedTasks },
    { label: "Not Indexed", value: notIndexedTasks },
    { label: "Pending", value: pendingTasks },
  ];

  const primaryCta = showSearch
    ? { href: "/search", label: "New search" }
    : showInsertion
      ? { href: "/insertion", label: "New insertion" }
      : { href: "/doc-studio", label: "Open Doc Studio" };

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
        <Link href={primaryCta.href} className="btn-primary px-4 py-2 text-sm">{primaryCta.label}</Link>
      </header>

      {showSearch && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {searchCards.map((c) => (
              <div key={c.label} className="card p-4">
                <div className="eyebrow">{c.label}</div>
                <div className="mono text-3xl font-semibold mt-2">{loading ? "—" : c.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-10">
            <div className="card p-4 md:col-span-1">
              <div className="text-sm font-medium mb-3">Search Activity <span className="text-xs text-[var(--muted)] font-normal">· last 7 days</span></div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={searchSeries}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Line type="monotone" dataKey="count" stroke="#c94716" strokeWidth={2.5} dot={{ r: 3, fill: "#c94716" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-4">
              <div className="text-sm font-medium mb-3">Search Outcomes</div>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={110} height={110}>
                  <PieChart>
                    <Pie data={searchDonut} dataKey="value" innerRadius={32} outerRadius={50} paddingAngle={2}>
                      {searchDonut.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 text-xs">
                  {searchDonut.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="text-[var(--muted)]">{d.name}</span>
                      <span className="mono font-medium">{d.value}</span>
                    </div>
                  ))}
                  {searchDonut.length === 0 && <span className="text-[var(--muted)]">No data yet</span>}
                </div>
              </div>
            </div>

            <div className="card p-4">
              <div className="text-sm font-medium mb-3">Top Methods</div>
              <div className="space-y-2.5">
                {methodBars.map((m) => (
                  <div key={m.method}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="mono">{m.method}</span>
                      <span className="text-[var(--muted)]">{m.count} ({m.pct}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--panel-2)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: "var(--grad)" }} />
                    </div>
                  </div>
                ))}
                {methodBars.length === 0 && <span className="text-xs text-[var(--muted)]">No data yet</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Recent searches</h2>
            <Link href="/history" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
              View all →
            </Link>
          </div>

          <div className="card overflow-hidden mb-10">
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
        </>
      )}

      {showIndexCheck && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {indexCards.map((c) => (
            <div key={c.label} className="card p-4">
              <div className="eyebrow">{c.label}</div>
              <div className="mono text-3xl font-semibold mt-2">{loading ? "—" : c.value}</div>
            </div>
          ))}
        </div>
      )}

      {showInsertion && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {insertionCards.map((c) => (
              <div key={c.label} className="card p-4">
                <div className="eyebrow">{c.label}</div>
                <div className="mono text-3xl font-semibold mt-2">{loading ? "—" : c.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
            <div className="card p-4">
              <div className="text-sm font-medium mb-3">Insertion Activity <span className="text-xs text-[var(--muted)] font-normal">· last 7 days</span></div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={insertionSeries}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Line type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3, fill: "#4f46e5" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-4">
              <div className="text-sm font-medium mb-3">Index Status</div>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={110} height={110}>
                  <PieChart>
                    <Pie data={insertionDonut} dataKey="value" innerRadius={32} outerRadius={50} paddingAngle={2}>
                      {insertionDonut.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 text-xs">
                  {insertionDonut.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="text-[var(--muted)]">{d.name}</span>
                      <span className="mono font-medium">{d.value}</span>
                    </div>
                  ))}
                  {insertionDonut.length === 0 && <span className="text-[var(--muted)]">No data yet</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Recent insertions</h2>
            <Link href="/insertion-log" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
              View all →
            </Link>
          </div>

          <div className="card overflow-hidden mb-10">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="px-4 py-3 font-medium eyebrow">Website</th>
                  <th className="px-4 py-3 font-medium eyebrow">Anchor</th>
                  <th className="px-4 py-3 font-medium eyebrow">Index status</th>
                  <th className="px-4 py-3 font-medium eyebrow">When</th>
                </tr>
              </thead>
              <tbody>
                {insertions.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
                    <td className="px-4 py-3 mono">{r.website}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{r.anchor}</td>
                    <td className="px-4 py-3">
                      <span className={`pill mono ${isIndexed(r.index_status) ? "pill-pos" : "pill-warn"}`}>
                        {r.index_status || "unknown"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs mono">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {!loading && insertions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-[var(--muted)] text-sm">
                      No insertions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showSeoPlaceholder && (
        <div className="card p-8 text-center">
          <div className="eyebrow mb-2">Coming soon</div>
          <h2 className="text-lg font-medium mb-2">Article Generator &amp; Backlink Monitor</h2>
          <p className="text-sm text-[var(--muted)] max-w-md mx-auto">
            These SEO tools aren&apos;t built yet — this dashboard will show your
            article generations and live/404 backlink status once they ship.
            In the meantime, Doc Studio is available from the sidebar.
          </p>
        </div>
      )}
    </div>
  );
}
