"use client";

import Link from "next/link";
import { useBulkRun } from "@/lib/bulk-run-context";

/** Rendered once at the app-shell level so it's visible regardless of which page you're on when a bulk scan finishes. */
export function BulkCompletionToast() {
  const { completedSummary, dismissCompletedSummary } = useBulkRun();
  if (!completedSummary) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 w-80 card p-4 shadow-xl" style={{ animation: "toastIn 0.25s ease both" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Bulk scan complete</div>
          <div className="text-xs text-[var(--muted)] mt-1">
            {completedSummary.total} domain{completedSummary.total === 1 ? "" : "s"} ·{" "}
            <span style={{ color: "var(--positive)" }}>{completedSummary.domainsFound} found</span>
            {" "}({completedSummary.articlesFound} article{completedSummary.articlesFound === 1 ? "" : "s"})
            {completedSummary.failed > 0 && <> · <span style={{ color: "var(--warn)" }}>{completedSummary.failed} no posts</span></>}
          </div>
        </div>
        <button onClick={dismissCompletedSummary} className="text-[var(--muted)] hover:text-[var(--text)] text-sm leading-none" aria-label="Dismiss">✕</button>
      </div>
      <Link href="/bulk" onClick={dismissCompletedSummary} className="text-xs text-[var(--accent-strong)] hover:underline mt-2 inline-block">
        View results →
      </Link>
      <style jsx global>{`
        @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
