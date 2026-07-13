import { NextResponse } from "next/server";
import { getCurrentRole, type CurrentRole } from "@/lib/current-role";
import { getRouteRoles } from "@/lib/route-access";

/**
 * Route Handler guard. `route` is the feature key in public.route_access —
 * usually the page this API backs (e.g. "/insertion" for /api/insertion).
 * Returns the caller's CurrentRole on success, or a ready-to-return 401/403.
 */
export async function requireApiRole(route: string): Promise<CurrentRole | NextResponse> {
  const current = await getCurrentRole();
  if (!current) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!current.active) return NextResponse.json({ error: "Account pending approval" }, { status: 403 });
  const roles = await getRouteRoles(route);
  if (!roles.includes(current.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return current;
}
