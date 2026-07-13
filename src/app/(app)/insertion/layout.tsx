import { RequireRole } from "@/components/require-role";

export default function InsertionLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/insertion"}>{children}</RequireRole>;
}
