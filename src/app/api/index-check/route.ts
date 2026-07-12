import { NextRequest, NextResponse } from "next/server";
import { siAccount, siCreateCheck, siStatus, siReport, siIndexStatus, siSubmitIndex, type SearchEngine } from "@/lib/speedyindex";
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
  const gate = await requireApiRole(["admin", "order_processing"]);
  if (gate instanceof NextResponse) return gate;

  let body: { action?: string; urls?: string[]; taskId?: string; engine?: SearchEngine; source?: string };
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
        const urls = (body.urls || []).map((u) => u.trim()).filter(Boolean);
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
        const urls = [...new Set((body.urls || []).map((u) => u.trim()).filter(Boolean))];
        if (!urls.length) return NextResponse.json({ error: "No URLs provided" }, { status: 400 });
        const source = typeof body.source === "string" ? body.source : "manual";
        const submit = await siSubmitIndex(urls, engine);
        if (submit.code === 0 && submit.data.task_id) await recordTasks(urls, submit.data.task_id, source);
        return NextResponse.json(submit);
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
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
