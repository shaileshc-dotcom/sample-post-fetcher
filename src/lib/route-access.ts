import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

/** Deny-by-default if a route's row is missing or the query fails — fail closed, not open. */
const FAIL_SAFE: Role[] = ["admin"];

/**
 * Server-only, request-memoized. Reads the admin-editable route → roles
 * mapping from public.route_access. `admin` is always included regardless
 * of what's stored, as a safety net so editing the matrix can never lock
 * every admin out of the app (the matrix UI also prevents unchecking admin,
 * this is the defense-in-depth backstop for that rule).
 */
export const getRouteRoles = cache(async (route: string): Promise<Role[]> => {
  try {
    const supabase = await createServerClient();
    const { data } = await supabase.from("route_access").select("roles").eq("route", route).maybeSingle();
    const roles = (data?.roles as Role[] | undefined) ?? FAIL_SAFE;
    return roles.includes("admin") ? roles : [...roles, "admin"];
  } catch {
    return FAIL_SAFE;
  }
});
