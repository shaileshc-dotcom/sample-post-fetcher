# CLAUDE.md — GUESTPOSTLINKS Internal Tools

Reference doc for Claude Code sessions working in this repo. Read this fully
before making changes. See [CLAUDE_CODE_BUILD_PLAN.md](CLAUDE_CODE_BUILD_PLAN.md)
for the active SaaS-upgrade roadmap and phase status.

## What this is

Internal multi-user tool for **GUESTPOSTLINKS / AMRYTT Media**. Members log in,
fetch sample articles from publisher domains (single or bulk, across a 60k+
domain inventory), optionally run AI analysis, and export a sales sheet in a
specific format. Being upgraded from a single-purpose tool into a multi-team
SaaS platform (roles, admin panel, new modules) — see the build plan.

## Tech stack (verified, not assumed)

- **Next.js 16.2.10** (App Router) — this is the current `latest` on npm as of
  this doc; there is no newer patch to update to right now.
- React 18.3, TypeScript (strict, `tsc --noEmit`), Tailwind CSS 3
- **Supabase**: `@supabase/ssr` + `@supabase/supabase-js` — email/password auth,
  Postgres with Row Level Security
- **OpenAI** (`gpt-4o-mini` by default) — optional; AI features are cost-capped
  and fail open if `OPENAI_API_KEY` is absent
- **googleapis** — Google Docs/Drive export via a service account into a shared
  drive (`GOOGLE_SHARED_DRIVE_ID`)
- **SpeedyIndex API** — index checker
- Fetch stack: `axios`, `cheerio`, `rss-parser`, `fast-xml-parser`, `p-limit`
  for bounded concurrency

## Project structure

```
src/
  proxy.ts                          # session refresh + route protection (was middleware.ts)
  app/
    layout.tsx, globals.css         # root layout + theme
    login/page.tsx                  # auth (sign in / sign up)
    auth/callback/route.ts          # email-confirm / OAuth redirect
    (app)/                          # authenticated shell (sidebar)
      layout.tsx                    # redirects to /login if signed out
      page.tsx                      # Dashboard
      search/page.tsx               # Single Search
      bulk/page.tsx                 # Bulk Search
      history/page.tsx              # History
      settings/page.tsx             # Settings
      insertion/page.tsx, insertion-log/page.tsx
      index-check/page.tsx
      doc-studio/page.tsx
    api/
      fetch/route.ts                # main fetch endpoint (default 3 posts)
      analyze/route.ts              # domain analysis
      doc/route.ts, generate-doc/route.ts
      insertion/route.ts, index-check/route.ts
  components/ sidebar.tsx, results-table.tsx, category-select.tsx, avatar.tsx
  lib/
    types.ts, http.ts, export.ts, settings.ts, categories.ts, profile.ts
    insertion.ts, google-docs.ts, google-formatter.ts, google-key.ts, speedyindex.ts
    ai/ enrich.ts, classify.ts
    hooks/ useBulkRunner.ts, useIndexCheck.ts
    supabase/ server.ts, client.ts, middleware.ts
    fetchers/ discover, rss, sitemap, homepage, article-meta, domain-analysis,
              collect-pages, page-content, orchestrator
supabase/schema.sql                 # tables + RLS
```

## Current architecture — state of things as of this doc

- **Auth + roles (Phase 1, done)**: Supabase email/password. `proxy.ts` (was
  `middleware.ts` — renamed per Next 16's deprecation, see below) refreshes
  the session and redirects signed-out users. On top of that, every page and
  API route is gated by role via `src/lib/current-role.ts`
  (`getCurrentRole()`, server-only, request-memoized),
  `src/components/require-role.tsx` (`<RequireRole roles={[...]}>` for
  pages, applied via a small per-route `layout.tsx` since all existing pages
  are `"use client"`), and `src/lib/api-guard.ts` (`requireApiRole()` for
  Route Handlers). The role → route mapping lives in one place:
  `src/lib/roles.ts`'s `ROUTE_ROLES`. Four roles: `admin`, `seo`,
  `order_processing`, `content`. New signups default to `role = 'content'`,
  `active = false` — they land on `/pending` until an admin activates them;
  this is a deliberate change from the old "instant access on signup"
  behavior described in the README.
- **Database tables that exist today**: `search_history`, `favorites`,
  `fetch_cache`, and `profiles` — all with RLS scoped to
  `auth.uid() = user_id` (profiles additionally has admin-wide policies via a
  `SECURITY DEFINER is_admin()` helper, plus a trigger that blocks non-admins
  from changing their own `role`/`team`/`active`/`email` even though they can
  update their own row for `display_name`/`avatar`). `profiles` predates
  Phase 1 (it already existed for display_name/avatar) and was *extended*,
  not created fresh — see Phase 1 in the build plan for the full migration.
- **Settings are per-browser, not per-user**: [src/lib/settings.ts](src/lib/settings.ts)
  reads/writes a JSON blob to `localStorage` (key `sps_settings`) — posts-per-domain,
  bulk concurrency, AI-on-by-default, default prompt, auto-index toggles. None
  of this is stored in Supabase today. Splitting this into admin-controlled
  globals vs. per-user values (DB-backed) is planned — see Phase 5.
- **Theme**: currently a **dark** theme ("Signal" — near-black navy background,
  amber/rose gradient accent) defined in [src/app/globals.css](src/app/globals.css).
  Replacing this with a light professional theme is planned — see Phase 2.
- **Bulk search architecture**: orchestrated client-side — the browser fires
  one bounded-concurrency request per domain to `/api/fetch` rather than using
  a server-side job queue, specifically to avoid Vercel's serverless function
  timeout. This is intentional, not a bug (see README "Architecture note").
- **Fetch engine**: RSS/Atom → Sitemap → Homepage → Category, cheapest method
  first, stops once enough posts are found.

## Environment variables

Defined in `.env.local` (gitignored, never commit). See `.env.example` for the
full list of names:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY` (optional), `OPENAI_MODEL`
- `SPEEDYINDEX_API_KEY` (optional)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
  `GOOGLE_SHARED_DRIVE_ID`
- `MISSIVE_API_TOKEN` — planned for Phase 8, not yet added
- A future Supabase **service-role key** will be needed for Phase 6 (admin user
  management). It must stay server-only and is more powerful than the anon
  key — it bypasses RLS entirely. Never expose it to the client, never log it.

## Commands

```bash
npm install
npm run dev         # http://localhost:3000 → lands on /login
npm run typecheck    # tsc --noEmit — run before every commit
npm run build        # next build — run before every commit
npm run lint
```

## Git / deploy

- Repo is already connected: `origin` = `https://github.com/shaileshc-dotcom/sample-post-fetcher.git`,
  branch `main`, tracking `origin/main`.
- Vercel is connected to this GitHub repo and auto-deploys on push to `main`.
- Use the **Pro plan** function timeout (60s) — single fetches with AI can
  approach the Hobby 10s limit on slow sites.

## Session rules (apply every session, not just during the SaaS upgrade)

- Make one focused change per session/phase. Show the plan and file diffs
  before applying.
- After every change, run `npx tsc --noEmit` and `npm run build`; fix all
  errors before finishing.
- Enforce access control in the database (Supabase RLS), never UI-only.
- Never commit secrets. Keep `.env.local` gitignored. Keep the service-role
  key (once added) server-only.
- Update this file and `CLAUDE_CODE_BUILD_PLAN.md` as the architecture evolves
  — especially when a phase changes the auth model, schema, or settings
  storage described above.
