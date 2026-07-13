import { RequireRole } from "@/components/require-role";

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/history"}>{children}</RequireRole>;
}
