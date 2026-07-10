"use client";

import { useEffect, useRef, useState } from "react";
import { getSettings, saveSettings, type AppSettings } from "@/lib/settings";
import { getProfile, saveProfile } from "@/lib/profile";
import { Avatar, AVATAR_PRESETS } from "@/components/avatar";

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings>({
    postsPerDomain: 3,
    concurrency: 8,
    aiDefault: false,
    defaultPrompt: "",
    autoIndexCheck: true,
    autoIndexSubmit: false,
  });
  const [saved, setSaved] = useState(false);

  // Profile
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [profSaved, setProfSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setS(getSettings()); void loadProfile(); }, []);
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

      <div className="card p-6 space-y-6">
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

        <Field label="Auto index-check" hint="When Link-Insertion results appear, automatically check if they're indexed (uses SpeedyIndex checker tokens).">
          <input
            type="checkbox"
            checked={s.autoIndexCheck}
            onChange={(e) => persist({ ...s, autoIndexCheck: e.target.checked })}
          />
        </Field>

        <Field label="Auto submit for indexing" hint="On doc generation, automatically submit a page that isn't indexed (uses indexer credits/tokens).">
          <input
            type="checkbox"
            checked={s.autoIndexSubmit}
            onChange={(e) => persist({ ...s, autoIndexSubmit: e.target.checked })}
          />
        </Field>

        <div>
          <div className="text-sm">Default prompt</div>
          <div className="text-xs text-[var(--muted)] mt-0.5 mb-2">
            Applied to Single and Bulk searches. Describe the posts you usually want — the AI uses it to rank and pick the best matches.
          </div>
          <textarea
            value={s.defaultPrompt}
            onChange={(e) => persist({ ...s, defaultPrompt: e.target.value })}
            rows={3}
            placeholder="e.g. recent editorial articles, English, skip sponsored and category pages"
            className="input w-full px-3 py-2 text-sm resize-y"
          />
        </div>

        {saved && <p className="text-xs" style={{ color: "var(--positive)" }}>Saved.</p>}
      </div>
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
