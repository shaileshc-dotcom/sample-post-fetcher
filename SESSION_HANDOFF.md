# Session Handoff — read this first in the new chat

Paste this whole file (or just point Claude at it) to resume. Everything below reflects
real, verified state as of this handoff — `npx tsc --noEmit` and `npm run build` both
pass clean as of the last change. **Nothing in this entire session has been committed
or pushed** — the user asked to build everything first and deploy once at the end.

## What exists now (uncommitted, in the working tree)

Beyond Phases 1–2 (already committed earlier): Phase 3 (nav reorg), Phase 5 (settings
split), Phase 6 (admin panel), Phase 7 (Doc Studio HTML→Doc + drag-drop), Phase 10
(Backlink Monitor), Phase 8 (Missive search + a new Send Email tool, not in the
original build plan), a fully admin-editable access-control matrix (replaced the
hardcoded `ROUTE_ROLES`), a global bulk-scan-completion notification system, and a
full Article Generator + admin prompt-template upload feature. See
`CLAUDE_CODE_BUILD_PLAN.md` for the phase-by-phase detail already written up through
Phase 10 — everything after that point (access matrix, notifications, Missive,
Article Generator) happened in the session this file is closing out and is **not**
yet reflected in that build plan doc — update it once things are confirmed working.

## SQL — must be run in Supabase before any of this works

One consolidated migration was given to the user in the previous message (route_access
table + seed, app_settings, user_settings, insertion_history new columns +
admin/seo policies, prompt_templates, article_generations). **Ask the user whether
they've run it yet** — if not, get that SQL from them or reconstruct it by reading
`src/lib/route-access.ts`, `src/lib/app-settings.ts`, `src/app/api/backlink-check/route.ts`,
and `src/app/api/admin/prompt-templates/route.ts` to see what tables/columns they expect.

## Known bugs reported by the user, NOT yet fixed — highest priority

1. **Date filter (and likely category filter) on Publisher Sample Search (/search) does
   not actually filter results** — e.g. selecting "last 1 year" still returns the
   latest posts regardless. This is the ORIGINAL Phase 4 item from the very first
   build plan (`sinceDays`/date preset + category not affecting fetch results) — **it
   was never actually fixed in this whole project**, despite being flagged early. Trace
   `sinceDays`/`category` from the UI (`src/app/(app)/search/page.tsx`) through
   `src/lib/hooks/useIndexCheck.ts`/the fetch call → `/api/fetch` →
   `src/lib/fetchers/orchestrator.ts` and the individual fetchers (rss.ts, sitemap.ts,
   homepage.ts, collect-pages.ts) to find where the date/category constraint is
   dropped or ignored. Do the same check for Bulk Search (`/bulk`,
   `src/lib/bulk-run-context.tsx`) since it shares the same `/api/fetch` backend.

2. **Missive Search/Send throws a 404.** The base URL was just re-confirmed correct
   (`https://public.missiveapp.com/v1`, verified against Missive's docs this session)
   — so the 404 is NOT a wrong base URL. Ask the user for the exact failing request
   (browser Network tab: which URL 404s, search or send?) before guessing further.
   Likely suspects to check in `src/lib/missive.ts`: the `/organizations` or
   `/shared_labels` path, or whether `MISSIVE_API_TOKEN` actually made it to the
   deployed environment (it's only in local `.env.local` — **confirm the user added
   it to Vercel's env vars too**, since this session could only edit the local file).

3. **Label dropdown** — fixed this session: `src/app/(app)/missive/page.tsx`'s Send
   Email tab now populates a `<select>` from the real `shared_labels` list (via the
   existing `meta` action) instead of a free-text input, defaulting to "Vendor
   Response" if that label exists. Verified with `tsc` only — not visually tested
   (no live Missive connection in this sandbox). If the 404 above is fixed, re-verify
   this dropdown actually populates.

## New feature requested, NOT built yet

**Missive Send Email needs a history log**: after each send, record which email was
sent to which recipient, the resulting Missive conversation, and who (which app user)
ran it. Needs: a new table (e.g. `missive_send_log(id, user_id, run_by, recipient,
subject, conversation_id, label_applied, created_at)` with per-user RLS like
`insertion_history`), an insert in `src/app/api/missive/route.ts`'s `"send"` case
(the Missive drafts API doesn't return much back from `/v1/drafts` — check what the
POST response actually contains; if it lacks a conversation id, you may need to
follow up with a GET to find the created conversation), and a "History" tab or
section on `src/app/(app)/missive/page.tsx` to display it.

## Everything else from that message ("apply this thing in the emails")

The user's phrasing was ambiguous — likely means "use the label dropdown selection for
the actual send" (already true — `labelName` state feeds directly into the send
request) rather than a separate ask. Confirm with them rather than assume further.

## Environment / secrets note

`MISSIVE_API_TOKEN` was pasted directly in chat by the user this session — it's been
written to local `.env.local` only. The user was told to (a) add it to Vercel too and
(b) consider rotating it in Missive's settings since it's now in this chat transcript.
Don't re-print the token value in any response.

## Process reminders for the new chat

- User wants ONE combined commit+push+deploy at the very end, not per-phase like
  earlier phases. Don't commit anything until they explicitly say the batch is ready.
- Always run `npx tsc --noEmit` and `npm run build` after changes — if you see a
  typed-routes error mentioning `.next/dev/types` vs `.next/types` mismatch, that's a
  stale-cache artifact from adding new routes while a dev server was running — fix
  with `rm -rf .next && npm run build`, not by treating it as a real code error.
- The user cannot visually test most of this yet (some features need the SQL migration
  run first, Missive needs the token in Vercel, etc.) — be upfront about what's
  verified via `tsc`/`build` only vs. actually exercised in a browser.
