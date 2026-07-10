"use client";

import { useState } from "react";
import { NICHES } from "@/lib/categories";

/** Searchable category combobox. Empty value = "Any category". */
export function CategorySelect({ value, onChange, placeholder = "Any category — type to search" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = NICHES.filter((n) => n.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="relative">
      <input
        value={open ? q : value}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQ(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="input w-full px-3 py-2 text-sm"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-xl">
          <button type="button" onMouseDown={() => { onChange(""); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 text-[var(--muted)]">Any category</button>
          {list.map((n) => (
            <button key={n} type="button" onMouseDown={() => { onChange(n); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value === n ? "text-[var(--accent)]" : ""}`}>{n}</button>
          ))}
          {!list.length && <div className="px-3 py-2 text-sm text-[var(--muted)]">No match</div>}
        </div>
      )}
    </div>
  );
}
