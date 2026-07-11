"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/profile";
import { Avatar } from "@/components/avatar";

const SECTIONS: { heading: string; items: { href: string; label: string; glyph: string }[] }[] = [
  {
    heading: "Scout",
    items: [
      { href: "/", label: "Dashboard", glyph: "◧" },
      { href: "/search", label: "Single Search", glyph: "⌕" },
      { href: "/bulk", label: "Bulk Search", glyph: "≣" },
    ],
  },
  {
    heading: "Placement",
    items: [
      { href: "/insertion", label: "Link Insertion", glyph: "⤵" },
      { href: "/index-check", label: "Index & Tasks", glyph: "◉" },
    ],
  },
  {
    heading: "Workspace",
    items: [
      { href: "/history", label: "History", glyph: "◷" },
      { href: "/insertion-log", label: "Insertion Log", glyph: "✎" },
      { href: "/doc-studio", label: "Doc Studio", glyph: "▤" },
      { href: "/settings", label: "Settings", glyph: "⚙" },
    ],
  },
];

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  useEffect(() => {
    const load = () => getProfile().then(({ profile }) => { setName(profile.display_name); setAvatar(profile.avatar); });
    void load();
    window.addEventListener("profile-updated", load);
    return () => window.removeEventListener("profile-updated", load);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-60 shrink-0 border-r border-[var(--border)] flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="GUESTPOSTLINKS" className="w-8 h-8 rounded-lg object-contain" />
          <div>
            <div className="font-semibold tracking-tight text-[13px] leading-none">GUESTPOSTLINKS</div>
            <div className="eyebrow mt-1">Internal Tools</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto">
        {SECTIONS.map((section) => (
          <div key={section.heading} className="mb-4">
            <div className="eyebrow px-3 mb-1.5 opacity-70">{section.heading}</div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                      active ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.03]"
                    }`}
                    style={active ? { background: "var(--accent-soft)" } : undefined}
                  >
                    <span className="mono text-base w-4 text-center" style={active ? { color: "var(--accent)" } : undefined}>
                      {item.glyph}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-2.5 px-1 mb-2 min-w-0">
          <Avatar avatar={avatar} name={name || email} size={30} />
          <div className="min-w-0">
            {name && <div className="text-xs font-medium truncate">{name}</div>}
            <div className="mono text-[10px] text-[var(--muted)] truncate" title={email}>{email}</div>
          </div>
        </div>
        <button onClick={signOut} className="btn-ghost w-full text-xs px-3 py-2">Sign out</button>
      </div>
    </aside>
  );
}
