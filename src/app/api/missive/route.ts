import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/api-guard";
import { searchInbox, sendBulkEmail, listMeta, findLabelIdByName, type SendResult } from "@/lib/missive";
import { createServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface Body {
  action: "meta" | "search" | "send" | "history";
  query?: string;
  emails?: string[];
  subject?: string;
  message?: string;
  fromName?: string;
  fromAddress?: string;
  organizationId?: string;
  labelName?: string;
}

export async function POST(req: NextRequest) {
  const gate = await requireApiRole("/missive");
  if (gate instanceof NextResponse) return gate;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "meta": {
        const { organizations, sharedLabels } = await listMeta();
        return NextResponse.json({ organizations, sharedLabels });
      }
      case "search": {
        if (!body.query?.trim()) return NextResponse.json({ error: "query is required" }, { status: 400 });
        const result = await searchInbox(body.query.trim());
        return NextResponse.json(result);
      }
      case "send": {
        const { emails, subject, message, fromName, fromAddress, organizationId, labelName } = body;
        if (!emails?.length || !subject || !message || !fromName || !fromAddress || !organizationId) {
          return NextResponse.json({ error: "emails, subject, message, fromName, fromAddress and organizationId are required" }, { status: 400 });
        }
        const labelId = labelName ? await findLabelIdByName(labelName) : null;
        if (labelName && !labelId) {
          return NextResponse.json({ error: `No shared label named "${labelName}" was found in this organization` }, { status: 400 });
        }
        const results = await sendBulkEmail({
          emails, subject, bodyHtml: message.replace(/\n/g, "<br>"),
          fromName, fromAddress, organizationId, labelId,
        });
        void logSends(results, subject, labelName);
        return NextResponse.json({ results });
      }
      case "history": {
        const supabase = await createServerClient();
        const { data, error } = await supabase
          .from("missive_send_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return NextResponse.json({ rows: data ?? [] });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function logSends(results: SendResult[], subject: string, labelName?: string) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: prof } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    const runBy = prof?.display_name || user.email || "";
    const rows = results.map((r) => ({
      user_id: user.id,
      run_by: runBy,
      recipient: r.email,
      subject,
      conversation_id: r.conversationId ?? null,
      label_applied: r.ok ? (labelName ?? null) : null,
      status: r.ok ? "sent" : "failed",
      error: r.error ?? null,
    }));
    await supabase.from("missive_send_log").insert(rows);
  } catch {
    /* history is non-critical */
  }
}
