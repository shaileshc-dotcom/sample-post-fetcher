import type { Article } from "@/lib/types";

export interface DomainGroup {
  domain: string;
  articles: Article[];
}

/**
 * PRIMARY export format requested by ops:
 *   Column A = domain
 *   Column B = up to 3 article URLs, comma-separated in one cell
 * One row per domain (works for single search AND bulk).
 */
export function toDomainCSV(groups: DomainGroup[], postsPerDomain = 3): string {
  const head = "Domain,Articles";
  const rows = groups.map((g) => {
    const urls = g.articles
      .slice(0, postsPerDomain)
      .map((a) => a.url)
      .join(", ");
    return `${csv(g.domain)},${csv(urls)}`;
  });
  return [head, ...rows].join("\r\n");
}

/** Full per-article CSV (every column) — kept for detailed exports. */
export function toArticleCSV(articles: Article[]): string {
  const cols = ["title", "url", "publishedDate", "author", "category", "wordCount", "method"];
  const head = cols.join(",");
  const rows = articles.map((a) =>
    cols.map((c) => csv(String((a as Record<string, unknown>)[c] ?? ""))).join(",")
  );
  return [head, ...rows].join("\r\n");
}

export function toJSON(groups: DomainGroup[]): string {
  return JSON.stringify(groups, null, 2);
}

export function toMarkdown(groups: DomainGroup[], postsPerDomain = 3): string {
  return groups
    .map((g) => {
      const items = g.articles
        .slice(0, postsPerDomain)
        .map((a) => `  - [${a.title}](${a.url})`)
        .join("\n");
      return `### ${g.domain}\n${items}`;
    })
    .join("\n\n");
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Trigger a browser download. Prepends a BOM for CSV so Excel reads UTF-8. */
export function download(filename: string, content: string, type = "text/plain") {
  const isCsv = type.includes("csv");
  const blob = new Blob([isCsv ? "\uFEFF" + content : content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
