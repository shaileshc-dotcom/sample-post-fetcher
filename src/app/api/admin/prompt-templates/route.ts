import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { requireApiRole } from "@/lib/api-guard";
import { createServerClient } from "@/lib/supabase/server";
import { fetchPageParagraphs } from "@/lib/fetchers/page-content";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  action: "create" | "delete" | "update" | "add-reference" | "remove-reference";
  name?: string;
  dataBase64?: string; // .docx upload
  text?: string;       // plain-text alternative to uploading a file
  id?: string;
  // add-reference
  templateId?: string;
  kind?: "upload" | "generated" | "url";
  url?: string;
  generationId?: string;
  label?: string;
}

const MAX_REFERENCE_CHARS = 6000; // keeps a scraped/pasted reference from blowing out the generation prompt's token budget

export async function POST(req: NextRequest) {
  const gate = await requireApiRole("/admin");
  if (gate instanceof NextResponse) return gate;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = await createServerClient();

  try {
    switch (body.action) {
      case "create": {
        if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
        let content = body.text?.trim() || "";
        if (!content && body.dataBase64) {
          const buffer = Buffer.from(body.dataBase64, "base64");
          const result = await mammoth.extractRawText({ buffer });
          content = result.value.trim();
        }
        if (!content) return NextResponse.json({ error: "Provide a .docx file or paste text" }, { status: 400 });
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from("prompt_templates").insert({ name: body.name, content, created_by: user?.id });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "update": {
        if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        let content = body.text?.trim() || "";
        if (!content && body.dataBase64) {
          const buffer = Buffer.from(body.dataBase64, "base64");
          const result = await mammoth.extractRawText({ buffer });
          content = result.value.trim();
        }
        const patch: { name?: string; content?: string } = {};
        if (body.name) patch.name = body.name;
        if (content) patch.content = content;
        if (!patch.name && !patch.content) {
          return NextResponse.json({ error: "Provide a new name, a .docx file, or pasted text to update" }, { status: 400 });
        }
        const { error } = await supabase.from("prompt_templates").update(patch).eq("id", body.id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "delete": {
        if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        const { error } = await supabase.from("prompt_templates").delete().eq("id", body.id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "add-reference": {
        if (!body.templateId || !body.kind) return NextResponse.json({ error: "templateId and kind are required" }, { status: 400 });
        let content = "";
        let label = body.label || "";
        if (body.kind === "upload") {
          if (!body.dataBase64) return NextResponse.json({ error: "Provide a .docx file" }, { status: 400 });
          const buffer = Buffer.from(body.dataBase64, "base64");
          const result = await mammoth.extractRawText({ buffer });
          content = result.value.trim();
        } else if (body.kind === "generated") {
          if (!body.generationId) return NextResponse.json({ error: "generationId is required" }, { status: 400 });
          const { data: gen, error: genErr } = await supabase.from("article_generations").select("topic, content").eq("id", body.generationId).maybeSingle();
          if (genErr) throw genErr;
          if (!gen) return NextResponse.json({ error: "Generated article not found" }, { status: 404 });
          content = gen.content || "";
          label = label || gen.topic;
        } else if (body.kind === "url") {
          if (!body.url?.trim()) return NextResponse.json({ error: "url is required" }, { status: 400 });
          const paragraphs = await fetchPageParagraphs(body.url.trim(), 40);
          if (!paragraphs.length) return NextResponse.json({ error: "Couldn't extract readable text from that URL" }, { status: 400 });
          content = paragraphs.join("\n\n");
          label = label || body.url.trim();
        } else {
          return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
        }
        content = content.slice(0, MAX_REFERENCE_CHARS);
        if (!content.trim()) return NextResponse.json({ error: "No usable content found for this reference" }, { status: 400 });
        const { error } = await supabase.from("prompt_template_references").insert({
          template_id: body.templateId, kind: body.kind, label: label || null, content,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "remove-reference": {
        if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        const { error } = await supabase.from("prompt_template_references").delete().eq("id", body.id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
