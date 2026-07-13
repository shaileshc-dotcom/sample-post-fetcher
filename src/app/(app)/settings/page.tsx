"use client";

import { useEffect, useRef, useState } from "react";
import { getSettings, saveSettings, applyTheme, type AppSettings, type Theme } from "@/lib/settings";
import { getGlobalSettings, saveGlobalSettings, getMyPrompt, saveMyPrompt, type GlobalSettings } from "@/lib/app-settings";
import { getProfile, saveProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AVATAR_PRESETS } from "@/components/avatar";
import type { Role } from "@/lib/roles";

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings>({
    postsPerDomain: 3,
    concurrency: 8,
    aiDefault: false,
    theme: "light",
  });
  const [saved, setSaved] = useState(false);

  // Global (admin-write, everyone-read)
  const [isAdmin, setIsAdmin] = useState(false);
  const [global, setGlobal] = useState<GlobalSettings>({ autoIndexCheck: true, autoIndexSubmit: false, backlinkAutoSync: true });
  const [globalSaved, setGlobalSaved] = useState(false);
  const [globalErr, setGlobalErr] = useState<string | null>(null);

  // Which sections are relevant to this role — mirrors the sidebar's live route_access check
  const [canSearch, setCanSearch] = useState(false);
  const [canIndex, setCanIndex] = useState(false);

  // Per-user default prompt
  const [prompt, setPrompt] = useState("");
  const [promptSaved, setPromptSaved] = useState(false);

  // Profile
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [profSaved, setProfSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setS(getSettings());
    void loadProfile();
    void getGlobalSettings().then(setGlobal);
    void getMyPrompt().then(setPrompt);
    void (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: prof }, { data: accessRows }] = await Promise.all([
        supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle(),
        supabase.from("route_access").select("route, roles"),
      ]);
      const role = (prof?.role as Role) ?? "content";
      setIsAdmin(role === "admin");
      const access: Record<string, Role[]> = {};
      (accessRows ?? []).forEach((r) => { access[r.route] = r.roles as Role[]; });
      setCanSearch(role === "admin" || !!access["/search"]?.includes(role) || !!access["/bulk"]?.includes(role));
      setCanIndex(
        role === "admin" ||
        !!access["/insertion"]?.includes(role) ||
        !!access["/insertion-log"]?.includes(role) ||
        !!access["/index-check"]?.includes(role)
      );
    })();
  }, []);

  async function loadProfile() {
    const { email, profile } = await getProfile();
    setEmail(email); setName(profile.display_name); setAvatar(profile.avatar || "preset:1");
  }
  async function persistProfile() {
    await saveProfile({ display_name: name, avatar });
    setProfSaved(true); setTimeout(() => setProfSaved(false), 1500);
    window.dispatchEvent(new Event("profile-updated"));
  }
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const min = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
        setAvatar(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function persist(next: AppSettings) {
    setS(next);
    saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function setTheme(theme: Theme) {
    persist({ ...s, theme });
    applyTheme(theme);
  }

  async function persistGlobal(next: GlobalSettings) {
    setGlobal(next);
    setGlobalErr(null);
    const res = await saveGlobalSettings(next);
    if (!res.ok) { setGlobalErr(res.error || "Failed to save — admin only."); return; }
    setGlobalSaved(true); setTimeout(() => setGlobalSaved(false), 1500);
  }

  async function persistPrompt() {
    await saveMyPrompt(prompt);
    setPromptSaved(true); setTimeout(() => setPromptSaved(false), 1500);
  }

  return (
    <div className="max-w-xl">
      <header className="mb-8">
        <div className="eyebrow">Configuration</div>
        <h1 className="text-3xl mt-1">Settings</h1>
        <p className="text-[var(--muted)] text-sm mt-2">Your profile and search defaults.</p>
      </header>

      {/* Profile */}
      <div className="card p-6 mb-6">
        <div className="eyebrow mb-4">Profile</div>
        <div className="flex items-center gap-4 mb-5">
          <Avatar avatar={avatar} name={name || email} size={64} />
          <div className="min-w-0">
            <div className="font-medium truncate">{name || "Your name"}</div>
            <div className="text-xs text-[var(--muted)] mono truncate">{email}</div>
          </div>
        </div>

        <Field label="Display name" hint="Shown on your dashboard and sidebar.">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shailesh" className="input w-full px-3 py-2 text-sm" />
        </Field>

        <div className="mt-4">
          <div className="eyebrow mb-2">Avatar</div>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.keys(AVATAR_PRESETS).map((key) => (
              <button key={key} onClick={() => setAvatar(key)}
                className="rounded-full transition"
                style={{ padding: 2, border: avatar === key ? "2px solid var(--accent)" : "2px solid transparent" }}>
                <Avatar avatar={key} name={name || email} size={36} />
              </button>
            ))}
            <button onClick={() => fileRef.current?.click()} className="btn-ghost text-xs px-3 py-2">Browse…</button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button onClick={persistProfile} className="btn-primary px-5 py-2 text-sm">Save profile</button>
          {profSaved && <span className="text-xs" style={{ color: "var(--positive)" }}>Saved.</span>}
        </div>
      </div>

      <div className="card p-6 mb-6">
        <div className="eyebrow mb-4">Appearance</div>
        <Field label="Theme" hint="Applies immediately, saved per browser.">
          <div className="inline-flex p-1 rounded-lg border border-[var(--border)] bg-[var(--panel)]">
            {(["light", "dark", "system"] as const).map((t) => (
              <button key={t} onClick={() => setTheme(t)}
                className={`px-3 py-1.5 rounded-md text-xs capitalize transition ${s.theme === t ? "text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                style={s.theme === t ? { background: "var(--grad)", fontWeight: 600 } : undefined}>
                {t}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {canSearch && (
      <div className="card p-6 space-y-6 mb-6">
        <div className="eyebrow">Search defaults <span className="opacity-60 normal-case">· saved per browser</span></div>
        <Field label="Posts per domain" hint="Sample articles fetched per site (default 3).">
          <input
            type="number"
            min={1}
            max={20}
            value={s.postsPerDomain}
            onChange={(e) => persist({ ...s, postsPerDomain: Math.max(1, Number(e.target.value)) })}
            className="input w-24 px-3 py-1.5 text-sm mono"
          />
        </Field>

        <Field label="Bulk concurrency" hint="Domains fetched in parallel. 8–15 is good on the deployed site (HTTP/2); keep ~5 on localhost.">
          <input
            type="number"
            min={1}
            max={30}
            value={s.concurrency}
            onChange={(e) => persist({ ...s, concurrency: Math.max(1, Number(e.target.value)) })}
            className="input w-24 px-3 py-1.5 text-sm mono"
          />
        </Field>

        <Field label="AI analysis by default" hint="Adds summary + scores, and enables prompt-based selection.">
          <input
            type="checkbox"
            checked={s.aiDefault}
            onChange={(e) => persist({ ...s, aiDefault: e.target.checked })}
          />
        </Field>

        {saved && <p className="text-xs" style={{ color: "var(--positive)" }}>Saved.</p>}
      </div>
      )}

      {canIndex && (
      <div className="card p-6 space-y-6 mb-6">
        <div className="eyebrow">
          Global indexing settings {!isAdmin && <span className="opacity-60 normal-case">· read-only, admin-controlled</span>}
        </div>
        <Field label="Auto index-check" hint="When Link-Insertion results appear, automatically check if they're indexed (uses SpeedyIndex checker tokens). Applies to the whole team.">
          <input
            type="checkbox"
            checked={global.autoIndexCheck}
            disabled={!isAdmin}
            onChange={(e) => persistGlobal({ ...global, autoIndexCheck: e.target.checked })}
          />
        </Field>

        <Field label="Auto submit for indexing" hint="On doc generation, automatically submit a page that isn't indexed (uses indexer credits/tokens). Applies to the whole team.">
          <input
            type="checkbox"
            checked={global.autoIndexSubmit}
            disabled={!isAdmin}
            onChange={(e) => persistGlobal({ ...global, autoIndexSubmit: e.target.checked })}
          />
        </Field>

        {globalErr && <p className="text-xs text-[var(--danger)]">{globalErr}</p>}
        {globalSaved && <p className="text-xs" style={{ color: "var(--positive)" }}>Saved for everyone.</p>}
      </div>
      )}

      {canSearch && (
      <div className="card p-6">
        <div className="eyebrow mb-2">Your default prompt</div>
        <div className="text-xs text-[var(--muted)] mb-2">
          Applied to your own Single and Bulk searches only. Describe the posts you usually want — the AI uses it to rank and pick the best matches.
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={persistPrompt}
          rows={3}
          placeholder="e.g. recent editorial articles, English, skip sponsored and category pages"
          className="input w-full px-3 py-2 text-sm resize-y"
        />
        {promptSaved && <p className="text-xs mt-2" style={{ color: "var(--positive)" }}>Saved.</p>}
      </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5">{hint}</div>
      </div>
      <div className="pt-1">{children}</div>
    </div>
  );
}
