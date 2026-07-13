import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// Handles the email-confirmation / OAuth / password-recovery redirect.
// `next` lets a specific flow (e.g. password recovery) land somewhere other
// than the dashboard once the code is exchanged for a session.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";
  if (code) {
    const supabase = await createServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
