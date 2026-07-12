import { RequireRole } from "@/components/require-role";
import { ROUTE_ROLES } from "@/lib/roles";

export default function InsertionLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole roles={ROUTE_ROLES["/insertion"]}>{children}</RequireRole>;
}
