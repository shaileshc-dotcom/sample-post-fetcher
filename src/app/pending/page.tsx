import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/current-role";
import { PendingSignOutButton } from "./sign-out-button";

export default async function PendingPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const current = await getCurrentRole();
  if (current?.active) redirect("/");

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold">Awaiting approval</h1>
        <p className="text-[var(--muted)] text-sm">
          Your account ({user.email}) has been created but hasn&apos;t been
          activated yet. An admin needs to approve your access before you can
          use the app. Reach out to your GUESTPOSTLINKS admin to get set up.
        </p>
        <PendingSignOutButton />
      </div>
    </div>
  );
}
