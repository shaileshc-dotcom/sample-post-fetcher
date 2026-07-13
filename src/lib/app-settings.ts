import { createClient } from "@/lib/supabase/client";

/** Global settings: admin-write, everyone-read. Backed by public.app_settings (singleton row). */
export interface GlobalSettings {
  autoIndexCheck: boolean;
  autoIndexSubmit: boolean;
  backlinkAutoSync: boolean;
}
const GLOBAL_DEFAULTS: GlobalSettings = { autoIndexCheck: true, autoIndexSubmit: false, backlinkAutoSync: true };

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const supabase = createClient();
  const { data } = await supabase.from("app_settings").select("auto_index_check, auto_index_submit, backlink_auto_sync").eq("id", 1).maybeSingle();
  if (!data) return GLOBAL_DEFAULTS;
  return {
    autoIndexCheck: data.auto_index_check,
    autoIndexSubmit: data.auto_index_submit,
    backlinkAutoSync: data.backlink_auto_sync ?? true,
  };
}

/** Fails silently for non-admins — RLS rejects the write, UI should be read-only for them anyway. */
export async function saveGlobalSettings(patch: Partial<GlobalSettings>): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const dbPatch: Record<string, boolean> = {};
  if (patch.autoIndexCheck !== undefined) dbPatch.auto_index_check = patch.autoIndexCheck;
  if (patch.autoIndexSubmit !== undefined) dbPatch.auto_index_submit = patch.autoIndexSubmit;
  if (patch.backlinkAutoSync !== undefined) dbPatch.backlink_auto_sync = patch.backlinkAutoSync;
  const { error } = await supabase.from("app_settings").update(dbPatch).eq("id", 1);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Per-user default prompt. Backed by public.user_settings (one row per user, RLS-scoped to owner). */
export async function getMyPrompt(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";
  const { data } = await supabase.from("user_settings").select("default_prompt").eq("user_id", user.id).maybeSingle();
  return data?.default_prompt ?? "";
}

export async function saveMyPrompt(prompt: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { error } = await supabase.from("user_settings").upsert({
    user_id: user.id, default_prompt: prompt, updated_at: new Date().toISOString(),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
