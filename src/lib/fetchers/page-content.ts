import { httpGet } from "@/lib/http";

/**
 * Extract the main body paragraphs from a page (cleaned <p> text), so link
 * insertion can weave the anchor into a REAL, relevant paragraph rather than a
 * fabricated one. Returns up to `max` substantive paragraphs.
 */
export async function fetchPageParagraphs(url: string, max = 20, timeoutMs = 12000): Promise<string[]> {
  const res = await httpGet(url, { timeoutMs });
  if (!res.data) return [];
  const html = res.data;

  const paras: string[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && paras.length < max * 2) {
    const text = stripTags(m[1]).replace(/\s+/g, " ").trim();
    // Keep only real sentences: long enough, has spaces, not nav/boilerplate.
    if (text.length >= 60 && text.split(" ").length >= 10 && !/^(copyright|©|all rights|share this|posted|tags:|categories:)/i.test(text)) {
      paras.push(text);
    }
  }
  // De-dupe while preserving order.
  return [...new Set(paras)].slice(0, max);
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
