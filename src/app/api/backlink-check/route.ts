import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { httpGet, detectBlock } from "@/lib/http";
import { requireApiRole } from "@/lib/api-guard";
import { createServerClient } from "@/lib/supabase/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function safeHost(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

export async function POST(req: NextRequest) {
  const gate = await requireApiRole("/backlink-monitor");
  if (gate instanceof NextResponse) return gate;

  let body: { id?: string; pageUrl?: string; targetUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { id, pageUrl, targetUrl } = body;
  if (!id || !pageUrl || !targetUrl) {
    return NextResponse.json({ error: "id, pageUrl and targetUrl are required" }, { status: 400 });
  }

  try {
    const res = await httpGet(pageUrl);
    const blocked = detectBlock(res);
    let present = false;
    let dofollow = false;
    let checkError: string | null = null;

    if (!res.ok || blocked) {
      checkError = blocked || `Page returned HTTP ${res.status}`;
    } else {
      const $ = cheerio.load(res.data);
      const targetHost = safeHost(targetUrl);
      const targetPath = (() => { try { return new URL(targetUrl).pathname; } catch { return ""; } })();
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        const sameUrl = href.includes(targetUrl);
        const samePathOnHost = targetHost && targetPath && safeHost(href) === targetHost && href.includes(targetPath);
        if (sameUrl || samePathOnHost) {
          present = true;
          const rel = ($(el).attr("rel") || "").toLowerCase();
          dofollow = !rel.includes("nofollow");
        }
      });
    }

    const supabase = await createServerClient();
    await supabase.from("insertion_history").update({
      link_present: checkError ? null : present,
      link_dofollow: checkError ? null : dofollow,
      last_checked_at: new Date().toISOString(),
    }).eq("id", id);

    return NextResponse.json({ present, dofollow, error: checkError });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
