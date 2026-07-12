/** Pure role constants — safe to import from client or server code. */

export type Role = "admin" | "seo" | "order_processing" | "content";

export const ALL_ROLES: Role[] = ["admin", "seo", "order_processing", "content"];

/** Single source of truth for which roles can reach each top-level route. */
export const ROUTE_ROLES: Record<string, Role[]> = {
  "/": ALL_ROLES,
  "/search": ["admin", "order_processing"],
  "/bulk": ["admin", "order_processing"],
  "/history": ["admin", "order_processing"],
  "/insertion": ["admin", "order_processing"],
  "/insertion-log": ["admin", "order_processing"],
  "/index-check": ["admin", "order_processing"],
  "/doc-studio": ["admin", "order_processing", "seo", "content"],
  "/settings": ALL_ROLES,
};
