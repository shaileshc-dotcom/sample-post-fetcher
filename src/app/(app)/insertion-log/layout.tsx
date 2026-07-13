import { RequireRole } from "@/components/require-role";

export default function InsertionLogLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/insertion-log"}>{children}</RequireRole>;
}
