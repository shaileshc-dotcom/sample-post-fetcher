import { RequireRole } from "@/components/require-role";

export default function BacklinkMonitorLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route={"/backlink-monitor"}>{children}</RequireRole>;
}
