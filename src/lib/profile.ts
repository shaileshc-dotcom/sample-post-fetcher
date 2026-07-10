import { createClient } from "@/lib/supabase/client";

export interface Profile { display_name: string; avatar: string; }

export async function getProfile(): Promise<{ email: string; profile: Profile }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { email: "", profile: { display_name: "", avatar: "" } };
  const { data } = await supabase.from("profiles").select("display_name, avatar").eq("user_id", user.id).maybeSingle();
  return {
    email: user.email ?? "",
    profile: { display_name: data?.display_name ?? "", avatar: data?.avatar ?? "" },
  };
}

export async function saveProfile(p: Profile): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { error } = await supabase.from("profiles").upsert({
    user_id: user.id, display_name: p.display_name, avatar: p.avatar, updated_at: new Date().toISOString(),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
