import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function client(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export interface ArticleInputs {
  topic: string;
  keywords: string;
  tone: string;
  length: "short" | "medium" | "long";
  targetUrl?: string;
  anchor?: string;
}

const LENGTH_WORDS: Record<ArticleInputs["length"], string> = {
  short: "500-700 words",
  medium: "900-1200 words",
  long: "1500-2000 words",
};

/** Generates an article as clean HTML, following an admin-uploaded prompt template's structure/tone guidance. */
export async function generateArticle(templateContent: string, inputs: ArticleInputs, referenceContent?: string): Promise<string> {
  const openai = client();
  if (!openai) throw new Error("OPENAI_API_KEY is not configured");

  const linkInstruction = inputs.targetUrl && inputs.anchor
    ? `Naturally include one mention of "${inputs.anchor}" that reads as a natural link opportunity to ${inputs.targetUrl} — write it as plain text, not markdown link syntax.`
    : "";

  const referenceBlock = referenceContent?.trim()
    ? `\n\nREFERENCE MATERIAL (style/content examples an admin attached to this template — match their tone and quality level, but do not copy them verbatim):\n${referenceContent.trim()}`
    : "";

  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.6,
    messages: [
      {
        role: "system",
        content: `You are a senior SEO content writer. Follow the house prompt template below for structure, tone, and formatting guidance.\n\nTEMPLATE:\n${templateContent}${referenceBlock}`,
      },
      {
        role: "user",
        content: [
          `Topic: ${inputs.topic}`,
          inputs.keywords && `Target keywords: ${inputs.keywords}`,
          inputs.tone && `Tone: ${inputs.tone}`,
          `Length: ${LENGTH_WORDS[inputs.length]}`,
          linkInstruction,
          "Write the full article now as clean HTML (<h2>/<h3> for subheadings, <p> for paragraphs, <ul>/<li> for lists where natural). Do not include <html>/<head>/<body> tags — just the content HTML.",
        ].filter(Boolean).join("\n"),
      },
    ],
  });
  return res.choices[0]?.message?.content || "";
}
