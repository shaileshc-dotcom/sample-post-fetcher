"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const FEATURES: { title: string; body: string; icon: "scout" | "docs" | "bulk" | "index" }[] = [
  { title: "Publisher Scout", body: "Surface promising publisher domains before you ever reach out.", icon: "scout" },
  { title: "Sample Post Finder", body: "Pull real guest-post examples straight from the source.", icon: "docs" },
  { title: "Bulk Analysis", body: "Fetch and score hundreds of domains in a single run.", icon: "bulk" },
  { title: "Index Checker", body: "Confirm a placement is actually indexed before you report it.", icon: "index" },
];

const STATS: { value: string; label: string }[] = [
  { value: "60,000+", label: "Domain inventory" },
  { value: "4", label: "Fetch sources" },
  { value: "<60s", label: "Per bulk run" },
  { value: "AI", label: "Assisted ranking" },
];

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true); setError(null); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/"); router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) { router.push("/"); router.refresh(); }
        else { setMsg("Account created. Confirm your email, then sign in."); setMode("signin"); }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setError(null); setMsg(null); setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser navigates away to Google immediately — this only
    // ever resolves with an error (misconfigured provider, network, etc.).
    if (error) { setError(error.message); setGoogleLoading(false); }
  }

  return (
    <div className="landing">
      <section className="hero-panel">
        <NetworkArt />
        <div className="hero-scrim" aria-hidden="true" />

        <div className="hero-col">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-light.png" alt="GUESTPOSTLINKS" className="wordmark" />

          <div className="hero-copy-block">
            <span className="eyebrow">AI-powered publisher intelligence</span>
            <h1 className="headline">SCOUT. PLACE. <em>INDEX.</em></h1>
            <p className="subhead">
              Everything your team needs to find, vet, and place guest
              posts — in one platform.
            </p>
          </div>

          <div className="feature-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature-card">
                <span className="feature-icon"><FeatureGlyph name={f.icon} /></span>
                <div>
                  <div className="feature-title">{f.title}</div>
                  <div className="feature-body">{f.body}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="stats-row">
            {STATS.map((s) => (
              <div key={s.label} className="stat">
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="GUESTPOSTLINKS" className="mark" />
          <h2 className="auth-title">{mode === "signin" ? "Sign in" : "Create your account"}</h2>
          <p className="auth-sub">GUESTPOSTLINKS · internal tools</p>

          <button
            type="button"
            className="google-btn"
            onClick={signInWithGoogle}
            disabled={googleLoading || loading}
          >
            {googleLoading ? <span className="spin-icon" aria-hidden="true" /> : <GoogleGlyph />}
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </button>

          <div className="divider"><span>or continue with email</span></div>

          <div className="fields">
            <label className="field">
              <span className="field-label">Email</span>
              <span className="input-wrap">
                <MailGlyph className="input-icon" />
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@amrytt.com" className="text-input" autoComplete="email" autoFocus
                />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <span className="input-wrap">
                <LockGlyph className="input-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••••"
                  className="text-input has-trailing"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
                <button
                  type="button" className="eye-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffGlyph /> : <EyeGlyph />}
                </button>
              </span>
            </label>
            <button onClick={submit} disabled={loading || googleLoading || !email || !password} className="submit-btn">
              {loading && <span className="spin-icon light" aria-hidden="true" />}
              {loading ? (mode === "signin" ? "Signing in…" : "Creating account…") : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </div>

          {error && <p className="note note-err" role="alert">{error}</p>}
          {msg && <p className="note note-ok" role="status">{msg}</p>}

          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setMsg(null); }}
            className="switch"
          >
            {mode === "signin" ? <>Need an account? <span className="switch-accent">Create one</span></> : <>Have an account? <span className="switch-accent">Sign in</span></>}
          </button>
        </div>
      </section>

      <style jsx global>{`
        :root {
          --primary: #ff6a3d;
          --accent: #ff8a4d;
          --page-bg: #fafbfd;
          --card: #ffffff;
          --line: #e8e8e8;
          --ink: #111111;
          --muted: #6b7280;
        }

        .landing {
          min-height: 100vh; display: flex;
          font-family: var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif;
        }

        /* ---------- spacing + type scale, shared ---------- */
        .hero-panel, .auth-panel { --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px; }

        /* ---------- Hero panel (dark, brand) ---------- */
        .hero-panel {
          flex: 1.2; position: relative; overflow: hidden;
          background: #0a0908; color: #f5f3f0;
          padding: var(--sp-7) var(--sp-8);
          display: flex; align-items: center;
        }
        .hero-scrim {
          position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(180deg, rgba(10,9,8,0.35) 0%, rgba(10,9,8,0.75) 60%, #0a0908 100%);
        }
        .hero-col { position: relative; z-index: 1; width: 100%; max-width: 560px; margin: 0 auto; }

        .wordmark {
          height: 20px; width: auto; display: block; margin-bottom: var(--sp-8);
          opacity: 0; animation: fadeUp 0.5s ease both;
        }

        .hero-copy-block { margin-bottom: var(--sp-7); }
        .eyebrow {
          display: block; font-family: var(--font-mono), monospace; font-size: 11px;
          letter-spacing: 0.14em; text-transform: uppercase; color: #ffb488;
          margin-bottom: var(--sp-4);
          opacity: 0; animation: fadeUp 0.5s ease both; animation-delay: 0.08s;
        }
        .headline {
          margin: 0 0 var(--sp-4); font-family: var(--font-display), sans-serif; font-weight: 700;
          letter-spacing: -0.02em; line-height: 1.06; font-size: clamp(34px, 3.6vw, 52px); color: #f8f6f2;
          opacity: 0; animation: fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) both; animation-delay: 0.16s;
        }
        .headline em {
          font-style: normal;
          background: linear-gradient(100deg, var(--primary) 15%, var(--accent) 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
        }
        .subhead {
          margin: 0; color: #b9b3a7; font-size: 16px; line-height: 1.6; max-width: 44ch;
          opacity: 0; animation: fadeUp 0.5s ease both; animation-delay: 0.26s;
        }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

        .feature-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); margin-bottom: var(--sp-6);
          opacity: 0; animation: fadeUp 0.5s ease both; animation-delay: 0.36s;
        }
        .feature-card {
          display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-4);
          background: rgba(245,243,240,0.05); border: 1px solid rgba(245,243,240,0.09);
          border-radius: 14px; backdrop-filter: blur(6px);
          transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
        }
        .feature-card:hover { background: rgba(245,243,240,0.08); border-color: rgba(245,243,240,0.16); transform: translateY(-1px); }
        .feature-icon {
          width: 32px; height: 32px; flex-shrink: 0; border-radius: 9px; display: grid; place-items: center;
          background: linear-gradient(135deg, var(--primary), var(--accent)); color: #fff;
        }
        .feature-icon svg { width: 16px; height: 16px; }
        .feature-title { font-size: 13.5px; font-weight: 650; color: #f5f3f0; margin-bottom: 2px; }
        .feature-body { font-size: 12px; line-height: 1.45; color: #a49d90; }

        .stats-row {
          display: flex; gap: var(--sp-6); padding-top: var(--sp-5); border-top: 1px solid rgba(245,243,240,0.1);
          opacity: 0; animation: fadeUp 0.5s ease both; animation-delay: 0.46s;
        }
        .stat-value { font-family: var(--font-display), sans-serif; font-size: 20px; font-weight: 700; color: #f8f6f2; font-variant-numeric: tabular-nums; }
        .stat-label { font-size: 11px; color: #8b8478; margin-top: 2px; }

        /* ---------- Auth panel (light) ---------- */
        .auth-panel {
          flex: 1; min-width: 0; background: var(--page-bg);
          display: flex; align-items: center; justify-content: center;
          padding: var(--sp-7) var(--sp-6);
        }
        .auth-card {
          width: 100%; max-width: 400px; background: var(--card); border: 1px solid var(--line);
          border-radius: 24px; padding: var(--sp-8) var(--sp-7) var(--sp-7);
          box-shadow: 0 30px 60px -30px rgba(17,17,17,0.16);
          opacity: 0; animation: fadeUp 0.5s ease both; animation-delay: 0.14s;
        }
        .mark { width: 36px; height: 36px; display: block; margin-bottom: var(--sp-5); }
        .auth-title { font-family: var(--font-display), sans-serif; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); margin: 0; }
        .auth-sub { color: var(--muted); font-size: 12.5px; margin: 6px 0 var(--sp-7); font-family: var(--font-mono), monospace; letter-spacing: 0.05em; }

        .google-btn {
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
          background: #ffffff; border: 1px solid var(--line); color: var(--ink);
          font-size: 14px; font-weight: 600; padding: 13px; border-radius: 12px; cursor: pointer;
          transition: background 0.18s ease, border-color 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease;
        }
        .google-btn:hover:not(:disabled) { background: #f6f7f9; box-shadow: 0 2px 8px -2px rgba(17,17,17,0.08); }
        .google-btn:active:not(:disabled) { transform: translateY(1px); }
        .google-btn:disabled { opacity: 0.55; cursor: default; }

        .divider { display: flex; align-items: center; gap: var(--sp-3); margin: var(--sp-6) 0; color: var(--muted); font-size: 12px; }
        .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }

        .fields { display: flex; flex-direction: column; gap: var(--sp-4); text-align: left; }
        .field { display: flex; flex-direction: column; gap: 7px; }
        .field-label { font-family: var(--font-mono), monospace; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }

        .input-wrap { position: relative; display: flex; align-items: center; }
        .input-icon { position: absolute; left: 14px; width: 16px; height: 16px; color: var(--muted); pointer-events: none; }
        .text-input {
          width: 100%; background: var(--page-bg); border: 1px solid var(--line); border-radius: 11px;
          padding: 13px 14px 13px 40px; color: var(--ink); font-size: 14.5px; outline: none;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .text-input.has-trailing { padding-right: 40px; }
        .text-input::placeholder { color: #a3a9b3; }
        .text-input:focus { background: #ffffff; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(255,106,61,0.14); }
        .eye-btn {
          position: absolute; right: 11px; width: 26px; height: 26px; display: grid; place-items: center;
          background: none; border: none; color: var(--muted); cursor: pointer; border-radius: 6px;
          transition: color 0.15s ease;
        }
        .eye-btn:hover { color: var(--ink); }
        .eye-btn svg { width: 17px; height: 17px; }

        .submit-btn {
          margin-top: var(--sp-2); width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 13px; border: none; border-radius: 11px; color: #ffffff;
          background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
          font-size: 14.5px; font-weight: 650; cursor: pointer;
          transition: filter 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease;
          box-shadow: 0 14px 28px -14px rgba(255,106,61,0.55);
        }
        .submit-btn:hover:not(:disabled) { filter: brightness(1.05); box-shadow: 0 16px 32px -12px rgba(255,106,61,0.6); }
        .submit-btn:active:not(:disabled) { transform: translateY(1px); }
        .submit-btn:disabled { opacity: 0.5; cursor: default; box-shadow: none; }

        .spin-icon {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid rgba(17,17,17,0.25); border-top-color: var(--ink);
          animation: spin 0.7s linear infinite;
        }
        .spin-icon.light { border-color: rgba(255,255,255,0.35); border-top-color: #ffffff; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .note { font-size: 12.5px; margin: var(--sp-4) 0 0; line-height: 1.5; }
        .note-err { color: #dc2626; } .note-ok { color: #047857; }

        .switch {
          background: none; border: none; cursor: pointer; color: var(--muted);
          font-size: 12.5px; font-weight: 500; margin-top: var(--sp-5); padding: 0;
        }
        .switch-accent { color: var(--primary); font-weight: 600; transition: color 0.15s ease; }
        .switch:hover .switch-accent { color: var(--accent); text-decoration: underline; }

        button:focus-visible, .text-input:focus-visible, a:focus-visible {
          outline: 2px solid var(--primary); outline-offset: 2px;
        }

        @media (max-width: 1240px) {
          .feature-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 900px) {
          .landing { flex-direction: column; }
          .hero-panel { flex: none; padding: var(--sp-6) var(--sp-5); }
          .feature-grid { grid-template-columns: 1fr 1fr; }
          .stats-row { flex-wrap: wrap; row-gap: var(--sp-4); }
          .auth-panel { flex: none; padding: var(--sp-6) var(--sp-4) var(--sp-7); }
          .auth-card { box-shadow: none; border: none; padding: 0; }
        }

        @media (max-width: 560px) {
          .feature-grid { grid-template-columns: 1fr; }
          .feature-body { display: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .wordmark, .eyebrow, .headline, .subhead, .feature-grid, .stats-row, .auth-card { animation: none; opacity: 1; }
          .spin-icon { animation: none; }
        }
      `}</style>
    </div>
  );
}

function NetworkArt() {
  const nodes = [
    { x: 60, y: 90, r: 4 }, { x: 140, y: 40, r: 3 }, { x: 230, y: 120, r: 6, glow: true },
    { x: 320, y: 60, r: 3 }, { x: 380, y: 160, r: 4 }, { x: 470, y: 90, r: 5, glow: true },
    { x: 540, y: 200, r: 3 }, { x: 200, y: 220, r: 3 }, { x: 100, y: 260, r: 4 },
    { x: 420, y: 280, r: 6, glow: true }, { x: 300, y: 320, r: 3 }, { x: 60, y: 340, r: 3 },
  ];
  const edges: [number, number][] = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[2,7],[7,8],[4,9],[9,10],[7,10],[10,11],[8,11]];
  return (
    <svg className="net-art" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 }}>
      <defs>
        <filter id="nodeGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      {edges.map(([a, b], i) => (
        <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="rgba(245,243,240,0.16)" strokeWidth="1" />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          {n.glow && <circle cx={n.x} cy={n.y} r={n.r * 3} fill="#ff6a3d" opacity="0.35" filter="url(#nodeGlow)" />}
          <circle cx={n.x} cy={n.y} r={n.r} fill={n.glow ? "#ff8a4d" : "rgba(245,243,240,0.4)"} />
        </g>
      ))}
    </svg>
  );
}

function FeatureGlyph({ name }: { name: "scout" | "docs" | "bulk" | "index" }) {
  if (name === "scout") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    );
  }
  if (name === "docs") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />
      </svg>
    );
  }
  if (name === "bulk") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function MailGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2.5" /><path d="m2.5 5.5 9.5 7 9.5-7" />
    </svg>
  );
}

function LockGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10.5" width="16" height="10.5" rx="2.2" /><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
    </svg>
  );
}

function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19.5C5 19.5 1 12 1 12a19.4 19.4 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4.5c7 0 11 7.5 11 7.5a19.4 19.4 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.02l7.73 6c4.51-4.18 7.09-10.36 7.09-17.49z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.97 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
