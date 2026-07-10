import { NextRequest, NextResponse } from "next/server";
import { copyDoc, convertWordToDoc, formatDoc, getDocParagraphs, extractFileId } from "@/lib/google-formatter";
import { classifyParagraphs } from "@/lib/ai/classify";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface Body {
  action: "copy" | "convert" | "format" | "copy-format";
  url?: string;
  name?: string;
  dataBase64?: string; // for convert
}

async function formatById(fileId: string) {
  const paras = await getDocParagraphs(fileId);
  const levels = await classifyParagraphs(paras);
  return formatDoc(fileId, levels);
}

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    switch (body.action) {
      case "copy": {
        const id = extractFileId(body.url || "");
        if (!id) return NextResponse.json({ error: "Could not read a Google Doc ID from that URL" }, { status: 400 });
        const r = await copyDoc(id);
        return NextResponse.json(r);
      }
      case "convert": {
        if (!body.dataBase64 || !body.name) return NextResponse.json({ error: "Missing file data" }, { status: 400 });
        const buffer = Buffer.from(body.dataBase64, "base64");
        const r = await convertWordToDoc(buffer, body.name);
        return NextResponse.json(r);
      }
      case "format": {
        const id = extractFileId(body.url || "");
        if (!id) return NextResponse.json({ error: "Could not read a Google Doc ID from that URL" }, { status: 400 });
        const r = await formatById(id);
        return NextResponse.json(r);
      }
      case "copy-format": {
        const id = extractFileId(body.url || "");
        if (!id) return NextResponse.json({ error: "Could not read a Google Doc ID from that URL" }, { status: 400 });
        const copied = await copyDoc(id);
        await formatById(copied.id);
        return NextResponse.json(copied);
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
