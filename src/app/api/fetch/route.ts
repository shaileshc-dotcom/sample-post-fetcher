import { NextRequest, NextResponse } from "next/server";
import { fetchSamplePosts } from "@/lib/fetchers/orchestrator";
import { createServerClient } from "@/lib/supabase/server";
import type { FetchOptions } from "@/lib/types";

// Scraping + AI can run long; allow up to 60s on Vercel (Pro). Hobby = 10s.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface Body {
  domain: string;
  options?: FetchOptions;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.domain || typeof body.domain !== "string") {
    return NextResponse.json({ error: "Missing 'domain'" }, { status: 400 });
  }

  try {
    const options = { limit: 3, ...(body.options ?? {}) };
    const result = await fetchSamplePosts(body.domain, options);

    // Persist to search history unless this is part of a bulk run (bulk writes one summary row).
    if (!(options as { skipHistory?: boolean }).skipHistory) {
      void persistHistory(result.domain, result.articles.length, result.durationMs, result.methodUsed.join(","));
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Fetch failed" },
      { status: 500 }
    );
  }
}

async function persistHistory(domain: string, found: number, ms: number, method: string) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: prof } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    const runBy = prof?.display_name || user.email || "";
    await supabase.from("search_history").insert({
      user_id: user.id,
      run_by: runBy,
      domain,
      articles_found: found,
      duration_ms: ms,
      fetch_method: method,
      status: found > 0 ? "success" : "empty",
    });
  } catch {
    /* history is non-critical */
  }
}
