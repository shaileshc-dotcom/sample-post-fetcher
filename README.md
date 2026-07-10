# Sample Post Fetcher — SaaS build

Internal multi-user tool for **GUESTPOSTLINKS / AMRYTT Media**. Log in, fetch
sample articles from any publisher domain (single or bulk), analyze with AI, and
export a clean sales sheet. Built to run across a 60k+ domain inventory.

## Features in this build

- **Member login** (Supabase Auth — email + password) with protected routes.
- **App shell / SaaS layout**: sidebar nav, dashboard with live stat cards.
- **Single Search**: 3 sample posts per domain (configurable), template chips,
  filters, AI analysis, and a publisher snapshot insight.
- **Bulk Search**: paste hundreds of domains, run concurrently with a live
  progress bar, speed + ETA, and **Pause / Resume / Cancel / Retry Failed**.
- **3 posts per domain** by default (change in Settings).
- **History**: every search is logged with the domain, **who ran it**, articles
  found, method, duration, and status — with **Re-run / Favorite / Delete**.
- **Export in the exact format ops needs**:
  > Column **A = domain**, Column **B = the 3 article URLs, comma-separated** in
  > one cell — one row per domain. Works for single *and* bulk. (Also: full
  > per-article CSV, JSON, and Markdown.)
- **Settings**: posts-per-domain, bulk concurrency, AI-on-by-default — saved per
  browser.
- **Fetch engine** (unit-tested): RSS/Atom → Sitemap → Homepage → Category,
  cheapest-first, stops when enough posts are found. OpenAI enrichment is
  cost-capped and fails open.

## Architecture note (why bulk works on Vercel)

Bulk fetching is orchestrated **in the browser**: it fires one fast request per
domain to `/api/fetch` with bounded concurrency. Each serverless call handles a
single domain (~3 posts, fast), so you never hit Vercel's function timeout — no
extra job-queue infra needed for the volumes you run. (For truly massive nightly
batches, see the Roadmap.)

## Setup

```bash
npm install
```

Create `.env.local` (don't rely on copying the dotfile — just paste this):

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
OPENAI_API_KEY=sk-...        # optional; AI analysis disabled if absent
OPENAI_MODEL=gpt-4o-mini
```

1. Create a Supabase project → run **`supabase/schema.sql`** in the SQL Editor.
2. Supabase → **Authentication → Providers → Email**: for an internal tool,
   turn **off "Confirm email"** so teammates can sign in instantly. (Leave it on
   if you want email verification — the app handles both.)
3. (Optional) add `OPENAI_API_KEY` for AI analysis.

```bash
npm run dev        # http://localhost:3000  → you'll land on /login
npm run typecheck  # strict TS check (recommended before deploy)
```

First run: open the app, click **Sign up**, create your account, and you're in.

## Deploy to Vercel

1. Push to GitHub, import into Vercel.
2. Add the same env vars in **Settings → Environment Variables**.
3. In Supabase **Authentication → URL Configuration**, add your Vercel URL to the
   allowed redirect URLs.
4. Deploy. Use the **Pro plan** for the 60s function timeout (single fetches with
   AI can approach the Hobby 10s limit on slow sites).

## Project structure

```
src/
  middleware.ts                     # session refresh + route protection
  app/
    layout.tsx, globals.css         # root layout + theme
    login/page.tsx                  # auth (sign in / sign up)
    auth/callback/route.ts          # email-confirm / OAuth redirect
    (app)/                          # authenticated shell (sidebar)
      layout.tsx                    # redirects to /login if signed out
      page.tsx                      # Dashboard
      search/page.tsx               # Single Search
      bulk/page.tsx                 # Bulk Search
      history/page.tsx              # History (run-by, re-run, fav, delete)
      settings/page.tsx             # Settings
    api/
      fetch/route.ts                # main fetch endpoint (default 3 posts)
      analyze/route.ts              # domain analysis
  components/sidebar.tsx, results-table.tsx
  lib/
    types.ts http.ts export.ts settings.ts
    hooks/useBulkRunner.ts          # client bulk orchestration
    ai/enrich.ts                    # OpenAI (cost-capped)
    supabase/server.ts, client.ts, middleware.ts
    fetchers/ discover · rss · sitemap · homepage · article-meta
              · domain-analysis · orchestrator
supabase/schema.sql                 # tables + RLS (history, favorites, cache)
```

## Roadmap

- Server-side queue (Inngest / Upstash QStash) for scheduled nightly bulk runs
  of the full inventory.
- Result caching (the `fetch_cache` table already exists) to skip re-fetching.
- Puppeteer fallback for JS-rendered / Cloudflare-protected sites.
- Favorites folders UI + team-shared workspaces.
- DR / traffic estimates via a 3rd-party SEO API.
