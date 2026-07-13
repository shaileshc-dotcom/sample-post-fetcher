import { RequireRole } from "@/components/require-role";

export default function DocStudioLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/doc-studio"}>{children}</RequireRole>;
}
