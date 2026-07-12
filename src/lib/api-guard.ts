import { NextResponse } from "next/server";
import { getCurrentRole, type CurrentRole } from "@/lib/current-role";
import type { Role } from "@/lib/roles";

/** Route Handler guard. Returns the caller's CurrentRole on success, or a ready-to-return 401/403 NextResponse. */
export async function requireApiRole(roles: Role[]): Promise<CurrentRole | NextResponse> {
  const current = await getCurrentRole();
  if (!current) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!current.active) return NextResponse.json({ error: "Account pending approval" }, { status: 403 });
  if (!roles.includes(current.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return current;
}
