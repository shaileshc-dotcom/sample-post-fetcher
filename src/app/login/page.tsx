"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";

const DOTS = [
  [8, 20], [16, 68], [24, 40], [33, 12], [41, 82], [12, 88],
  [58, 24], [66, 60], [72, 15], [80, 74], [88, 34], [92, 55],
  [48, 46], [30, 58], [70, 88], [85, 10], [6, 50], [95, 70],
];
const TOOLS = [
  "Publisher Scout", "Bulk Fetch", "Link Insertion", "Index Checker",
  "AI Ranking", "Sample Posts", "Guest-Post Fit", "Backlink Signals",
];

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Close modal on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openAuth(m: "signin" | "signup") {
    setMode(m);
    setError(null);
    setMsg(null);
    setOpen(true);
  }

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

  return (
    <div className="landing">
      {/* Background */}
      <div className="bg-layer">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="grid-overlay" />
        {mounted && DOTS.map(([x, y], i) => (
          <span key={i} className="dot" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.35}s` }} />
        ))}
      </div>

      {/* Top nav */}
      <nav className="nav">
        <div className="brand">
          <span className="mark">◆</span>
          <span className="brand-name">GUESTPOSTLINKS</span>
        </div>
        <div className="nav-actions">
          <button className="nav-signin" onClick={() => openAuth("signin")}>Sign in</button>
          <button className="nav-getstarted" onClick={() => openAuth("signup")}>Get started</button>
        </div>
      </nav>

      {/* Hero */}
      <main className="hero">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="hero-inner"
        >
          <div className="pill-eyebrow">◇ Internal Suite · Est. 2026</div>
          <h1 className="hero-title">
            <span className="grad-text">SCOUT. PLACE. INDEX.</span>
            <span className="hero-outline">ALL IN ONE PLACE.</span>
          </h1>
          <p className="hero-desc">
            AI-powered outreach tooling for GUESTPOSTLINKS. Scout publishers, find
            the right placement pages, and verify indexing — one dashboard.
          </p>
          <div className="feature-pills">
            <span className="fpill"><i style={{ background: "#34d6a0" }} />Publisher Scout</span>
            <span className="fpill"><i style={{ background: "#f0b94e" }} />AI Link Ranking</span>
            <span className="fpill"><i style={{ background: "#8b7bf0" }} />Index Checker</span>
          </div>
          <div className="hero-cta">
            <button className="cta-primary" onClick={() => openAuth("signup")}>Get started</button>
            <button className="cta-ghost" onClick={() => openAuth("signin")}>Sign in →</button>
          </div>
        </motion.div>
      </main>

      {/* Ticker */}
      <div className="ticker-wrap">
        <div className="ticker">
          {[...TOOLS, ...TOOLS].map((t, i) => <span key={i} className="ticker-item">✦ {t}</span>)}
        </div>
      </div>

      {/* Auth modal (same page, no redirect) */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="auth-card"
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
              <div className="scanbar" />
              <h2 className="auth-title">{mode === "signin" ? "Sign in" : "Create account"}</h2>
              <p className="auth-sub">GUESTPOSTLINKS · internal tools</p>

              <div className="fields">
                <label className="field">
                  <span className="field-label">Email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@amrytt.com" className="auth-input" autoComplete="email" autoFocus />
                </label>
                <label className="field">
                  <span className="field-label">Password</span>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••••"
                    className="auth-input" autoComplete={mode === "signin" ? "current-password" : "new-password"} />
                </label>
                <button onClick={submit} disabled={loading || !email || !password} className="auth-btn">
                  {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
                </button>
              </div>

              {error && <p className="note note-err">{error}</p>}
              {msg && <p className="note note-ok">{msg}</p>}

              <button
                onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setMsg(null); }}
                className="switch"
              >
                {mode === "signin" ? "Need an account? Create one" : "Have an account? Sign in"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .landing { position: fixed; inset: 0; display: flex; flex-direction: column; background: #080a12; color: #e8ecf5; overflow: hidden; font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif; }
        .bg-layer { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
        .aurora { position: absolute; width: 700px; height: 700px; border-radius: 50%; filter: blur(140px); opacity: 0.45; }
        .aurora-a { background: #f0b94e; top: -280px; left: -120px; animation: drift-a 18s ease-in-out infinite alternate; }
        .aurora-b { background: #ff6b8a; bottom: -300px; right: -100px; opacity: 0.3; animation: drift-b 22s ease-in-out infinite alternate; }
        @keyframes drift-a { to { transform: translate(120px,90px) scale(1.1); } }
        @keyframes drift-b { to { transform: translate(-100px,-70px) scale(1.15); } }
        .grid-overlay { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse 80% 75% at 50% 42%, #000 30%, transparent 80%); }
        .dot { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: rgba(240,185,78,0.7); box-shadow: 0 0 8px rgba(240,185,78,0.6); animation: twinkle 3.4s ease-in-out infinite; }
        @keyframes twinkle { 0%,100% { opacity: 0.15; } 50% { opacity: 0.9; } }

        .nav { position: relative; z-index: 3; display: flex; align-items: center; justify-content: space-between; padding: 20px 40px; }
        .brand { display: flex; align-items: center; gap: 10px; }
        .mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg,#f0b94e,#ff6b8a); color: #241300; font-weight: 700; font-size: 13px; }
        .brand-name { font-family: var(--font-display), sans-serif; font-weight: 700; font-size: 15px; letter-spacing: 0.02em; }
        .nav-actions { display: flex; align-items: center; gap: 10px; }
        .nav-signin { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); color: #e8ecf5; font-size: 13px; font-weight: 500; padding: 8px 16px; border-radius: 10px; cursor: pointer; transition: background 0.14s ease; }
        .nav-signin:hover { background: rgba(255,255,255,0.08); }
        .nav-getstarted { background: linear-gradient(135deg,#f0b94e,#ff6b8a); border: none; color: #241300; font-size: 13px; font-weight: 600; padding: 8px 18px; border-radius: 10px; cursor: pointer; transition: filter 0.14s ease; box-shadow: 0 8px 22px -10px rgba(240,185,78,0.6); }
        .nav-getstarted:hover { filter: brightness(1.06); }

        .hero { position: relative; z-index: 1; flex: 1; display: grid; place-items: center; text-align: center; padding: 0 24px; }
        .hero-inner { max-width: 820px; }
        .pill-eyebrow { display: inline-block; font-family: var(--font-mono), monospace; font-size: 10.5px; letter-spacing: 0.2em; color: #f0b94e; border: 1px solid rgba(240,185,78,0.3); border-radius: 999px; padding: 6px 14px; margin-bottom: 26px; }
        .hero-title { font-family: var(--font-display), sans-serif; font-weight: 700; line-height: 0.98; letter-spacing: -0.03em; margin: 0; display: flex; flex-direction: column; align-items: center; }
        .hero-title .grad-text { font-size: clamp(40px, 7vw, 92px); }
        .hero-outline { font-size: clamp(34px, 6vw, 80px); color: #232a3a; -webkit-text-stroke: 1px rgba(255,255,255,0.14); }
        .hero-desc { color: #98a1b4; font-size: 16px; max-width: 540px; margin: 24px auto 0; line-height: 1.55; }
        .feature-pills { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 28px; }
        .fpill { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #c3cad8; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); border-radius: 999px; padding: 7px 14px; }
        .fpill i { width: 6px; height: 6px; border-radius: 50%; }
        .hero-cta { display: flex; justify-content: center; gap: 12px; margin-top: 34px; }
        .cta-primary { background: linear-gradient(135deg,#f0b94e,#ff6b8a); border: none; color: #241300; font-size: 14px; font-weight: 600; padding: 12px 26px; border-radius: 12px; cursor: pointer; transition: filter 0.14s ease, transform 0.1s ease; box-shadow: 0 12px 30px -12px rgba(240,185,78,0.6); }
        .cta-primary:hover { filter: brightness(1.06); } .cta-primary:active { transform: translateY(1px); }
        .cta-ghost { background: transparent; border: 1px solid rgba(255,255,255,0.14); color: #e8ecf5; font-size: 14px; font-weight: 500; padding: 12px 22px; border-radius: 12px; cursor: pointer; transition: background 0.14s ease; }
        .cta-ghost:hover { background: rgba(255,255,255,0.05); }

        .ticker-wrap { position: relative; z-index: 1; overflow: hidden; border-top: 1px solid rgba(255,255,255,0.06); padding: 16px 0; mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
        .ticker { display: flex; gap: 34px; white-space: nowrap; animation: marquee 24s linear infinite; padding-left: 34px; }
        .ticker-item { font-family: var(--font-mono), monospace; font-size: 11px; letter-spacing: 0.12em; color: #6f7788; }
        @keyframes marquee { to { transform: translateX(-50%); } }

        /* Modal */
        .modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 24px; background: rgba(4,5,10,0.6); backdrop-filter: blur(6px); }
        .auth-card { position: relative; width: 100%; max-width: 400px; padding: 34px 32px 26px; border-radius: 20px; background: linear-gradient(180deg, rgba(21,25,38,0.96), rgba(12,15,22,0.96)); border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 50px 100px -30px rgba(0,0,0,0.9); overflow: hidden; }
        .modal-close { position: absolute; top: 14px; right: 14px; width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #868fa3; cursor: pointer; font-size: 12px; transition: all 0.14s ease; }
        .modal-close:hover { color: #e8ecf5; background: rgba(255,255,255,0.05); }
        .scanbar { position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, #f0b94e, #ff6b8a, transparent); animation: scan 3.4s ease-in-out infinite; }
        @keyframes scan { 0%,100% { opacity: 0.25; transform: translateX(-25%); } 50% { opacity: 1; transform: translateX(25%); } }
        .auth-title { font-family: var(--font-display), sans-serif; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
        .auth-sub { color: #868fa3; font-size: 12px; margin: 6px 0 22px; font-family: var(--font-mono), monospace; letter-spacing: 0.06em; }
        .fields { display: flex; flex-direction: column; gap: 13px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field-label { font-family: var(--font-mono), monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #7e8696; }
        .auth-input { width: 100%; background: rgba(8,10,18,0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 11px; padding: 12px 14px; color: #e8ecf5; font-size: 14px; outline: none; transition: border-color 0.16s ease, box-shadow 0.16s ease; }
        .auth-input::placeholder { color: #5c6376; }
        .auth-input:focus { border-color: #f0b94e; box-shadow: 0 0 0 3px rgba(240,185,78,0.14); }
        .auth-btn { margin-top: 5px; width: 100%; padding: 12px; border: none; border-radius: 11px; background: linear-gradient(135deg,#f0b94e,#ff6b8a); color: #241300; font-size: 14px; font-weight: 600; cursor: pointer; transition: filter 0.14s ease, transform 0.1s ease; box-shadow: 0 10px 26px -12px rgba(240,185,78,0.6); }
        .auth-btn:hover:not(:disabled) { filter: brightness(1.05); }
        .auth-btn:active:not(:disabled) { transform: translateY(1px); }
        .auth-btn:disabled { opacity: 0.5; cursor: default; box-shadow: none; }
        .note { font-size: 12px; margin: 13px 0 0; }
        .note-err { color: #f47171; } .note-ok { color: #34d6a0; }
        .switch { background: none; border: none; cursor: pointer; color: #868fa3; font-size: 12px; margin-top: 18px; padding: 0; transition: color 0.14s ease; }
        .switch:hover { color: #e8ecf5; }

        @media (max-width: 640px) {
          .nav { padding: 16px 20px; }
          .nav-signin { display: none; }
        }
        @media (prefers-reduced-motion: reduce) { .aurora, .dot, .scanbar, .ticker { animation: none; } }
      `}</style>
    </div>
  );
}
