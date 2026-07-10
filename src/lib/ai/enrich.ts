import OpenAI from "openai";
import pLimit from "p-limit";
import type { Article, ArticleAI } from "@/lib/types";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // cheap + capable; override via env

function client(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

const SYSTEM = `You are an SEO and guest-posting analyst for a link-building agency.
Given an article's title and excerpt, return STRICT JSON only (no markdown) with:
{
 "summary": one-line summary,
 "topic": short topic,
 "writingStyle": e.g. "news", "editorial", "listicle", "how-to",
 "niche": e.g. "Finance", "Casino", "Tech", "Health",
 "targetAudience": short phrase,
 "seoQuality": integer 0-100,
 "contentQuality": integer 0-100,
 "spamScore": integer 0-100 (higher = spammier),
 "guestPostFriendly": boolean
}`;

/** Enrich up to `cap` articles with AI analysis. Fails open (returns originals). */
export async function enrichArticles(articles: Article[], cap = 5): Promise<Article[]> {
  const openai = client();
  if (!openai) return articles;

  const limit = pLimit(3);
  const targets = articles.slice(0, cap);

  await Promise.all(
    targets.map((a) =>
      limit(async () => {
        try {
          a.ai = await analyzeOne(openai, a);
        } catch {
          /* leave unenriched on failure */
        }
      })
    )
  );
  return articles;
}

async function analyzeOne(openai: OpenAI, a: Article): Promise<ArticleAI> {
  const excerpt = (a.metaDescription || "").slice(0, 500);
  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `TITLE: ${a.title}\nURL: ${a.url}\nEXCERPT: ${excerpt}\nWORD_COUNT: ${a.wordCount ?? "unknown"}`,
      },
    ],
  });
  const raw = res.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw) as ArticleAI;
  return {
    summary: parsed.summary ?? "",
    topic: parsed.topic ?? "",
    writingStyle: parsed.writingStyle ?? "",
    niche: parsed.niche ?? "",
    targetAudience: parsed.targetAudience ?? "",
    seoQuality: clamp(parsed.seoQuality),
    contentQuality: clamp(parsed.contentQuality),
    spamScore: clamp(parsed.spamScore),
    guestPostFriendly: Boolean(parsed.guestPostFriendly),
  };
}

function clamp(n: unknown): number {
  const v = Number(n);
  if (isNaN(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Use the user's free-text prompt to select the most relevant `n` articles from
 * a candidate pool — a single AI call that returns indices. If no API key is
 * configured, falls back to the first `n` candidates (order preserved).
 */
export async function selectByPrompt(
  candidates: Article[],
  prompt: string,
  n: number
): Promise<Article[]> {
  const openai = client();
  if (!openai || candidates.length <= n) return candidates.slice(0, n);

  const list = candidates
    .map((a, i) => `${i}. [${a.wordCount ?? "?"}w] ${a.title} — ${(a.metaDescription || "").slice(0, 140)}`)
    .join("\n");

  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an editorial scout. Rank candidate articles by how well they " +
            "match the user's request, weighing RELEVANCE first, then QUALITY " +
            "(longer, substantive pieces with clear topics beat thin/listicle/spammy ones). " +
            "If the request mentions quality, be strict. Return STRICT JSON " +
            `{"indices":[...]} with the up-to-${n} best candidate indices, best first.`,
        },
        { role: "user", content: `REQUEST: ${prompt}\n\nCANDIDATES:\n${list}` },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}") as { indices?: number[] };
    const picked = (parsed.indices || [])
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .slice(0, n)
      .map((i) => candidates[i]);
    return picked.length ? picked : candidates.slice(0, n);
  } catch {
    return candidates.slice(0, n);
  }
}

interface AnchorCandidate {
  url: string;
  title: string;
  metaDescription: string | null;
  wordCount: number | null;
}
interface AnchorMatch {
  url: string;
  title: string;
  reason: string;
  score: number;
  wordCount: number | null;
}

/**
 * Rank on-site pages as link-insertion targets for a given anchor + target URL.
 * One AI call returns the best pages with a one-line reason and 0-100 score.
 * Falls back to input order (already keyword-ranked) if no API key.
 */
export async function rankForAnchor(
  candidates: AnchorCandidate[],
  anchor: string,
  targetUrl: string,
  prompt: string,
  n: number
): Promise<AnchorMatch[]> {
  const openai = client();
  const fallback = () =>
    candidates.slice(0, n).map((c) => ({
      url: c.url,
      title: c.title,
      reason: "Keyword match with the anchor / target topic.",
      score: 60,
      wordCount: c.wordCount,
    }));

  if (!openai) return fallback();

  const list = candidates
    .map((c, i) => `${i}. [${c.wordCount ?? "?"}w] ${c.title} (${c.url}) — ${(c.metaDescription || "").slice(0, 140)}`)
    .join("\n");

  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You place backlinks. Given an ANCHOR TEXT and a TARGET URL, pick the " +
            "on-site pages where inserting a link with that anchor would be most " +
            "contextually natural and relevant. Prefer topically-aligned, substantive " +
            "pages. Return STRICT JSON " +
            `{"matches":[{"index":n,"reason":"short why","score":0-100}]} with up to ${n} picks, best first.`,
        },
        {
          role: "user",
          content: `ANCHOR: ${anchor}\nTARGET URL: ${targetUrl}\nPREFERENCES: ${prompt || "(none)"}\n\nCANDIDATE PAGES:\n${list}`,
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}") as {
      matches?: { index: number; reason: string; score: number }[];
    };
    const out = (parsed.matches || [])
      .filter((m) => Number.isInteger(m.index) && m.index >= 0 && m.index < candidates.length)
      .slice(0, n)
      .map((m) => {
        const c = candidates[m.index];
        return {
          url: c.url,
          title: c.title,
          reason: m.reason || "Relevant to the anchor topic.",
          score: clamp(m.score),
          wordCount: c.wordCount,
        };
      });
    return out.length ? out : fallback();
  } catch {
    return fallback();
  }
}

interface Passage {
  paragraph: string;                 // ONE original paragraph, verbatim (+ inserted line if added)
  insertedSentence: string | null;   // the new sentence added, or null if the anchor already existed
  anchorExisted: boolean;
}

/**
 * Insert the client anchor into ONE relevant paragraph of the article.
 * - If the anchor phrase already appears, return that single paragraph unchanged
 *   (we'll link the existing occurrence).
 * - Otherwise pick the most relevant paragraph, keep it verbatim, and add ONE
 *   natural sentence containing the anchor. Returns ONLY that paragraph — never
 *   the whole article, headings, or multiple paragraphs.
 */
export async function composeInsertion(
  _pageTitle: string,
  paragraphs: string[],
  anchor: string,
  targetUrl: string,
  instruction: string
): Promise<Passage> {
  const fullArticle = paragraphs.join("\n\n");
  const openai = client();

  // Fallback / no-key path.
  const existingPara = paragraphs.find((p) => p.toLowerCase().includes(anchor.toLowerCase()));
  const fallbackSentence = `For readers exploring this further, ${anchor} offers relevant, useful information worth reviewing.`;
  const fallback = (): Passage => {
    if (existingPara) return { paragraph: existingPara, insertedSentence: null, anchorExisted: true };
    const base = paragraphs.find((p) => p.length > 80) || paragraphs[0] || "";
    return { paragraph: base ? `${base} ${fallbackSentence}` : fallbackSentence, insertedSentence: fallbackSentence, anchorExisted: false };
  };
  if (!openai || !fullArticle) return fallback();

  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are given an anchor text and a full article. Insert the anchor naturally into the SINGLE most relevant paragraph.\n" +
            "Rules:\n" +
            "- Do NOT rewrite, remove or alter existing content, wording, or meaning. Keep the paragraph's original text EXACTLY.\n" +
            "- If the anchor phrase ALREADY appears verbatim somewhere in the article, choose that paragraph and set anchorExisted=true and insertedSentence=null (do not add anything).\n" +
            "- Otherwise, add ONE natural sentence (or short clause) that contains the exact anchor, set anchorExisted=false, and put that sentence in insertedSentence.\n" +
            "- Return ONLY ONE paragraph — never multiple paragraphs, never headings, never the whole article.\n" +
            'Return STRICT JSON: {"paragraph": string, "insertedSentence": string|null, "anchorExisted": boolean}. ' +
            "paragraph = the single original paragraph kept verbatim, PLUS the inserted sentence if you added one.",
        },
        {
          role: "user",
          content:
            `Anchor text: ${anchor}\nAnchor URL: ${targetUrl}\n` +
            `${instruction ? `Special instruction: ${instruction}\n` : ""}` +
            `\nFull article:\n${fullArticle.slice(0, 7000)}`,
        },
      ],
    });
    const j = JSON.parse(res.choices[0]?.message?.content || "{}") as Partial<Passage>;
    let paragraph = (j.paragraph || "").trim();
    if (!paragraph) return fallback();
    // Keep only the first paragraph if the model returned more.
    paragraph = paragraph.split(/\n{2,}/)[0].trim();

    const anchorExisted = !!j.anchorExisted && paragraph.toLowerCase().includes(anchor.toLowerCase());
    if (anchorExisted) return { paragraph, insertedSentence: null, anchorExisted: true };

    let insertedSentence =
      j.insertedSentence && j.insertedSentence.toLowerCase().includes(anchor.toLowerCase())
        ? j.insertedSentence.trim()
        : fallbackSentence;
    if (!paragraph.toLowerCase().includes(insertedSentence.toLowerCase())) {
      paragraph = `${paragraph} ${insertedSentence}`;
    }
    return { paragraph, insertedSentence, anchorExisted: false };
  } catch {
    return fallback();
  }
}
