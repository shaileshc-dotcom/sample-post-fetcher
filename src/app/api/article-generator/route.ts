import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/api-guard";
import { generateArticle, type ArticleInputs } from "@/lib/article-generator";
import { convertHtmlToDoc, formatDoc, getDocParagraphs } from "@/lib/google-formatter";
import { classifyParagraphs } from "@/lib/ai/classify";
import { createServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface Body {
  action: "generate" | "export";
  templateContent?: string;
  templateName?: string;
  inputs?: ArticleInputs;
  referenceContent?: string;
  html?: string;
  topic?: string;
}

export async function POST(req: NextRequest) {
  const gate = await requireApiRole("/article-generator");
  if (gate instanceof NextResponse) return gate;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.action === "generate") {
      if (!body.templateContent || !body.inputs?.topic) {
        return NextResponse.json({ error: "templateContent and inputs.topic are required" }, { status: 400 });
      }
      const html = await generateArticle(body.templateContent, body.inputs, body.referenceContent);
      return NextResponse.json({ html });
    }

    if (body.action === "export") {
      if (!body.html?.trim() || !body.topic) {
        return NextResponse.json({ error: "html and topic are required" }, { status: 400 });
      }
      const doc = await convertHtmlToDoc(body.html, body.topic);
      const paras = await getDocParagraphs(doc.id);
      const levels = await classifyParagraphs(paras);
      await formatDoc(doc.id, levels);

      const supabase = await createServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
        await supabase.from("article_generations").insert({
          user_id: user.id,
          run_by: prof?.display_name || user.email || "",
          template_name: body.templateName || null,
          topic: body.topic,
          content: body.html,
          doc_url: doc.url,
        });
      }
      return NextResponse.json({ url: doc.url });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
