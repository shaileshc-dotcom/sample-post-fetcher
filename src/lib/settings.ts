export type Theme = "light" | "dark" | "system";

// autoIndexCheck/autoIndexSubmit (admin-only global) and defaultPrompt
// (per-user) moved to Supabase (see lib/app-settings.ts) — enforcing
// "admin writes global, users write only their own" needs RLS, which a
// per-browser localStorage value can't provide.
export interface AppSettings {
  postsPerDomain: number;
  concurrency: number;
  aiDefault: boolean;
  theme: Theme;
}

const KEY = "sps_settings";
const DEFAULTS: AppSettings = { postsPerDomain: 3, concurrency: 8, aiDefault: false, theme: "light" };

export function getSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: AppSettings): void {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

/** Resolves "system" against the OS preference and stamps <html data-theme>. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}
