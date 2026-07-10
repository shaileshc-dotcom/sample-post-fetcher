import Parser from "rss-parser";
import type { Article } from "@/lib/types";

const parser: Parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; SamplePostFetcher/1.0)" },
  customFields: {
    item: [
      ["dc:creator", "creator"],
      ["media:content", "media", { keepArray: true }],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

/** Parse a single feed URL into normalized Article records. */
export async function fetchFeed(feedUrl: string): Promise<Article[]> {
  const feed = await parser.parseURL(feedUrl);
  return (feed.items || []).map((item) => {
    const content = (item.contentEncoded || item.content || "") as string;
    const words = countWords(content);
    return {
      url: item.link || "",
      title: (item.title || "").trim(),
      publishedDate: item.isoDate || item.pubDate || null,
      author: (item.creator || (item as { author?: string }).author || null) as string | null,
      category: Array.isArray(item.categories) ? item.categories[0] ?? null : null,
      featuredImage: extractImage(item, content),
      wordCount: words || null,
      readingTimeMin: words ? Math.max(1, Math.round(words / 220)) : null,
      metaDescription: stripHtml(item.contentSnippet || "").slice(0, 300) || null,
      language: null,
      statusCode: null, // verified later by the orchestrator
      lastModified: null,
      method: "rss" as const,
    };
  }).filter((a) => a.url && a.title);
}

function extractImage(
  item: { media?: Array<{ $?: { url?: string } }>; enclosure?: { url?: string } },
  content: string
): string | null {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item.media?.[0]?.$?.url) return item.media[0].$!.url!;
  const m = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function countWords(html: string): number {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
