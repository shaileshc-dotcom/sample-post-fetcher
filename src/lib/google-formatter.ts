import { google } from "googleapis";
import { Readable } from "stream";

function auth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account is not configured");
  return new google.auth.JWT({
    email, key,
    scopes: ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive"],
  });
}

export function extractFileId(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/) || url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function sharedDrive(): string {
  const id = process.env.GOOGLE_SHARED_DRIVE_ID;
  if (!id) throw new Error("GOOGLE_SHARED_DRIVE_ID is not set");
  return id;
}

async function shareAnyone(fileId: string) {
  const drive = google.drive({ version: "v3", auth: auth() });
  await drive.permissions.create({ fileId, supportsAllDrives: true, requestBody: { role: "writer", type: "anyone" } });
}

/** Copy a client Google Doc into our Shared Drive and share it (anyone-with-link editor). */
export async function copyDoc(fileId: string): Promise<{ id: string; url: string; name: string }> {
  const drive = google.drive({ version: "v3", auth: auth() });
  const meta = await drive.files.get({ fileId, fields: "name", supportsAllDrives: true });
  const copy = await drive.files.copy({
    fileId, supportsAllDrives: true,
    requestBody: { name: `${meta.data.name || "Document"} (copy)`, parents: [sharedDrive()] },
    fields: "id",
  });
  const id = copy.data.id!;
  await shareAnyone(id);
  return { id, url: `https://docs.google.com/document/d/${id}/edit`, name: meta.data.name || "Document" };
}

/** Convert an uploaded .docx (buffer) into a native Google Doc in the Shared Drive. */
export async function convertWordToDoc(buffer: Buffer, name: string): Promise<{ id: string; url: string; name: string }> {
  const drive = google.drive({ version: "v3", auth: auth() });
  const clean = name.replace(/\.docx?$/i, "");
  const file = await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name: clean, mimeType: "application/vnd.google-apps.document", parents: [sharedDrive()] },
    media: {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: Readable.from(buffer),
    },
    fields: "id",
  });
  const id = file.data.id!;
  await shareAnyone(id);
  return { id, url: `https://docs.google.com/document/d/${id}/edit`, name: clean };
}

interface Para { text: string; start: number; end: number; isList: boolean; }

function readParagraphs(content: unknown[]): Para[] {
  const out: Para[] = [];
  for (const el of content as Array<Record<string, unknown>>) {
    const p = el.paragraph as { elements?: Array<{ startIndex?: number; endIndex?: number; textRun?: { content?: string } }>; bullet?: unknown } | undefined;
    if (!p || !p.elements) continue;
    let text = "";
    let start = Infinity, end = 0;
    for (const e of p.elements) {
      if (e.textRun?.content) text += e.textRun.content;
      if (typeof e.startIndex === "number") start = Math.min(start, e.startIndex);
      if (typeof e.endIndex === "number") end = Math.max(end, e.endIndex);
    }
    text = text.replace(/\n$/, "");
    if (!text.trim() || start === Infinity || end <= start) continue;
    out.push({ text, start, end, isList: !!p.bullet });
  }
  return out;
}

export type Level = "title" | "h2" | "h3" | "normal";

const STYLE: Record<Level, { named: string; size: number; bold: boolean; align: string }> = {
  title:  { named: "HEADING_1", size: 23, bold: true,  align: "START" },
  h2:     { named: "HEADING_2", size: 18, bold: true,  align: "START" },
  h3:     { named: "HEADING_3", size: 15, bold: true,  align: "START" },
  normal: { named: "NORMAL_TEXT", size: 14, bold: false, align: "JUSTIFIED" },
};

/** Apply the house style (Outfit; H1 23 / H2 18 / H3 15 bold; body 14; justify) to a Google Doc. */
export async function formatDoc(fileId: string, levels: Level[]): Promise<{ url: string }> {
  const docs = google.docs({ version: "v1", auth: auth() });
  const doc = await docs.documents.get({ documentId: fileId });
  const paras = readParagraphs((doc.data.body?.content as unknown[]) || []);

  const requests: object[] = [];
  paras.forEach((p, i) => {
    const level: Level = p.isList ? "normal" : (levels[i] || "normal");
    const st = STYLE[level];
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: p.start, endIndex: p.end },
        paragraphStyle: { namedStyleType: p.isList ? "NORMAL_TEXT" : st.named, alignment: st.align },
        fields: "namedStyleType,alignment",
      },
    });
    requests.push({
      updateTextStyle: {
        range: { startIndex: p.start, endIndex: p.end },
        textStyle: { weightedFontFamily: { fontFamily: "Outfit" }, fontSize: { magnitude: st.size, unit: "PT" }, bold: st.bold },
        fields: "weightedFontFamily,fontSize,bold",
      },
    });
  });

  // Batch in chunks to stay well under API limits.
  for (let i = 0; i < requests.length; i += 400) {
    await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: requests.slice(i, i + 400) } });
  }
  return { url: `https://docs.google.com/document/d/${fileId}/edit` };
}

/** Extract plain paragraphs (text only) for AI classification. */
export async function getDocParagraphs(fileId: string): Promise<string[]> {
  const docs = google.docs({ version: "v1", auth: auth() });
  const doc = await docs.documents.get({ documentId: fileId });
  return readParagraphs((doc.data.body?.content as unknown[]) || []).map((p) => p.text);
}
