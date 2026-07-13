import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

export interface CurrentRole {
  userId: string;
  email: string;
  role: Role;
  team: string | null;
  active: boolean;
}

/**
 * Server-only. Memoized per request (React cache()) so calling this from a
 * layout and a page in the same request only hits the DB once.
 * Returns null only when there's no signed-in user at all — a signed-in
 * user with no profile row yet falls back to role "content" / active false,
 * which routes them to /pending rather than granting any access.
 *
 * If no row exists (whatever auto-creates it on signup didn't fire — e.g.
 * OAuth sign-in, or the DB trigger missing/erroring), this creates one with
 * those same pending defaults so the user shows up in Team & Access for an
 * admin to activate, instead of silently having no row at all.
 */
export const getCurrentRole = cache(async (): Promise<CurrentRole | null> => {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("role, team, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) {
    try {
      await supabase.from("profiles").upsert(
        { user_id: user.id, email: user.email, role: "content", active: false },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
    } catch {
      /* best-effort — if this fails (e.g. RLS), the in-memory defaults below still apply */
    }
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    role: (data?.role as Role | undefined) ?? "content",
    team: data?.team ?? null,
    active: data?.active ?? false,
  };
});
