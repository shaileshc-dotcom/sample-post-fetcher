"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setHasSession(!!user);
      setChecking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => { router.push("/"); router.refresh(); }, 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="card p-8 max-w-sm w-full">
        <h1 className="text-xl font-semibold mb-1">Set a new password</h1>

        {checking ? (
          <p className="text-sm text-[var(--muted)]">Checking your reset link…</p>
        ) : !hasSession ? (
          <>
            <p className="text-sm text-[var(--muted)] mb-4">
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <a href="/login" className="btn-primary inline-block px-5 py-2.5 text-sm">Back to sign in</a>
          </>
        ) : done ? (
          <p className="text-sm" style={{ color: "var(--positive)" }}>Password updated — signing you in…</p>
        ) : (
          <>
            <p className="text-sm text-[var(--muted)] mb-4">Choose a new password for your account.</p>
            <div className="space-y-3">
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="New password" autoComplete="new-password"
                className="input w-full px-3 py-2.5 text-sm"
              />
              <input
                type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Confirm new password" autoComplete="new-password"
                className="input w-full px-3 py-2.5 text-sm"
              />
              <button onClick={submit} disabled={busy || !password || !confirm} className="btn-primary w-full px-5 py-2.5 text-sm">
                {busy ? "Updating…" : "Update password"}
              </button>
              {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
