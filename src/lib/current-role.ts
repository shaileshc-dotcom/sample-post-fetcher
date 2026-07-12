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
 * user with no profile row yet (trigger race, edge case) falls back to
 * role "content" / active false, which routes them to /pending rather than
 * granting any access.
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

  return {
    userId: user.id,
    email: user.email ?? "",
    role: (data?.role as Role | undefined) ?? "content",
    team: data?.team ?? null,
    active: data?.active ?? false,
  };
});
