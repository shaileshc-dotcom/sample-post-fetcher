import { RequireRole } from "@/components/require-role";
import { ROUTE_ROLES } from "@/lib/roles";

export default function InsertionLogLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole roles={ROUTE_ROLES["/insertion-log"]}>{children}</RequireRole>;
}
