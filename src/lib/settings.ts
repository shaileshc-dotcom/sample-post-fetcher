export interface AppSettings {
  postsPerDomain: number;
  concurrency: number;
  aiDefault: boolean;
  defaultPrompt: string;
  autoIndexCheck: boolean;   // auto-run an index check when insertion results appear
  autoIndexSubmit: boolean;  // auto-submit non-indexed pages for indexing on doc generate
}

const KEY = "sps_settings";
const DEFAULTS: AppSettings = { postsPerDomain: 3, concurrency: 8, aiDefault: false, defaultPrompt: "", autoIndexCheck: true, autoIndexSubmit: false };

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
