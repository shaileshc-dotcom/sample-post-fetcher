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
**Status: `[ ]` not started**

4 roles: `admin`, `seo`, `order_processing`, `content`. Admin sees everything;
each team sees only its own sections. **Enforce in the database (RLS), not
just the UI.**

- New Supabase table `profiles` (or `members`): `user_id`, `email`,
  `full_name`, `role` (enum), `team`, `active`, `created_at`.
- RLS: users can read their own profile; admins can read/update all.
- Server helper `getCurrentRole()` and a `<RequireRole roles={[...]}>` guard.
- Gate every page and API route by role:
  - `order_processing`: Search (single), Bulk Search, Indexing, Link Insertion, Doc Studio
  - `seo`: Article Generator, Backlink Monitor, Doc Studio
  - `content`: Doc Studio
  - `admin`: everything, plus an Admin panel
- Redirect users who lack access.
- Note: today there is **no** `profiles` table and **no** role concept at all
  (see CLAUDE.md) — this is entirely new, not a modification of existing
  access logic.

## Phase 2 — Light, professional UI theme
**Status: `[ ]` not started**

Replace the current **dark** theme ("Signal" — near-black navy, amber/rose
gradient, defined in `src/app/globals.css`) with a light, professional SaaS
theme: clean neutral background (#f7f8fa / white cards), slate text, one
confident brand accent derived from the orange logo (e.g. `#ef6c3a`) plus a
secondary indigo for interactive accents. WCAG-AA contrast. Update design
tokens, sidebar, top bar, cards, tables, buttons, inputs, login page. Subtle
motion (button press states, hover lifts, 150–250ms transitions). Keep all
functionality.

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
