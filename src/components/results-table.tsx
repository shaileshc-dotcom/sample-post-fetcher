"use client";

import { motion } from "framer-motion";
import type { Article } from "@/lib/types";

export function ResultsTable({ articles, indexMap }: { articles: Article[]; indexMap?: Record<string, string> }) {
  if (!articles.length) return null;

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
            <th className="px-4 py-3 eyebrow">Title</th>
            <th className="px-4 py-3 eyebrow">Published</th>
            <th className="px-4 py-3 eyebrow">Author</th>
            <th className="px-4 py-3 eyebrow">Words</th>
            <th className="px-4 py-3 eyebrow">Src</th>
            <th className="px-4 py-3 eyebrow">AI</th>
            <th className="px-4 py-3 eyebrow text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {articles.map((a, i) => (
            <motion.tr
              key={a.url}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]"
            >
              <td className="px-4 py-3 max-w-md">
                <div className="font-medium text-[var(--text)] truncate">{a.title}</div>
                <div className="text-xs text-[var(--muted)] truncate mono">{a.url}</div>
              </td>
              <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap mono text-xs">{fmtDate(a.publishedDate)}</td>
              <td className="px-4 py-3 text-[var(--muted)]">{a.author || "—"}</td>
              <td className="px-4 py-3 text-[var(--muted)] mono">{a.wordCount ?? "—"}</td>
              <td className="px-4 py-3">
                <span className="pill pill-mut mono">{a.method}</span>
                {indexMap?.[a.url] === "indexed" && <span className="pill pill-pos mono ml-1">idx</span>}
                {indexMap?.[a.url] === "not indexed" && <span className="pill pill-warn mono ml-1">no-idx</span>}
              </td>
              <td className="px-4 py-3">
                {a.ai ? (
                  <span className={`pill mono ${a.ai.guestPostFriendly ? "pill-pos" : "pill-mut"}`}>
                    GP {a.ai.guestPostFriendly ? "Yes" : "No"} · Q{a.ai.contentQuality}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <a href={a.url} target="_blank" rel="noreferrer" className="btn-ghost text-xs px-2 py-1 mr-2 inline-block">Open</a>
                <button onClick={() => navigator.clipboard.writeText(a.url)} className="btn-ghost text-xs px-2 py-1">Copy</button>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const t = Date.parse(d);
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
