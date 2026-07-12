"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ResultsTable } from "@/components/results-table";
import { CategorySelect } from "@/components/category-select";
import { DATE_PRESETS } from "@/lib/categories";
import { toDomainCSV, toArticleCSV, toMarkdown, download } from "@/lib/export";
import { getSettings } from "@/lib/settings";
import { normalizeDomain } from "@/lib/http";
import { checkIndex, submitForIndexing } from "@/lib/hooks/useIndexCheck";
import type { Article, FetchResult } from "@/lib/types";

const TEMPLATES = [
  "Recently Published", "Latest News", "Trending", "Editorial", "Business",
  "Technology", "Finance", "Casino", "Crypto", "Health", "Travel", "AI",
  "Guest Posts", "Press Releases", "Product Reviews", "Evergreen",
];

function SearchInner() {
  const params = useSearchParams();
  const [domain, setDomain] = useState("");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("");
  const [enrich, setEnrich] = useState(false);
  const [sinceDays, setSinceDays] = useState<number | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [englishOnly, setEnglishOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [indexMap, setIndexMap] = useState<Record<string, string>>({});
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const run = useCallback(
    async (target?: string) => {
      const d = (target ?? domain).trim();
      if (!d) return;
      const s = getSettings();
      setLoading(true);
      setError(null);
      setResult(null);
      setIndexMap({});
      try {
        const res = await fetch("/api/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: d,
            options: {
              limit: s.postsPerDomain,
              enrichWithAI: enrich,
              enrichLimit: s.postsPerDomain,
              prompt: [category, prompt.trim()].filter(Boolean).join(". ") || undefined,
              sinceDays,
              hasImage,
              englishOnly,
            },
          }),
        });
        const data = (await res.json()) as FetchResult & { error?: string };
        if (!res.ok) throw new Error(data.error || "Fetch failed");
        setResult(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [domain, prompt, category, enrich, sinceDays, hasImage, englishOnly]
  );

  useEffect(() => {
    const s = getSettings();
    setEnrich(s.aiDefault);
    setPrompt(s.defaultPrompt);
    const d = params.get("d");
    if (d) {
      setDomain(d);
      void run(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verifyIndex() {
    if (!result?.articles.length) return;
    setVerifying(true);
    const { indexed, unindexed } = await checkIndex(result.articles.map((a) => a.url));
    const map: Record<string, string> = {};
    for (const u of indexed) map[u] = "indexed";
    for (const u of unindexed) map[u] = "not indexed";
    setIndexMap(map);
    setVerifying(false);
  }

  async function submitIndex() {
    if (!result?.articles.length) return;
    setSubmitting(true); setSubmitMsg(null);
    const r = await submitForIndexing(result.articles.map((a) => a.url), "google", "single");
    setSubmitting(false);
    setSubmitMsg(r.ok ? `Submitted ${result.articles.length} URL(s) for indexing.` : `Error: ${r.error}`);
  }

  const articles: Article[] = result?.articles ?? [];
  const group = result ? [{ domain: normalizeDomain(result.domain), articles }] : [];
  const insights = result ? buildInsights(articles) : null;

  return (
    <div>
      <header className="mb-8">
        <div className="eyebrow">Scout</div>
        <h1 className="text-3xl mt-1">Single Search</h1>
        <p className="text-[var(--muted)] text-sm mt-2">
          Enter a publisher domain. Every returned link is verified live before it&apos;s shown.
        </p>
      </header>

      <div className="card p-5 mb-6">
        <div className={`flex gap-3 rounded-xl ${loading ? "scanning" : ""}`}>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="example.com"
            className="input flex-1 px-4 py-3 text-sm mono"
          />
          <button onClick={() => run()} disabled={loading} className="btn-primary px-5 py-3 text-sm whitespace-nowrap">
            {loading ? "Scouting…" : "Fetch sample posts"}
          </button>
        </div>

        {/* Prompt box */}
        <div className="mt-4">
          <label className="eyebrow">What kind of posts?</label>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="e.g. recent finance news, no sponsored or category pages"
            className="input w-full px-4 py-2.5 text-sm mt-1.5"
          />
          <p className="text-[11px] text-[var(--muted)] mt-1.5">
            Category + prompt are used to rank and pick the most relevant posts (requires an OpenAI key on the server).
          </p>
        </div>

        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div>
            <label className="eyebrow">Category</label>
            <div className="mt-1.5"><CategorySelect value={category} onChange={setCategory} /></div>
          </div>
          <div>
            <label className="eyebrow">Date</label>
            <select
              value={sinceDays ?? 0}
              onChange={(e) => { const d = Number(e.target.value); setSinceDays(d === 0 ? null : d); }}
              className="input w-full px-3 py-2 text-sm mt-1.5"
            >
              {DATE_PRESETS.map((d) => (<option key={d.label} value={d.days}>{d.label}</option>))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-[var(--muted)]">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={hasImage} onChange={(e) => setHasImage(e.target.checked)} /> Has image
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={englishOnly} onChange={(e) => setEnglishOnly(e.target.checked)} /> English only
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} /> AI analysis
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--danger)]/30 text-[var(--danger)] text-sm px-4 py-3 mb-6" style={{ background: "rgba(220,38,38,0.08)" }}>
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-[var(--panel-2)] animate-pulse" />
          ))}
        </div>
      )}

      {result && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {insights && (
            <div className="card p-4 mb-4 text-sm text-[var(--muted)]">
              <span className="eyebrow">Snapshot</span>
              <div className="mt-1">{insights}</div>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-[var(--muted)] mono">
              <span className="text-[var(--text)] font-medium">{articles.length}</span> live ·{" "}
              {result.durationMs}ms · {result.methodUsed.join(", ") || "none"}
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost text-xs px-3 py-1.5" onClick={() => download(`${normalizeDomain(result.domain)}.csv`, toDomainCSV(group), "text/csv")}>
                Export (Domain + Posts)
              </button>
              <button className="btn-ghost text-xs px-3 py-1.5" onClick={() => download("articles.csv", toArticleCSV(articles), "text/csv")}>
                Full CSV
              </button>
              <button className="btn-ghost text-xs px-3 py-1.5" onClick={() => navigator.clipboard.writeText(toMarkdown(group))}>
                Copy MD
              </button>
              <button className="btn-ghost text-xs px-3 py-1.5" onClick={verifyIndex} disabled={verifying}>
                {verifying ? "Checking index…" : "Verify index"}
              </button>
              <button className="btn-ghost text-xs px-3 py-1.5" onClick={submitIndex} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit for indexing"}
              </button>
            </div>
          </div>

          {articles.length ? (
            <>
            {submitMsg && <p className="text-xs mono mb-2" style={{ color: submitMsg.startsWith("Error") ? "var(--danger)" : "var(--positive)" }}>{submitMsg}</p>}
            <ResultsTable articles={articles} indexMap={indexMap} />
            </>
          ) : (
            <div className="card p-8 text-center text-sm text-[var(--muted)]">
              No live articles found. Try a different template, loosen the filters, or check the domain.
              {result.errors.length > 0 && (
                <div className="mt-2 text-xs text-[var(--danger)]/70 mono">{result.errors.join(" · ")}</div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function buildInsights(articles: Article[]): string | null {
  if (!articles.length) return null;
  const counts = articles.filter((a) => a.wordCount).map((a) => a.wordCount!);
  const avg = counts.length ? Math.round(counts.reduce((s, n) => s + n, 0) / counts.length) : null;
  const niche = articles.find((a) => a.ai?.niche)?.ai?.niche;
  const analyzed = articles.filter((a) => a.ai).length;
  const gp = articles.filter((a) => a.ai?.guestPostFriendly).length;
  const parts: string[] = [];
  if (avg) parts.push(`Average length ~${avg} words.`);
  if (niche) parts.push(`Primary niche appears to be ${niche}.`);
  if (analyzed) parts.push(`${gp}/${analyzed} analyzed posts look guest-post friendly.`);
  return parts.length ? parts.join(" ") : null;
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchInner />
    </Suspense>
  );
}
