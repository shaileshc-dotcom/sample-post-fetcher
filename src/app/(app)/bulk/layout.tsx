import { RequireRole } from "@/components/require-role";

export default function BulkLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/bulk"}>{children}</RequireRole>;
}
