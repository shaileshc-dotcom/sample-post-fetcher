import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex">
      <Sidebar email={user.email ?? ""} />
      <div className="flex-1 min-h-screen max-w-6xl mx-auto px-8 py-10">{children}</div>
    </div>
  );
}
