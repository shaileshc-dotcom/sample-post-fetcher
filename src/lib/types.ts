// Central type definitions for the Sample Post Fetcher.

export type FetchMethod =
  | "rss"
  | "sitemap"
  | "homepage"
  | "category"
  | "puppeteer"   // phase 2 (see README roadmap)
  | "openai"
  | "jina"        // phase 2
  | "firecrawl";  // phase 2

export interface Article {
  url: string;
  title: string;
  publishedDate: string | null;
  author: string | null;
  category: string | null;
  featuredImage: string | null;
  wordCount: number | null;
  readingTimeMin: number | null;
  metaDescription: string | null;
  language: string | null;
  statusCode: number | null;
  lastModified: string | null;
  method: FetchMethod;        // which method surfaced this article
  ai?: ArticleAI;             // populated only when enrichment is requested
}

export interface ArticleAI {
  summary: string;
  topic: string;
  writingStyle: string;
  niche: string;
  targetAudience: string;
  seoQuality: number;          // 0-100
  contentQuality: number;      // 0-100
  spamScore: number;           // 0-100 (higher = spammier)
  guestPostFriendly: boolean;
}

export interface DomainAnalysis {
  domain: string;
  https: boolean;
  robotsTxt: boolean;
  sitemap: boolean;
  rss: boolean;
  wordpress: boolean;
  cms: string | null;
  server: string | null;
  ip: string | null;
  cloudflare: boolean;
  responseTimeMs: number | null;
  redirects: number;
  finalStatus: number | null;
}

export interface FetchOptions {
  limit?: number;              // stop when this many articles found (default 20)
  enrichWithAI?: boolean;      // run OpenAI summary/scoring per article
  enrichLimit?: number;        // cap AI calls to control cost (default 5)
  timeoutMs?: number;          // per-request timeout (default 12000)
  // Advanced filters
  sinceDays?: number | null;   // 7 | 30 | 365
  hasImage?: boolean;
  hasAuthor?: boolean;
  minWords?: number | null;
  maxWords?: number | null;
  englishOnly?: boolean;
  prompt?: string;            // free-text intent; AI uses it to pick the most relevant posts
}

export interface FetchResult {
  domain: string;
  articles: Article[];
  methodUsed: FetchMethod[];
  durationMs: number;
  errors: string[];
  truncated: boolean;
}
