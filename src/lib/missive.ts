const BASE = "https://public.missiveapp.com/v1";

function token(): string {
  const t = process.env.MISSIVE_API_TOKEN;
  if (!t) throw new Error("MISSIVE_API_TOKEN is not set");
  return t;
}

async function missiveFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Missive API ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export interface MissiveOrg { id: string; name: string; }
export interface MissiveSharedLabel { id: string; name: string; organization: string; }
export interface MissiveConversation {
  id: string;
  subject: string | null;
  latest_message_subject: string | null;
  last_activity_at: number;
  users?: { name?: string; email?: string }[];
  organization?: MissiveOrg | null;
  shared_labels?: MissiveSharedLabel[];
}
export interface MissiveMessage {
  id: string;
  preview: string | null;
  subject: string | null;
  delivered_at: number | null;
  created_at: number | null;
  from_field?: { name?: string; address?: string };
  to_fields?: { name?: string; address?: string }[];
}

/**
 * Missive's REST API has no standalone "list organizations" or "list shared
 * labels" endpoint (confirmed against their docs) — both only exist as
 * embedded fields (`organization`, `shared_labels`) on conversation objects.
 * Derive them from a page of recent conversations instead. This is
 * best-effort: an org or label that isn't on any of these conversations
 * won't surface here (Missive's own Settings > API > Resource IDs panel is
 * the authoritative source if one is missing).
 */
async function recentConversationsForMeta(limit = 50): Promise<MissiveConversation[]> {
  const qs = new URLSearchParams({ all: "true", limit: String(limit) });
  const data = await missiveFetch<{ conversations: MissiveConversation[] }>(`/conversations?${qs}`);
  return data.conversations;
}

export async function listMeta(): Promise<{ organizations: MissiveOrg[]; sharedLabels: MissiveSharedLabel[] }> {
  const convos = await recentConversationsForMeta();
  const orgs = new Map<string, MissiveOrg>();
  const labels = new Map<string, MissiveSharedLabel>();
  for (const c of convos) {
    if (c.organization) orgs.set(c.organization.id, c.organization);
    for (const l of c.shared_labels || []) labels.set(l.id, l);
  }
  return { organizations: [...orgs.values()], sharedLabels: [...labels.values()] };
}

export async function findLabelIdByName(name: string): Promise<string | null> {
  const { sharedLabels } = await listMeta();
  return sharedLabels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Conversations where the given email is a participant — Missive supports this filter natively. */
export async function conversationsByEmail(email: string, limit = 50): Promise<MissiveConversation[]> {
  const qs = new URLSearchParams({ email, all: "true", limit: String(limit) });
  const data = await missiveFetch<{ conversations: MissiveConversation[] }>(`/conversations?${qs}`);
  return data.conversations;
}

/**
 * Missive's REST API has NO free-text search endpoint (confirmed against
 * their docs) — only mailbox/label/team/exact-contact-email filters. For a
 * word/phrase (not a full email address), this scans the most recent
 * conversations' subjects and message previews as a best-effort match —
 * NOT a guaranteed exhaustive search of full message bodies or older mail.
 * Capped to keep it inside Vercel's function timeout and Missive's 300
 * req/min rate limit.
 */
export async function searchInbox(term: string, scanCap = 100): Promise<{
  results: { conversation: MissiveConversation; matchedIn: "subject" | "preview" }[];
  scanned: number;
  exhaustive: boolean;
}> {
  if (EMAIL_RE.test(term.trim())) {
    const convos = await conversationsByEmail(term.trim(), 50);
    return { results: convos.map((c) => ({ conversation: c, matchedIn: "subject" as const })), scanned: convos.length, exhaustive: true };
  }

  const needle = term.trim().toLowerCase();
  const results: { conversation: MissiveConversation; matchedIn: "subject" | "preview" }[] = [];
  let scanned = 0;
  let until: number | undefined;
  let exhaustive = true;

  while (scanned < scanCap) {
    const qs = new URLSearchParams({ all: "true", limit: "50" });
    if (until) qs.set("until", String(until));
    const page = await missiveFetch<{ conversations: MissiveConversation[] }>(`/conversations?${qs}`);
    if (!page.conversations.length) break;

    for (const convo of page.conversations) {
      scanned++;
      const subject = (convo.subject || convo.latest_message_subject || "").toLowerCase();
      if (subject.includes(needle)) {
        results.push({ conversation: convo, matchedIn: "subject" });
        continue;
      }
      try {
        const msgs = await missiveFetch<{ messages: MissiveMessage[] }>(`/conversations/${convo.id}/messages`);
        const hit = msgs.messages.some((m) => (m.preview || "").toLowerCase().includes(needle));
        if (hit) results.push({ conversation: convo, matchedIn: "preview" });
      } catch {
        // one conversation failing to fetch messages shouldn't kill the whole search
      }
    }

    until = page.conversations[page.conversations.length - 1]?.last_activity_at;
    if (page.conversations.length < 50 || scanned >= scanCap) { exhaustive = page.conversations.length < 50; break; }
  }

  return { results, scanned, exhaustive };
}

export interface SendResult { email: string; ok: boolean; error?: string; conversationId?: string; }

/** Sends one separate email per recipient (not one email with multiple To addresses), applying a shared label to each. */
export async function sendBulkEmail(opts: {
  emails: string[];
  subject: string;
  bodyHtml: string;
  fromName: string;
  fromAddress: string;
  organizationId: string;
  labelId?: string | null;
}): Promise<SendResult[]> {
  const out: SendResult[] = [];
  for (const email of opts.emails) {
    try {
      const res = await missiveFetch<{ drafts: { id: string; conversation: string } }>("/drafts", {
        method: "POST",
        body: JSON.stringify({
          drafts: {
            subject: opts.subject,
            body: opts.bodyHtml,
            organization: opts.organizationId,
            to_fields: [{ address: email }],
            from_field: { name: opts.fromName, address: opts.fromAddress },
            ...(opts.labelId ? { add_shared_labels: [opts.labelId] } : {}),
            send: true,
          },
        }),
      });
      out.push({ email, ok: true, conversationId: res.drafts?.conversation });
    } catch (e) {
      const message = friendlySendError((e as Error).message, opts.fromAddress);
      out.push({ email, ok: false, error: message });
      // "from_field doesn't match a sender" is an account-config problem, not a
      // per-recipient one — it will fail identically for every remaining email,
      // so stop instead of repeating the same error N times and burning the rate limit.
      if (isSenderConfigError((e as Error).message)) {
        for (const remaining of opts.emails.slice(out.length)) {
          out.push({ email: remaining, ok: false, error: message });
        }
        break;
      }
    }
    // Missive's rate limit is 300 req/min (5/s) — a small delay keeps a big
    // recipient list well under that without needing a queue.
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

function isSenderConfigError(message: string): boolean {
  return message.includes("does not match an available sender");
}

function friendlySendError(message: string, fromAddress: string): string {
  if (isSenderConfigError(message)) {
    return (
      `"${fromAddress}" isn't a valid sender for this Missive account. It must be an alias ` +
      `configured under Missive Settings → Accounts → Aliases (and already verified on that ` +
      `mailbox's email server) — Missive has no API to list valid senders, so this has to be ` +
      `checked/added in the Missive UI directly. (${message})`
    );
  }
  return message;
}
