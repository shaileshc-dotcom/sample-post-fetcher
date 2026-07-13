import { NextRequest, NextResponse } from "next/server";
import { findInsertionMatches } from "@/lib/insertion";
import { requireApiRole } from "@/lib/api-guard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireApiRole("/insertion");
  if (gate instanceof NextResponse) return gate;

  let body: { website?: string; anchor?: string; targetUrl?: string; prompt?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { website, anchor, targetUrl, prompt = "", limit = 5 } = body;
  if (!website || !anchor || !targetUrl) {
    return NextResponse.json({ error: "website, anchor and targetUrl are required" }, { status: 400 });
  }
  try {
    const result = await findInsertionMatches(website, anchor, targetUrl, prompt, limit);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
