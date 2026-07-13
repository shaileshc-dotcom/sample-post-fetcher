import { RequireRole } from "@/components/require-role";

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/search"}>{children}</RequireRole>;
}
