import { NextRequest, NextResponse } from "next/server";
import { fetchArticleMeta } from "@/lib/fetchers/article-meta";
import { fetchPageParagraphs } from "@/lib/fetchers/page-content";
import { composeInsertion } from "@/lib/ai/enrich";
import { createInsertionDoc } from "@/lib/google-docs";
import { siSubmitIndex } from "@/lib/speedyindex";
import { createServerClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/api-guard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface Body {
  pageUrl: string;
  anchor: string;
  targetUrl: string;
  prompt?: string;
  instruction?: string;
  website?: string;
  indexStatus?: "indexed" | "not indexed" | "unknown";
  docTitle?: string;
  logMode?: "single" | "skip";
  autoSubmit?: boolean;
}

export async function POST(req: NextRequest) {
  const gate = await requireApiRole(["admin", "order_processing"]);
  if (gate instanceof NextResponse) return gate;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { pageUrl, anchor, targetUrl, prompt = "", instruction = "", website = "", indexStatus = "unknown", docTitle, logMode = "single", autoSubmit = false } = body;
  if (!pageUrl || !anchor || !targetUrl) {
    return NextResponse.json({ error: "pageUrl, anchor and targetUrl are required" }, { status: 400 });
  }

  try {
    // 1) Context for the passage.
    const meta = await fetchArticleMeta(pageUrl, "sitemap");
    const paragraphs = await fetchPageParagraphs(pageUrl);
    const passage = await composeInsertion(meta.title || pageUrl, paragraphs, anchor, targetUrl, instruction || prompt);

    // 2) If the page is not indexed, submit it to SpeedyIndex and log a task.
    let submittedForIndexing = false;
    let indexTaskId: string | null = null;
    if (autoSubmit && indexStatus === "not indexed") {
      const submit = await siSubmitIndex([pageUrl]);
      if (submit.code === 0 && submit.data.task_id) {
        submittedForIndexing = true;
        indexTaskId = submit.data.task_id;
        await recordIndexTask(pageUrl, indexTaskId);
      }
    }

    // 3) Build the Google Doc.
    const docUrl = await createInsertionDoc(
      {
        pageUrl,
        indexStatus: submittedForIndexing ? "not indexed → submitted for indexing" : indexStatus,
        paragraph: passage.paragraph,
        insertedSentence: passage.insertedSentence,
        anchor,
        targetUrl,
      },
      docTitle || `Link Insertion — ${anchor}`
    );

    if (logMode !== "skip") await recordInsertion(website, anchor, targetUrl, pageUrl, submittedForIndexing ? "not indexed → submitted" : indexStatus, docUrl);

    return NextResponse.json({ docUrl, submittedForIndexing, indexTaskId }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function recordIndexTask(url: string, taskId: string) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("index_tasks").delete().eq("user_id", user.id).eq("url", url);
    await supabase.from("index_tasks").insert({
      user_id: user.id,
      url,
      task_id: taskId,
      source: "insertion",
      status: "submitted",
    });
  } catch {
    /* non-critical */
  }
}

async function recordInsertion(website: string, anchor: string, targetUrl: string, pageUrl: string, indexStatus: string, docUrl: string) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: prof } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    const runBy = prof?.display_name || user.email || "";
    await supabase.from("insertion_history").insert({
      user_id: user.id,
      run_by: runBy,
      website: website || new URL(pageUrl).hostname,
      anchor,
      target_url: targetUrl,
      page_url: pageUrl,
      index_status: indexStatus,
      doc_url: docUrl,
    });
  } catch {
    /* non-critical */
  }
}
