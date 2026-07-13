import { RequireRole } from "@/components/require-role";

export default function MissiveLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/missive"}>{children}</RequireRole>;
}
