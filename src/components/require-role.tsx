import { redirect } from "next/navigation";
import { getCurrentRole } from "@/lib/current-role";
import { getRouteRoles } from "@/lib/route-access";

/** Server component. Wrap a route segment's children to gate it by role (admin-editable via Team & Access). */
export async function RequireRole({ route, children }: { route: string; children: React.ReactNode }) {
  const current = await getCurrentRole();
  if (!current) redirect("/login");
  if (!current.active) redirect("/pending");
  const roles = await getRouteRoles(route);
  if (!roles.includes(current.role)) redirect("/");
  return <>{children}</>;
}
