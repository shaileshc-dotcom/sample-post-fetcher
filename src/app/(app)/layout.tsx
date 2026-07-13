import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/current-role";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import { BulkRunProvider } from "@/lib/bulk-run-context";
import { BulkCompletionToast } from "@/components/bulk-completion-toast";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const current = await getCurrentRole();
  if (!current || !current.active) redirect("/pending");

  return (
    <BulkRunProvider>
      <div className="flex">
        <Sidebar email={user.email ?? ""} role={current.role} />
        <div className="flex-1 min-h-screen flex flex-col min-w-0">
          <TopBar email={user.email ?? ""} role={current.role} />
          <div className="flex-1 max-w-6xl w-full mx-auto px-8 py-10">{children}</div>
        </div>
      </div>
      <BulkCompletionToast />
    </BulkRunProvider>
  );
}
