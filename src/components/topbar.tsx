"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/avatar";
import { getProfile } from "@/lib/profile";
import type { Role } from "@/lib/roles";

interface SearchItem { key: string; label: string; sub: string; href: string; }
interface AttentionItem { key: string; label: string; sub: string; href: string; }

export function TopBar({ email, role }: { email: string; role: Role }) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [routeAccess, setRouteAccess] = useState<Record<string, Role[]> | null>(null);
  const canSearch = !!routeAccess && routeAccess["/search"]?.includes(role);
  const canInsertion = !!routeAccess && routeAccess["/insertion"]?.includes(role);

  useEffect(() => { void getProfile().then(({ profile }) => { setName(profile.display_name); setAvatar(profile.avatar); }); }, []);

  useEffect(() => {
    void supabase.from("route_access").select("route, roles").then(({ data }) => {
      const map: Record<string, Role[]> = {};
      (data ?? []).forEach((r) => { map[r.route] = r.roles as Role[]; });
      setRouteAccess(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a light pool of real, searchable + attention-worthy records once route access is known.
  useEffect(() => {
    if (!routeAccess) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const items: SearchItem[] = [];
      const attn: AttentionItem[] = [];

      if (canSearch) {
        const { data } = await supabase
          .from("search_history").select("id, domain, status, created_at")
          .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
        (data ?? []).forEach((r) => items.push({
          key: `s-${r.id}`, label: r.domain, sub: "Search", href: `/search?d=${encodeURIComponent(r.domain)}`,
        }));
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
        (data ?? [])
          .filter((r) => r.status === "empty" && new Date(r.created_at).getTime() > cutoff)
          .slice(0, 5)
          .forEach((r) => attn.push({ key: `sa-${r.id}`, label: r.domain, sub: "No posts found", href: "/history" }));
      }

      if (canInsertion) {
        const { data } = await supabase
          .from("insertion_history").select("id, website, index_status, created_at")
          .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
        (data ?? []).forEach((r) => items.push({
          key: `i-${r.id}`, label: r.website, sub: "Insertion", href: "/insertion-log",
        }));
        (data ?? [])
          .filter((r) => r.index_status && r.index_status.includes("not") && r.index_status.includes("indexed"))
          .slice(0, 5)
          .forEach((r) => attn.push({ key: `ia-${r.id}`, label: r.website, sub: "Not indexed yet", href: "/insertion-log" }));
      }

      setSearchItems(items);
      setAttention(attn);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeAccess]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return searchItems.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 8);
  }, [query, searchItems]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.querySelector("input")?.focus();
      }
    }
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", onClick); window.removeEventListener("keydown", onKey); };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="h-16 shrink-0 border-b border-[var(--border)] flex items-center gap-4 px-6 sticky top-0 bg-[var(--panel)] z-10">
      <button className="text-[var(--muted)] hover:text-[var(--text)]" aria-label="Menu">
        <MenuGlyph />
      </button>

      <div className="relative flex-1 max-w-md" ref={searchRef}>
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"><SearchGlyph /></span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Search anything…"
          className="input w-full pl-9 pr-14 py-2 text-sm"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5 mono">⌘K</kbd>
        {searchOpen && query.trim() && (
          <div className="absolute mt-1 w-full card overflow-hidden max-h-72 overflow-y-auto">
            {results.length === 0 && <div className="px-4 py-3 text-sm text-[var(--muted)]">No matches in your recent domains.</div>}
            {results.map((r) => (
              <Link key={r.key} href={r.href} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-[var(--panel-2)] border-b border-[var(--border)] last:border-0"
                onClick={() => setSearchOpen(false)}>
                <span className="mono truncate">{r.label}</span>
                <span className="text-xs text-[var(--muted)] ml-3 shrink-0">{r.sub}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="relative" ref={bellRef}>
        <button onClick={() => setBellOpen((v) => !v)} className="relative text-[var(--muted)] hover:text-[var(--text)]" aria-label="Needs attention">
          <BellGlyph />
          {attention.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--danger)] text-white text-[10px] font-semibold flex items-center justify-center">
              {attention.length}
            </span>
          )}
        </button>
        {bellOpen && (
          <div className="absolute right-0 mt-2 w-72 card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] eyebrow">Needs attention</div>
            {attention.length === 0 && <div className="px-4 py-4 text-sm text-[var(--muted)]">Nothing needs attention right now.</div>}
            {attention.map((a) => (
              <Link key={a.key} href={a.href} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-[var(--panel-2)] border-b border-[var(--border)] last:border-0"
                onClick={() => setBellOpen(false)}>
                <span className="mono truncate">{a.label}</span>
                <span className="text-xs text-[var(--warn)] ml-3 shrink-0">{a.sub}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="relative" ref={menuRef}>
        <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2">
          <Avatar avatar={avatar} name={name || email} size={32} />
          <ChevronGlyph />
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-2 w-56 card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              {name && <div className="text-sm font-medium truncate">{name}</div>}
              <div className="text-xs text-[var(--muted)] mono truncate">{email}</div>
            </div>
            <Link href="/settings" className="block px-4 py-2.5 text-sm hover:bg-[var(--panel-2)]" onClick={() => setMenuOpen(false)}>Settings</Link>
            <button onClick={signOut} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--panel-2)] text-[var(--danger)]">Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

function MenuGlyph() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>;
}
function SearchGlyph() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}
function BellGlyph() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
}
function ChevronGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--muted)]"><polyline points="6 9 12 15 18 9" /></svg>;
}
