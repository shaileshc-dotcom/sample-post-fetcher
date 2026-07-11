import { google } from "googleapis";
import { normalizePrivateKey } from "@/lib/google-key";

/**
 * Google Docs generator (service-account based). Creates the Doc INSIDE a
 * Shared Drive — service accounts have no personal Drive storage, so creating
 * in "My Drive" fails with "The caller does not have permission." A Shared
 * Drive has its own storage, which fixes that.
 *
 * Required env:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *   GOOGLE_SHARED_DRIVE_ID   <- the Shared Drive (or folder) ID to create docs in
 *
 * The service account must be a member of that Shared Drive (Content manager+).
 * Docs + Drive APIs must be enabled on the project.
 */
export interface DocPassage {
  pageUrl: string;
  indexStatus: string;
  paragraph: string;                 // ONE paragraph, original text verbatim
  insertedSentence: string | null;   // new sentence, or null if anchor already existed
  anchor: string;
  targetUrl: string;
}

function auth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!email || !key) throw new Error("Google service account is not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY)");
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive"],
  });
}

class DocBuilder {
  text = "";
  requests: object[] = [];
  private mark(start: number, end: number, style: Record<string, unknown>, fields: string) {
    this.requests.push({
      updateTextStyle: { range: { startIndex: 1 + start, endIndex: 1 + end }, textStyle: style, fields },
    });
  }
  push(str: string, opts?: { bold?: boolean; size?: number; link?: string; highlight?: boolean }) {
    const start = this.text.length;
    this.text += str;
    const end = this.text.length;
    if (!opts || start === end) return; // never style an empty range (Google rejects it)
    const style: Record<string, unknown> = {};
    const fields: string[] = [];
    if (opts.bold) { style.bold = true; fields.push("bold"); }
    if (opts.size) { style.fontSize = { magnitude: opts.size, unit: "PT" }; fields.push("fontSize"); }
    if (opts.link) { style.link = { url: opts.link }; fields.push("link"); }
    if (opts.highlight) {
      style.backgroundColor = { color: { rgbColor: { red: 1, green: 0.95, blue: 0.72 } } };
      fields.push("backgroundColor");
    }
    if (fields.length) this.mark(start, end, style, fields.join(","));
  }
}

export async function createInsertionDoc(p: DocPassage, docTitle: string): Promise<string> {
  const client = auth();
  const docs = google.docs({ version: "v1", auth: client });
  const drive = google.drive({ version: "v3", auth: client });

  const sharedDriveId = process.env.GOOGLE_SHARED_DRIVE_ID;
  if (!sharedDriveId) throw new Error("GOOGLE_SHARED_DRIVE_ID is not set — create a Shared Drive, add the service account, and set its ID.");

  // 1) Create the Doc as a Drive file inside the Shared Drive.
  let documentId: string;
  try {
    const file = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: docTitle,
        mimeType: "application/vnd.google-apps.document",
        parents: [sharedDriveId],
      },
      fields: "id",
    });
    documentId = file.data.id!;
  } catch (e) {
    const g = e as { errors?: { reason?: string; message?: string }[]; message?: string };
    const reason = g.errors?.[0]?.reason || "unknown";
    const detail = g.errors?.[0]?.message || g.message || "no detail";
    throw new Error(
      `Drive create failed [reason=${reason}]: ${detail} | using driveId=${sharedDriveId} | sa=${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`
    );
  }

  // 2) Build and insert the body content.
  const b = new DocBuilder();
  b.push("Article Page (index status): ", { bold: true });
  b.push(`${p.indexStatus}\n`);
  b.push(`${p.pageUrl}\n\n`, { link: p.pageUrl });
  b.push("Updated Paragraph:\n\n", { bold: true });

  // Render ONLY the paragraph. Preserve original text; style just the anchor
  // (and highlight the inserted sentence, if one was added).
  const para = p.paragraph;
  if (p.insertedSentence) {
    const sIdx = para.toLowerCase().indexOf(p.insertedSentence.toLowerCase());
    if (sIdx === -1) {
      b.push(para.trim() + "\n");
      pushSentence(b, p.insertedSentence, p.anchor, p.targetUrl);
    } else {
      const before = para.slice(0, sIdx);
      const sentence = para.slice(sIdx, sIdx + p.insertedSentence.length);
      const after = para.slice(sIdx + p.insertedSentence.length);
      if (before) b.push(before);
      pushSentence(b, sentence, p.anchor, p.targetUrl);
      if (after) b.push(after);
      b.push("\n");
    }
  } else {
    // Anchor already existed → link it in place (bold + link + light highlight).
    const i = para.toLowerCase().indexOf(p.anchor.toLowerCase());
    if (i === -1) {
      b.push(para.trim() + "\n");
    } else {
      b.push(para.slice(0, i));
      b.push(para.slice(i, i + p.anchor.length), { bold: true, link: p.targetUrl, highlight: true });
      b.push(para.slice(i + p.anchor.length) + "\n");
    }
  }

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests: [{ insertText: { location: { index: 1 }, text: b.text } }, ...b.requests] },
  });

  // 3) Share: anyone with the link → editor.
  await drive.permissions.create({
    fileId: documentId,
    supportsAllDrives: true,
    requestBody: { role: "writer", type: "anyone" },
  });

  return `https://docs.google.com/document/d/${documentId}/edit`;
}

// Push an inserted sentence: highlighted background, with the anchor bold + linked.
function pushSentence(b: DocBuilder, sentence: string, anchor: string, targetUrl: string) {
  const i = sentence.toLowerCase().indexOf(anchor.toLowerCase());
  if (i === -1) { b.push(sentence + "\n", { highlight: true }); return; }
  b.push(sentence.slice(0, i), { highlight: true });
  b.push(sentence.slice(i, i + anchor.length), { highlight: true, bold: true, link: targetUrl });
  b.push(sentence.slice(i + anchor.length) + "\n", { highlight: true });
}
