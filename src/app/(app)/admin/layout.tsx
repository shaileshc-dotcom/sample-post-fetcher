import { RequireRole } from "@/components/require-role";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/admin"}>{children}</RequireRole>;
}
