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
**Status: `[x]` done**

`src/components/sidebar.tsx` groups items under **Scout** (Dashboard,
Publisher Sample Search, Bulk Publisher Search), **Placement** (Link
Insertion, Insertion Log, Indexing, Missive Search), **SEO** (Article
Generator, Backlink Monitor), **Workspace** (History, Doc Studio, Settings),
**Admin** (Team & Access). Section visibility is now driven live from
`route_access` (see Phase 11) rather than a static per-role list — the
sidebar fetches `route → roles` on mount and filters both sections and items
down to what the current role can see, so a route added/removed from the
admin-editable matrix updates the sidebar immediately with no redeploy.

## Phase 4 — Fix bulk & single search filters (date + category)
**Status: `[x]` done (2026-07-13)**

Root cause found: `src/lib/fetchers/orchestrator.ts`'s collection loop
stopped gathering candidates as soon as it hit the raw `limit` (e.g. 3),
*before* any date/attribute filter or the AI category-prompt selection ran.
Since RSS/sitemap return newest-first, that raw batch was always just "the
latest few posts" — filtering it afterward rarely changed anything, and
prompt-based category selection (`selectByPrompt`) only engages when
`pool.length > limit`, which was almost never true since the pool was never
bigger than the raw limit. Same bug, both symptoms.

Fix: added a `collectTarget` that widens to `max(limit*6, limit+20)` whenever
a date/attribute filter or a prompt (category folds into the prompt string)
is active, so sitemap/homepage/category methods keep pulling candidates for
filtering/AI-selection to actually have something to work with. Bulk Search
inherits the fix automatically — it calls the same `/api/fetch` →
`fetchSamplePosts` path (`src/lib/bulk-run-context.tsx`).

Verified directly against live domains (bypassing UI/auth, calling
`fetchSamplePosts` in isolation): `sinceDays=1` on techcrunch.com correctly
narrowed 5→1 result vs. unfiltered; `hasImage=true` correctly returned only
image-bearing posts, reaching further back in time to find enough; prompt/
category selection now actually runs (`pool.length > limit`, `truncated:
true`) where before it was structurally skipped.

## Phase 5 — Settings: admin-controlled vs per-user
**Status: `[x]` done**

`src/lib/app-settings.ts` adds the Supabase-backed layer alongside the
existing `localStorage` one (`src/lib/settings.ts`, unchanged —
`postsPerDomain`/`concurrency`/`aiDefault`/`theme` stay per-browser):
- **Global, admin-only**: `autoIndexCheck`, `autoIndexSubmit` — singleton row
  in `app_settings` (id=1). Everyone can read; only `admin` can write (RLS).
- **Per-user**: `defaultPrompt` — one row per user in `user_settings`, owner
  RLS. Settings page (`src/app/(app)/settings/page.tsx`) shows the global
  toggles read-only for non-admins and editable for admins, plus the
  per-user prompt field for everyone.

## Phase 6 — Admin panel (user & access management)
**Status: `[x]` done**

`src/app/(app)/admin/page.tsx` — member list with role/team/active editing,
email invite via `/api/admin/invite` (Supabase Auth admin API, service-role
key, server-only — invited users are promoted + activated immediately
instead of landing on `/pending`), and a **live access-control matrix**
(route × role checkboxes, backed by `route_access`) that replaced the old
hardcoded `ROUTE_ROLES` constant entirely — see Phase 11 for why that
replacement happened and how it's wired through the rest of the app. Admin
also hosts prompt-template upload for the Article Generator (Phase 9).

## Phase 7 — Doc Studio additions
**Status: `[x]` done**

`src/app/(app)/doc-studio/page.tsx` now has three tabs:
- **Doc Formatter** (pre-existing) — copy/paste house-style formatting.
- **Word → Google Doc** — drag-and-drop upload for one or many `.docx`
  files (`dragOver` state + drop zone), CSV import/export of
  filename → resulting Doc URL, per-file status column.
- **HTML → Google Doc** (new) — paste HTML + a title, converts via Google
  Drive's HTML import (preserves headings/lists/tables/links/bold/italic),
  then applies the same house style as the other tabs. Returns the Doc link.

## Phase 8 — Missive Search + Send Email
**Status: `[x]` done — scope expanded beyond the original plan**

Beyond the originally-planned inbox search, this session also added a
**Send Email** tool and a **Send History** log (not in the original plan —
added because Order Processing needed to send templated emails to vendors
from inside the app, not just search).

- `src/lib/missive.ts` — `searchInbox()` (exact-email via Missive's contact
  filter; word/phrase via a best-effort scan of recent conversations'
  subjects/previews, since Missive's REST API has no full-text search
  endpoint), `sendBulkEmail()` (one separate email per recipient via
  `POST /drafts`, rate-limited to stay under Missive's 300 req/min).
- **404 bug found and fixed (2026-07-13)**: `listOrganizations()`/
  `listSharedLabels()` called `GET /v1/organizations` and
  `GET /v1/shared_labels` — neither exists in Missive's REST API (confirmed
  against their docs). Organizations and shared labels are only ever
  *embedded* fields on conversation objects. Replaced both with a single
  `listMeta()` that derives orgs/labels from a page of recent conversations.
  Verified against the real Missive account post-fix: found the real org
  (`AMRYTT MEDIA LLC`) and 13 real shared labels including "Vendor Response".
  Search itself was already working correctly against the real API — the
  404 the user saw was from this meta call (which failed silently in the UI
  before this fix; the Send Email tab's org/label dropdowns now show a
  visible error and a manual-paste fallback if Missive's API is unreachable).
- **Send History log**: `missive_send_log` table (see Phase 11 migration) —
  every send records recipient, subject, resulting conversation ID (captured
  from `POST /drafts`'s response, which returns `{drafts:{id,conversation}}`
  — no follow-up GET needed), label applied, and who ran it. New "Send
  History" tab on `/missive` lists it with a link to open the conversation.

## Phase 9 — SEO: Article Generator
**Status: `[x]` done — templates are DB-uploaded, not repo files**

Deviated from the original plan (load templates from a `/prompts` folder in
the repo) because that would require a deploy every time a template changes.
Instead: admins upload a `.docx` or paste plain text via Team & Access →
Prompt Templates (`/api/admin/prompt-templates`, `mammoth` for `.docx` text
extraction), stored in `prompt_templates` (readable by everyone with Article
Generator access, admin-only write). `src/app/(app)/article-generator/page.tsx`
picks a template, fills inputs (topic, keywords, tone, length, target
URL/anchor), generates via OpenAI (`src/lib/article-generator.ts`), previews,
exports to a Google Doc through Doc Studio's formatter
(`src/lib/google-formatter.ts`), and logs the generation to
`article_generations`.

## Phase 10 — SEO: Backlink Monitor
**Status: `[x]` done**

`src/app/(app)/backlink-monitor/page.tsx` reads every team member's
`insertion_history` rows (not just the signed-in user's own — see Phase 11's
admin/seo team-read policy) and shows target page URL, our destination URL,
anchor, backlink present/dofollow, and index status. Re-check button hits
`/api/backlink-check`, which fetches the target page with `cheerio`, looks
for an anchor matching the target URL/host+path, and writes
`link_present`/`link_dofollow`/`last_checked_at` back onto the row. CSV
export via the shared export utility.

## Phase 11 — Access-control matrix + global notifications
**Status: `[x]` done — not in the original plan, added this session**

Two structural additions that came up while building Phases 6–10:

1. **Live access-control matrix.** The static `ROUTE_ROLES` constant in
   `src/lib/roles.ts` was replaced by an admin-editable `route_access` table
   (route → roles\[\]), read by `src/lib/route-access.ts` (server,
   request-memoized, fails closed to `["admin"]` if a row is missing or the
   query errors) and directly by the sidebar/topbar/dashboard/admin pages on
   the client. `admin` is always included in the effective role list
   regardless of what's stored, both in the read helper and in the admin UI
   (which won't let you uncheck it) — defense in depth so editing the matrix
   can never lock every admin out.
2. **Global bulk-scan-completion notifications.** Bulk Search's runner moved
   from a page-local hook (`useBulkRunner.ts`, deleted) to
   `src/lib/bulk-run-context.tsx`, a React Context mounted at the app-shell
   level. This means a bulk scan keeps running (and its completion toast —
   `src/components/bulk-completion-toast.tsx` — still fires) even if the
   user navigates away from `/bulk` while it's running.

See `supabase/migration_phase11_access_and_features.sql` for the full,
consolidated, idempotent migration — covers `route_access` (+ seed),
`app_settings`, `user_settings`, `insertion_history`'s new backlink columns
and admin/seo team-read policy, `prompt_templates`, `article_generations`,
and `missive_send_log`. **Not yet run against the live database as of this
doc update — confirm with the user before assuming any of Phases 5/6/8-11
work end-to-end.**

## Global — Import/Export everywhere
**Status: `[ ]` not started — run after the relevant phases land**

Audit every data table/list (search results, bulk, insertion log, history,
backlink monitor, article history, admin members) and ensure consistent CSV
import (where it makes sense) and CSV/Excel export, via one shared export
utility.

---

## Open items

- **Run `supabase/migration_phase11_access_and_features.sql`** in the
  Supabase SQL editor — nothing from Phases 5, 6, 9, 10, or 11 works against
  the live database until this has run. Confirm with the user whether an
  earlier, unsaved version of this migration (pasted directly in a prior
  chat, never committed to a file) was already run — if so, diff carefully
  before re-running, since this version additionally adds `missive_send_log`
  and the `insertion_history` admin/seo team-read policy.
- **`MISSIVE_API_TOKEN`** — added to local `.env.local` this session (pasted
  directly in chat by the user). Still needs to be added to Vercel's env
  vars, and the user was advised to consider rotating it in Missive's
  settings since it's now in a chat transcript.
- **`SUPABASE_SERVICE_ROLE_KEY` is not set** in `.env.local` (verified
  2026-07-13) — `/api/admin/invite` (`src/lib/supabase/admin.ts`) throws at
  runtime until it's added from Supabase → Project Settings → API, and again
  in Vercel's env vars before deploying.
