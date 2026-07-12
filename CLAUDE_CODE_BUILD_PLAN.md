# CLAUDE_CODE_BUILD_PLAN.md — SaaS Upgrade

Source of truth for the multi-phase upgrade of GUESTPOSTLINKS Internal Tools
from a single-purpose fetch tool into a multi-team SaaS platform. See
[CLAUDE.md](CLAUDE.md) for current architecture and session rules.

Work through phases **in order**, one phase per session. After each phase:
review the diff, run `npx tsc --noEmit` and `npm run build`, then commit &
push (Vercel auto-deploys). Do not start the next phase until the current one
builds and works.

Golden rules for every session:
- Make one focused change, then run `npx tsc --noEmit` and `npm run build` and
  fix errors before finishing.
- Show the plan and the file changes before applying.
- Never commit secrets; keep `.env.local` gitignored; service-role keys and
  third-party API tokens are server-only.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — Housekeeping
**Status: `[x]` done (2026-07-12) — no Next.js upgrade needed, findings only**

Original goal: update Next.js to the latest patched version to fix a security
advisory. On investigation: this project is already on **Next.js 16.2.10**,
which is the current `latest` tag on npm — there is no newer version to update
to. `npm audit` shows 7 moderate-severity advisories, none of which are fixed
by a Next.js version bump:
- `postcss` (bundled inside `next/node_modules/postcss`, <8.5.10) — XSS via
  unescaped `</style>` in stringified output (GHSA-qx2v-qp2m-jg93). No fix
  available without a Next.js major downgrade (nonsensical) — this is Next's
  own bundled copy, not something we control directly.
- `fast-xml-parser` (<5.7.0) — XML comment/CDATA injection (GHSA-gh4j-gqv2-49f6).
  Fix available but is a semver-major bump (v4→v5).
- `googleapis` / `googleapis-common` / `gaxios` (via `uuid`) — fix available
  but is a semver-major bump (v144→v173).

None of these are currently exploitable in an obvious way for this app (no
user-supplied CSS is stringified through postcss at runtime; the XML parser
processes RSS/sitemap feeds we control the domain list for, not arbitrary
user input at request time) — but they're tracked here rather than silently
ignored. Left as a separate decision for a future session/phase since fixing
them means major-version bumps to `fast-xml-parser` and `googleapis`, which
is exactly the kind of one-focused-change-at-a-time work this plan is meant
to avoid bundling into "Phase 0: bump Next.js."

## Phase 1 — Roles, teams & access control (FOUNDATION)
**Status: `[x]` done — SQL migration run in Supabase, app code applied, test plan passed**

4 roles: `admin`, `seo`, `order_processing`, `content`. Admin sees everything;
each team sees only its own sections. **Enforced in the database (RLS), not
just the UI.**

What actually shipped (see CLAUDE.md "Current architecture" for the full
picture):
- Extended the **existing** `profiles` table (it predated this phase,
  undocumented in `schema.sql` until now) with `email`, `role` (new
  `user_role` enum: admin/seo/order_processing/content), `team`, `active`,
  `created_at` — kept `display_name`/`avatar` as-is rather than adding a
  redundant `full_name` column.
- RLS: users read/update their own row; admins read/update all rows (via a
  `SECURITY DEFINER is_admin()` helper to avoid recursive-policy issues). A
  `BEFORE UPDATE` trigger strips any attempt to change `role`/`team`/`active`/
  `email` unless the caller is currently an admin — even though the
  self-update policy has to stay open for the existing display-name/avatar
  editing to keep working.
- New signups default to `role = 'content'`, `active = false` (pending admin
  approval) — a deliberate change from the old "instant access on signup"
  behavior, since roles now matter. Existing pre-migration rows were **not**
  blanket-activated; only the first admin's row was activated via a one-off
  bootstrap `UPDATE`. Everyone else stays pending until manually approved
  (roster-based SQL or the Phase 6 admin panel).
- `src/lib/roles.ts` (`Role` type + `ROUTE_ROLES` map — single source of
  truth), `src/lib/current-role.ts` (`getCurrentRole()`, server-only,
  request-memoized), `src/lib/api-guard.ts` (`requireApiRole()` for Route
  Handlers), `src/components/require-role.tsx` (`<RequireRole>` for pages).
- Gating applied via a small per-route `layout.tsx` in each gated segment
  (all existing pages are `"use client"`, so gating lives one level up
  rather than inside the pages themselves) plus `requireApiRole()` at the
  top of every gated API route:
  - `order_processing` + `admin`: `/search`, `/bulk`, `/history`,
    `/insertion`, `/insertion-log`, `/index-check`, and their backing routes
    `/api/fetch`, `/api/analyze`, `/api/insertion`, `/api/generate-doc`,
    `/api/index-check`
  - `order_processing` + `seo` + `content` + `admin`: `/doc-studio`,
    `/api/doc`
  - all four roles: `/` (Dashboard), `/settings`
- New `/pending` page (outside the `(app)` route group) for inactive users,
  with a sign-out control.
- Minimal role-based sidebar filtering added now (full team regroup/rename
  still Phase 3).
- `src/middleware.ts` → `src/proxy.ts` via the official `@next/codemod`
  (pure rename, matcher/logic untouched — required since Next 16 deprecated
  the `middleware` convention).
- Side effect fixed as a consequence of doing this correctly: `/api/fetch`
  previously had **no auth check at all** on its core scraping logic — now
  closed by `requireApiRole()`.

Verified via: self-escalation attempt (PATCH own role via PostgREST directly,
confirmed trigger reverts it), cross-user read attempt (confirmed RLS returns
zero rows for another user's profile), and an unauthenticated `curl` to
`/api/fetch` (confirmed 401, regression-testing the auth-gap fix above).

## Phase 2 — Light, professional UI theme
**Status: `[x]` done — login page rebuilt, rest of the app retokened, WCAG contrast bug found and fixed**

What shipped, in order:
1. **Login page** ([src/app/login/page.tsx](src/app/login/page.tsx)) — full
   rebuild, not just a recolor: split-screen (dark brand panel + light auth
   card), Google OAuth via `signInWithOAuth` routed through the existing
   `/auth/callback`, a proper typography/spacing scale, real feature cards
   and honest stats (no fabricated numbers), password show/hide, pure-CSS
   entrance animations (no blank-on-load flash). Self-contained token set,
   doesn't touch `globals.css`. Final palette: `#FF6A3D` primary / `#FF8A4D`
   accent / `#FAFBFD` bg / `#E8E8E8` border / `#111111` text / `#6B7280`
   secondary — no indigo.
2. **Contrast bug, found and fixed**: the login submit button and feature
   icons filled `--primary`/`--accent` under white text/glyphs measured
   2.85:1/2.33:1 — below AA even at the relaxed 3:1 large-text threshold.
   Added `--primary-strong` (`#c94716`, 4.78:1) for solid fills; `--primary`/
   `--accent` stay for large display text and non-fill accents, where they
   measure 7–8.5:1 against the dark panel.
3. **Rest of the app** — `globals.css` tokens rewritten to match the login
   page's palette exactly (dropped the earlier draft `#ef6c3a`/indigo
   proposal for consistency with what was actually approved). Same
   `--accent` vs `--accent-strong` split applied everywhere: every small
   colored text/icon/border that had been using `--accent` (2.85:1, fails)
   was moved to `--accent-strong` (4.78:1) — sidebar active nav icon,
   category-select selected item, insertion/insertion-log link colors,
   index-check SERP link, doc-studio/insertion selected-state borders.
   Dark-theme-only remnants fixed: `#241300` "dark text on active tab" →
   white (bulk/doc-studio/index-check), `hover:bg-white/[...]` row/item
   hovers → `--panel-2` (results-table, sidebar, category-select, and the
   dashboard/bulk/index-check/history/insertion-log tables), a washed-out
   `text-red-400/80` delete action → `--danger`, hardcoded error-banner and
   progress-bar tints → token-matched values. Avatar gradient presets left
   untouched (decorative per-user identity colors, not chrome).
   `--positive`/`--accent-2` kept as variable *names* (each referenced
   directly in 5-6 page files) but given new values/meaning rather than
   being renamed, to avoid unnecessary churn.
4. Functionality, routes, and Phase 1 role gating/sidebar filtering
   untouched throughout — restyle only.

Not done as part of this phase (unchanged from the original scope): top bar
(no dedicated component exists; each page's inline header was left as-is),
sidebar team-based regrouping/renaming (that's Phase 3).

## Phase 3 — Reorganize navigation by team + rename features
**Status: `[ ]` not started** (depends on Phase 1's role model)

Group the sidebar by team, rename vague items:
- **Order Processing**: "Publisher Sample Search" (was single search), "Bulk
  Publisher Search" (was bulk), "Indexing", "Link Insertion", "Doc Studio",
  "Missive Search".
- **SEO**: "Article Generator", "Backlink Monitor", "Doc Studio".
- **Admin**: "Team & Access", plus all sections.
- Only show sections the current role can access.

## Phase 4 — Fix bulk & single search filters (date + category)
**Status: `[ ]` not started**

Known bug: date preset (e.g. "older than 3 months", last 7/30/90/365 days) and
category filter don't affect results — results ignore them and always return
latest / all categories. Trace how `sinceDays`/date range and category flow
from UI → hooks (`useBulkRunner.ts`) → `/api/fetch` → fetchers, and fix. Add a
check or logging that proves the filter is actually applied.

## Phase 5 — Settings: admin-controlled vs per-user
**Status: `[ ]` not started**

Today, ALL settings (`postsPerDomain`, `concurrency`, `aiDefault`,
`defaultPrompt`, `autoIndexCheck`, `autoIndexSubmit`) live in `localStorage`
per-browser (see `src/lib/settings.ts`) — nothing is in Supabase. Split into:
1. **Global, admin-only**: `autoIndexCheck`, `autoIndexSubmit` toggles. Stored
   in a settings table row. Non-admins can view read-only.
2. **Per-user**: `defaultPrompt`. Stored per `user_id`.
Enforce with RLS (only admin writes global settings; users write only their
own row). Update Settings UI to reflect who can edit what.

## Phase 6 — Admin panel (user & access management)
**Status: `[ ]` not started** (depends on Phase 1)

Admin-only panel: list all members (role/team/active status); create a new
user (invite by email via Supabase Auth admin API, in a secure server route,
using the **service-role key** — never exposed to the client); edit a
member's role/team; deactivate/reactivate; simple access matrix showing which
role sees which sections. Server-side guards so only admins can call these
routes.

## Phase 7 — Doc Studio additions
**Status: `[ ]` not started**

- **A**: "HTML → Google Doc" tab — paste HTML, convert to a Google Doc in the
  Shared Drive with house style (Outfit; H1 23 / H2 18 / H3 15 bold; body 14;
  justified), preserving lists/tables/links/bold/italic. Return the Doc link.
- **B**: Improve "Word → Google Doc" — drag-and-drop upload for one or many
  `.docx` files, export option (CSV of source filename → resulting Google Doc
  URL), per-file progress.

## Phase 8 — Missive Search
**Status: `[ ]` not started — blocked on `MISSIVE_API_TOKEN`**

Add "Missive Search" under Order Processing. Using the Missive API
(`MISSIVE_API_TOKEN`, server-side only), let users search the inbox for an
exact email/word/phrase and return only threads that actually contain that
term (precise match, not Missive's fuzzy search). Show subject, participants,
date, link to open in Missive. Handle pagination and rate limits.

## Phase 9 — SEO: Article Generator
**Status: `[ ]` not started — blocked on prompt template files**

Add "Article Generator" under SEO. Load prompt templates from `/prompts` (not
yet in the repo). User picks a template, fills inputs (topic, keywords, tone,
length, target URL/anchor), generates via OpenAI, previews, exports to a
Google Doc via Doc Studio's formatter. Save generations to history.

## Phase 10 — SEO: Backlink Monitor
**Status: `[ ]` not started**

For each completed link insertion, store target page URL, our destination
URL, anchor. Checker fetches each page and reports: backlink present?
dofollow/nofollow? index status (via existing index checker). Dashboard with
status badges, last-checked time, re-check button, CSV export. Respect rate
limits; note that some sites block fetching.

## Global — Import/Export everywhere
**Status: `[ ]` not started — run after the relevant phases land**

Audit every data table/list (search results, bulk, insertion log, history,
backlink monitor, article history, admin members) and ensure consistent CSV
import (where it makes sense) and CSV/Excel export, via one shared export
utility.

---

## Open items needing input before their phase

- **Phase 8**: `MISSIVE_API_TOKEN` — to be added directly to `.env.local` and
  Vercel env vars, not pasted in chat.
- **Phase 9**: prompt template files — to be added to `/prompts` in the repo.
- **Phase 6**: Supabase **service-role key** — to be added directly to
  `.env.local` and Vercel env vars, not pasted in chat.
