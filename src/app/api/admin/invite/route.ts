import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireApiRole("/admin");
  if (gate instanceof NextResponse) return gate;

  let body: { email?: string; role?: Role; team?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { email, role, team } = body;
  if (!email || !role) {
    return NextResponse.json({ error: "email and role are required" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    // inviteUserByEmail creates the user with no password — redirectTo sends
    // them through the same code-exchange callback as password reset, landing
    // on /reset-password to set one. Without this they'd have an account they
    // can never actually sign into.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${req.nextUrl.origin}/auth/callback?next=/reset-password`,
    });
    if (error) throw error;

    const userId = data.user?.id;
    if (userId) {
      // The signup trigger already created a profiles row (role: content,
      // active: false) synchronously as part of the same insert. Since an
      // admin explicitly invited this person, promote + activate immediately
      // rather than leaving them on /pending like a self-serve signup.
      await admin.from("profiles").update({ role, team: team || null, active: true }).eq("user_id", userId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
