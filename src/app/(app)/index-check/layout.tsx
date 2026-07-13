import { RequireRole } from "@/components/require-role";

export default function IndexCheckLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/index-check"}>{children}</RequireRole>;
}
