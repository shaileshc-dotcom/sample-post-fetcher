/** Pure role constants — safe to import from client or server code. */

export type Role = "admin" | "seo" | "order_processing" | "content";

export const ALL_ROLES: Role[] = ["admin", "seo", "order_processing", "content"];

// Route → role mapping used to live here as a static ROUTE_ROLES constant.
// It's now admin-editable (Team & Access → Access matrix), backed by the
// public.route_access table — see src/lib/route-access.ts (server) and the
// direct `supabase.from("route_access")` reads in sidebar.tsx/topbar.tsx/
// the dashboard/admin pages (client). Seed values for that table live in
// the Phase-11 SQL migration, not in this file, so there's a single source
// of truth once the migration has run.
