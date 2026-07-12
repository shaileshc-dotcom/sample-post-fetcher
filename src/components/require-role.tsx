import { redirect } from "next/navigation";
import { getCurrentRole } from "@/lib/current-role";
import type { Role } from "@/lib/roles";

/** Server component. Wrap a route segment's children to gate it by role. */
export async function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const current = await getCurrentRole();
  if (!current) redirect("/login");
  if (!current.active) redirect("/pending");
  if (!roles.includes(current.role)) redirect("/");
  return <>{children}</>;
}
