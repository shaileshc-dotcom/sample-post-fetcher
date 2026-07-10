import OpenAI from "openai";
import type { Level } from "@/lib/google-formatter";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function client(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

/** Heuristic fallback: first line = title; short non-sentence lines = h2; else normal. */
function heuristic(paragraphs: string[]): Level[] {
  let titleSet = false;
  return paragraphs.map((t) => {
    const text = t.trim();
    const words = text.split(/\s+/).length;
    const looksHeading = text.length <= 80 && words <= 12 && !/[.!?,:;]$/.test(text);
    if (!titleSet && text.length > 0) { titleSet = true; return "title"; }
    if (/^conclusion\b/i.test(text)) return "h2";
    return looksHeading ? "h2" : "normal";
  });
}

/**
 * Classify each paragraph as title / h2 / h3 / normal using OpenAI.
 * The house rules: exactly one title (first real heading), H2 for main sections,
 * H3 for sub-sections within an H2, everything else normal.
 */
export async function classifyParagraphs(paragraphs: string[]): Promise<Level[]> {
  const openai = client();
  if (!openai || paragraphs.length === 0) return heuristic(paragraphs);

  // Cap payload: send short snippets with indices.
  const snippets = paragraphs.map((p, i) => `${i}: ${p.slice(0, 160)}`).join("\n");
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You classify each paragraph of an article by structural role for formatting. " +
            "Roles: 'title' (the single main title — at most ONE, usually paragraph 0), " +
            "'h2' (a main section heading, e.g. Introduction, main topics, Conclusion), " +
            "'h3' (a sub-heading nested under an h2), 'normal' (body text, lists, everything else). " +
            "Headings are short lines without ending punctuation. Body paragraphs are full sentences. " +
            'Return STRICT JSON: {"levels": string[]} with EXACTLY one entry per input line, in order, each one of title|h2|h3|normal.',
        },
        { role: "user", content: `Paragraphs:\n${snippets}` },
      ],
    });
    const j = JSON.parse(res.choices[0]?.message?.content || "{}") as { levels?: string[] };
    const valid = new Set(["title", "h2", "h3", "normal"]);
    if (!Array.isArray(j.levels) || j.levels.length !== paragraphs.length) return heuristic(paragraphs);
    let sawTitle = false;
    return j.levels.map((l) => {
      let lv = (valid.has(l) ? l : "normal") as Level;
      if (lv === "title") { if (sawTitle) lv = "h2"; else sawTitle = true; }
      return lv;
    });
  } catch {
    return heuristic(paragraphs);
  }
}
