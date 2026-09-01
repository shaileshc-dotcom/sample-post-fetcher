import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import { siAccount, siCreateCheck, siStatus, siReport, siIndexStatus, siSubmitIndex, type SearchEngine } from "@/lib/speedyindex";
import { siteCoverage, SITE_WINDOWS } from "@/lib/serp-count";
import { createServerClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/api-guard";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Proxies SpeedyIndex so the API key never reaches the browser. The checker is
 * task-based, so the client calls: create → status (poll) → report.
 * body: { action: 'account'|'create'|'status'|'report', urls?, taskId?, engine? }
 */
export async function POST(req: NextRequest) {
  const gate = await requireApiRole("/index-check");
  if (gate instanceof NextResponse) return gate;

  let body: { action?: string; urls?: string[]; domains?: string[]; breakdown?: boolean; taskId?: string; engine?: SearchEngine; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const engine = body.engine || "google";

  try {
    switch (body.action) {
      case "account":
        return NextResponse.json(await siAccount());
      case "create": {
        const urls = (body.urls || []).map(normalizeUrl).filter(Boolean);
        if (!urls.length) return NextResponse.json({ error: "No URLs provided" }, { status: 400 });
        if (urls.length > 10000) return NextResponse.json({ error: "Max 10,000 URLs per task" }, { status: 400 });
        return NextResponse.json(await siCreateCheck(urls, engine));
      }
      case "status":
        if (!body.taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
        return NextResponse.json(await siStatus(body.taskId, engine));
      case "report":
        if (!body.taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
        return NextResponse.json(await siReport(body.taskId, engine));
      case "index-status":
        if (!body.taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
        return NextResponse.json(await siIndexStatus(body.taskId, engine));
      case "submit": {
        const urls = [...new Set((body.urls || []).map(normalizeUrl).filter(Boolean))];
        if (!urls.length) return NextResponse.json({ error: "No URLs provided" }, { status: 400 });
        const source = typeof body.source === "string" ? body.source : "manual";
        const submit = await siSubmitIndex(urls, engine);
        if (submit.code === 0 && submit.data.task_id) await recordTasks(urls, submit.data.task_id, source);
        return NextResponse.json(submit);
      }
      case "site-count": {
        // Indexed-page count per domain via SearchApi (Google SERP). No SpeedyIndex
        // credits. `breakdown` adds time-window counts (6 SearchApi credits/domain
        // instead of 1).
        const domains = [...new Set((body.domains || []).map((d) => d.trim()).filter(Boolean))];
        if (!domains.length) return NextResponse.json({ error: "No domains provided" }, { status: 400 });
        if (domains.length > 100) return NextResponse.json({ error: "Max 100 domains per run" }, { status: 400 });
        const windows = body.breakdown ? SITE_WINDOWS : (["any"] as const);
        const limit = pLimit(4);
        const coverage = await Promise.all(domains.map((d) => limit(() => siteCoverage(d, windows))));
        return NextResponse.json({ coverage });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * SpeedyIndex requires fully-qualified URLs — a bare domain (no scheme) is
 * silently dropped, leaving an "empty list" 413. Prepend https:// so pasted
 * domains like "example.com" are checked as "https://example.com/".
 */
function normalizeUrl(u: string): string {
  const t = (u || "").trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return "https://" + t.replace(/^\/+/, "");
}

async function recordTasks(urls: string[], taskId: string, source: string) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const unique = [...new Set(urls)];
    // One row per URL: clear any prior entries for these URLs, then insert fresh.
    await supabase.from("index_tasks").delete().eq("user_id", user.id).in("url", unique);
    const rows = unique.map((url) => ({ user_id: user.id, url, task_id: taskId, source, status: "submitted" }));
    await supabase.from("index_tasks").insert(rows);
  } catch {
    /* non-critical */
  }
}
