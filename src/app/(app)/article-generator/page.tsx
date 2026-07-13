"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Template { id: string; name: string; content: string; }
interface Reference { template_id: string; content: string; }
type Length = "short" | "medium" | "long";

export default function ArticleGeneratorPage() {
  const supabase = createClient();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState("");
  const [length, setLength] = useState<Length>("medium");
  const [targetUrl, setTargetUrl] = useState("");
  const [anchor, setAnchor] = useState("");

  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [html, setHtml] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.from("prompt_templates").select("id, name, content").order("created_at", { ascending: false })
      .then(({ data }) => { setTemplates((data as Template[]) ?? []); if (data?.[0]) setTemplateId(data[0].id); });
    void supabase.from("prompt_template_references").select("template_id, content")
      .then(({ data }) => setReferences((data as Reference[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const referenceContent = references.filter((r) => r.template_id === templateId).map((r) => r.content).join("\n\n---\n\n");

  async function generate() {
    if (!selectedTemplate || !topic.trim()) return;
    setGenerating(true); setError(null); setHtml(""); setDocUrl("");
    try {
      const res = await fetch("/api/article-generator", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate", templateContent: selectedTemplate.content,
          inputs: { topic, keywords, tone, length, targetUrl: targetUrl || undefined, anchor: anchor || undefined },
          referenceContent: referenceContent || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setHtml(data.html);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function exportToDoc() {
    setExporting(true); setError(null);
    try {
      const res = await fetch("/api/article-generator", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export", html, topic, templateName: selectedTemplate?.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");
      setDocUrl(data.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <div className="eyebrow">SEO</div>
        <h1 className="text-3xl mt-1">Article Generator</h1>
        <p className="text-[var(--muted)] text-sm mt-2 max-w-2xl">
          Pick a house prompt template (managed by admins in Team &amp; Access), fill in the brief,
          generate a draft, then export straight to a formatted Google Doc.
        </p>
      </header>

      {templates.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="eyebrow mb-2">No templates yet</div>
          <p className="text-sm text-[var(--muted)]">An admin needs to upload a prompt template in Team &amp; Access first.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card p-5">
            <label className="eyebrow">Template</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="input w-full px-3 py-2 text-sm mt-1">
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="text-[11px] text-[var(--muted)] mt-1 mb-3 h-3">
              {referenceContent && `Uses ${references.filter((r) => r.template_id === templateId).length} attached reference${references.filter((r) => r.template_id === templateId).length === 1 ? "" : "s"} for style/content guidance.`}
            </p>

            <label className="eyebrow">Topic</label>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Best project management tools for remote teams"
              className="input w-full px-3 py-2 text-sm mt-1 mb-3" />

            <label className="eyebrow">Target keywords</label>
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="project management, remote teams"
              className="input w-full px-3 py-2 text-sm mt-1 mb-3" />

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="eyebrow">Tone</label>
                <input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Conversational" className="input w-full px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="eyebrow">Length</label>
                <select value={length} onChange={(e) => setLength(e.target.value as Length)} className="input w-full px-3 py-2 text-sm mt-1">
                  <option value="short">Short (~600w)</option>
                  <option value="medium">Medium (~1000w)</option>
                  <option value="long">Long (~1800w)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="eyebrow">Target URL (optional)</label>
                <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://client.com/page" className="input w-full px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="eyebrow">Anchor (optional)</label>
                <input value={anchor} onChange={(e) => setAnchor(e.target.value)} placeholder="best project management software" className="input w-full px-3 py-2 text-sm mt-1" />
              </div>
            </div>

            <button onClick={generate} disabled={generating || !topic.trim()} className="btn-primary px-5 py-2.5 text-sm w-full">
              {generating ? "Generating…" : "Generate article"}
            </button>
            {error && <p className="text-xs mt-3" style={{ color: "var(--danger)" }}>{error}</p>}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <label className="eyebrow">Preview (editable)</label>
              {docUrl && <a href={docUrl} target="_blank" rel="noreferrer" className="pill pill-pos mono">Open Doc ↗</a>}
            </div>
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={16}
              placeholder="Generated HTML will appear here — you can edit before exporting."
              className="input w-full px-3 py-2 text-xs mono resize-y"
            />
            <button onClick={exportToDoc} disabled={exporting || !html.trim()} className="btn-ghost px-5 py-2.5 text-sm w-full mt-3">
              {exporting ? "Exporting…" : "Export to Google Doc"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
