"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ALL_ROLES, type Role } from "@/lib/roles";
import { getGlobalSettings, saveGlobalSettings } from "@/lib/app-settings";

interface Member {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: Role;
  team: string | null;
  active: boolean;
  created_at: string;
}

interface Template { id: string; name: string; content: string; created_at: string; }
interface Reference { id: string; template_id: string; kind: "upload" | "generated" | "url"; label: string | null; created_at: string; }
interface Generation { id: string; topic: string; created_at: string; }

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = () => rej(new Error("read failed"));
  r.readAsDataURL(file);
});

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  order_processing: "Order Processing",
  seo: "SEO",
  content: "Content",
};

const MATRIX_ROWS: { label: string; href: string }[] = [
  { label: "Dashboard", href: "/" },
  { label: "Publisher Sample Search", href: "/search" },
  { label: "Bulk Publisher Search", href: "/bulk" },
  { label: "Link Insertion", href: "/insertion" },
  { label: "Insertion Log", href: "/insertion-log" },
  { label: "Indexing", href: "/index-check" },
  { label: "Missive Search", href: "/missive" },
  { label: "Article Generator", href: "/article-generator" },
  { label: "Backlink Monitor", href: "/backlink-monitor" },
  { label: "History", href: "/history" },
  { label: "Doc Studio", href: "/doc-studio" },
  { label: "Settings", href: "/settings" },
  { label: "Team & Access", href: "/admin" },
];

export default function AdminPage() {
  const supabase = createClient();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("content");
  const [inviteTeam, setInviteTeam] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const [access, setAccess] = useState<Record<string, Role[]>>({});
  const [matrixSavingKey, setMatrixSavingKey] = useState<string | null>(null);

  const [backlinkAutoSync, setBacklinkAutoSync] = useState(true);
  const [savingSync, setSavingSync] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateText, setTemplateText] = useState("");
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [templateErr, setTemplateErr] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const [references, setReferences] = useState<Record<string, Reference[]>>({});
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [refBusy, setRefBusy] = useState(false);
  const [refErr, setRefErr] = useState<string | null>(null);
  const [refUrl, setRefUrl] = useState("");
  const [refGenerationId, setRefGenerationId] = useState("");

  async function load() {
    setLoading(true);
    const [{ data }, { data: accessRows }, { data: templateRows }, { data: refRows }, { data: genRows }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("route_access").select("route, roles"),
      supabase.from("prompt_templates").select("id, name, content, created_at").order("created_at", { ascending: false }),
      supabase.from("prompt_template_references").select("id, template_id, kind, label, created_at").order("created_at", { ascending: false }),
      supabase.from("article_generations").select("id, topic, created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    // Pending signups need admin attention — surface them above already-active members
    // regardless of join date, instead of letting a new signup get buried in a long list.
    const sorted = [...((data as Member[]) ?? [])].sort((a, b) => Number(a.active) - Number(b.active));
    setMembers(sorted);
    const map: Record<string, Role[]> = {};
    (accessRows ?? []).forEach((r) => { map[r.route] = r.roles as Role[]; });
    setAccess(map);
    setTemplates((templateRows as Template[]) ?? []);
    const refMap: Record<string, Reference[]> = {};
    (refRows as Reference[] ?? []).forEach((r) => { (refMap[r.template_id] ??= []).push(r); });
    setReferences(refMap);
    setGenerations((genRows as Generation[]) ?? []);
    setLoading(false);
    void getGlobalSettings().then((s) => setBacklinkAutoSync(s.backlinkAutoSync));
  }

  async function toggleSync() {
    setSavingSync(true);
    const next = !backlinkAutoSync;
    setBacklinkAutoSync(next);
    await saveGlobalSettings({ backlinkAutoSync: next });
    setSavingSync(false);
  }

  async function uploadTemplate(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !templateName.trim()) { setTemplateErr("Enter a template name first, then choose a file."); return; }
    setUploadingTemplate(true); setTemplateErr(null);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await fetch("/api/admin/prompt-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: templateName, dataBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setTemplateName(""); e.target.value = "";
      void load();
    } catch (err) {
      setTemplateErr((err as Error).message);
    } finally {
      setUploadingTemplate(false);
    }
  }

  async function saveTemplateText() {
    if (!templateName.trim() || !templateText.trim()) return;
    setUploadingTemplate(true); setTemplateErr(null);
    try {
      const res = await fetch("/api/admin/prompt-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: templateName, text: templateText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setTemplateName(""); setTemplateText("");
      void load();
    } catch (err) {
      setTemplateErr((err as Error).message);
    } finally {
      setUploadingTemplate(false);
    }
  }

  async function deleteTemplate(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    await fetch("/api/admin/prompt-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
  }

  function startEdit(t: Template) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditText(t.content);
    setEditErr(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName(""); setEditText(""); setEditErr(null);
  }

  async function saveEdit(dataBase64?: string) {
    if (!editingId) return;
    setSavingEdit(true); setEditErr(null);
    try {
      const res = await fetch("/api/admin/prompt-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: editingId, name: editName, text: dataBase64 ? undefined : editText, dataBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      cancelEdit();
      void load();
    } catch (err) {
      setEditErr((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function replaceEditFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataBase64 = await fileToBase64(file);
    e.target.value = "";
    void saveEdit(dataBase64);
  }

  async function addReference(templateId: string, payload: { kind: "upload" | "generated" | "url"; dataBase64?: string; label?: string; generationId?: string; url?: string }) {
    setRefBusy(true); setRefErr(null);
    try {
      const res = await fetch("/api/admin/prompt-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-reference", templateId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to attach reference");
      setRefUrl(""); setRefGenerationId("");
      void load();
    } catch (err) {
      setRefErr((err as Error).message);
    } finally {
      setRefBusy(false);
    }
  }

  async function addReferenceUpload(templateId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataBase64 = await fileToBase64(file);
    e.target.value = "";
    void addReference(templateId, { kind: "upload", dataBase64, label: file.name });
  }

  async function removeReference(id: string) {
    setReferences((prev) => {
      const next: Record<string, Reference[]> = {};
      for (const [k, v] of Object.entries(prev)) next[k] = v.filter((r) => r.id !== id);
      return next;
    });
    await fetch("/api/admin/prompt-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove-reference", id }),
    });
  }

  useEffect(() => { void load(); }, []);

  async function toggleAccess(route: string, role: Role) {
    if (role === "admin") return; // admin always has access — see route-access.ts's defense-in-depth note
    const current = access[route] ?? [];
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    const key = `${route}:${role}`;
    setMatrixSavingKey(key);
    setAccess((prev) => ({ ...prev, [route]: next }));
    await supabase.from("route_access").update({ roles: next }).eq("route", route);
    setMatrixSavingKey(null);
  }

  async function updateMember(userId: string, patch: Partial<Pick<Member, "role" | "team" | "active">>) {
    setSavingId(userId);
    setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, ...patch } : m)));
    await supabase.from("profiles").update(patch).eq("user_id", userId);
    setSavingId(null);
  }

  async function submitInvite() {
    setInviting(true); setInviteErr(null); setInviteMsg(null);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, team: inviteTeam || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invite failed");
      setInviteMsg(`Invited ${inviteEmail}.`);
      setInviteEmail(""); setInviteTeam("");
      void load();
    } catch (e) {
      setInviteErr((e as Error).message);
    } finally {
      setInviting(false);
    }
  }

  return (
    <div>
      <header className="mb-8">
        <div className="eyebrow">Admin</div>
        <h1 className="text-3xl mt-1">Team &amp; Access</h1>
        <p className="text-[var(--muted)] text-sm mt-2">Manage roles, teams, and access for everyone on GUESTPOSTLINKS.</p>
      </header>

      <div className="card p-6 mb-8">
        <div className="eyebrow mb-4">Invite a new member</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-[var(--muted)] mb-1">Email</div>
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@amrytt.com" className="input px-3 py-2 text-sm w-64" />
          </div>
          <div>
            <div className="text-xs text-[var(--muted)] mb-1">Role</div>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className="input px-3 py-2 text-sm">
              {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)] mb-1">Team (optional)</div>
            <input value={inviteTeam} onChange={(e) => setInviteTeam(e.target.value)} placeholder="e.g. Outreach" className="input px-3 py-2 text-sm w-40" />
          </div>
          <button onClick={submitInvite} disabled={inviting || !inviteEmail} className="btn-primary px-4 py-2 text-sm">
            {inviting ? "Inviting…" : "Send invite"}
          </button>
        </div>
        {inviteErr && (
          <p className="text-xs text-[var(--danger)] mt-3">
            {inviteErr}
            {inviteErr.includes("SUPABASE_SERVICE_ROLE_KEY") && (
              <> Add it to <span className="mono">.env.local</span> and your Vercel env vars from Supabase → Project Settings → API, then redeploy.</>
            )}
          </p>
        )}
        {inviteMsg && <p className="text-xs" style={{ color: "var(--positive)" }}>{inviteMsg}</p>}
      </div>

      <div className="card p-6 mb-8 flex items-center justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Backlink Monitor sync</div>
          <p className="text-xs text-[var(--muted)] max-w-lg">
            When on, every completed Link Insertion automatically creates a tracked row in
            Backlink Monitor. Turn off to stop auto-tracking and rely on manually submitted
            or CSV-imported links instead (Backlink Monitor → Import CSV).
          </p>
        </div>
        <button onClick={toggleSync} disabled={savingSync} className="btn-ghost px-4 py-2 text-sm whitespace-nowrap">
          {savingSync ? "Saving…" : backlinkAutoSync ? "On — click to turn off" : "Off — click to turn on"}
        </button>
      </div>

      <div className="card p-6 mb-8">
        <div className="eyebrow mb-1">Article Generator prompt templates</div>
        <p className="text-xs text-[var(--muted)] mb-4">Upload a .docx or paste text — SEO team members pick from these when generating articles.</p>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <div className="text-xs text-[var(--muted)] mb-1">Template name</div>
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Standard Guest Post" className="input px-3 py-2 text-sm w-56" />
          </div>
          <label className="btn-ghost px-4 py-2 text-sm cursor-pointer">
            {uploadingTemplate ? "Uploading…" : "Upload .docx"}
            <input type="file" accept=".docx,.doc" onChange={uploadTemplate} disabled={uploadingTemplate} className="hidden" />
          </label>
        </div>

        <div className="mb-3">
          <div className="text-xs text-[var(--muted)] mb-1">…or paste template text directly</div>
          <textarea value={templateText} onChange={(e) => setTemplateText(e.target.value)} rows={3}
            placeholder="Describe the house style, structure, and tone the AI should follow…"
            className="input w-full px-3 py-2 text-sm resize-y mb-2" />
          <button onClick={saveTemplateText} disabled={uploadingTemplate || !templateName.trim() || !templateText.trim()} className="btn-ghost px-4 py-2 text-sm">
            Save pasted text as template
          </button>
        </div>
        {templateErr && <p className="text-xs text-[var(--danger)] mb-3">{templateErr}</p>}

        {templates.length > 0 && (
          <div className="space-y-1.5">
            {templates.map((t) => (
              editingId === t.id ? (
                <div key={t.id} className="border-b border-[var(--border)] last:border-0 py-3">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Template name"
                    className="input w-full px-3 py-2 text-sm mb-2" />
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                    className="input w-full px-3 py-2 text-sm resize-y mb-2" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => saveEdit()} disabled={savingEdit || !editName.trim() || !editText.trim()} className="btn-primary px-3 py-1.5 text-xs">
                      {savingEdit ? "Saving…" : "Save"}
                    </button>
                    <label className="btn-ghost px-3 py-1.5 text-xs cursor-pointer">
                      Replace with .docx…
                      <input type="file" accept=".docx,.doc" onChange={replaceEditFile} disabled={savingEdit} className="hidden" />
                    </label>
                    <button onClick={cancelEdit} disabled={savingEdit} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
                  </div>
                  {editErr && <p className="text-xs text-[var(--danger)] mt-2">{editErr}</p>}

                  <div className="mt-4 pt-3 border-t border-[var(--border)]">
                    <div className="eyebrow mb-2">Reference material <span className="opacity-60 normal-case">· style/content examples folded into generations using this template</span></div>
                    {(references[t.id] ?? []).length > 0 && (
                      <div className="space-y-1 mb-3">
                        {(references[t.id] ?? []).map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <span className="truncate max-w-md">
                              <span className="pill pill-mut mono mr-2">{r.kind}</span>
                              {r.label || "(untitled)"}
                            </span>
                            <button onClick={() => removeReference(r.id)} className="text-[var(--danger)] hover:underline shrink-0 ml-3">Remove</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="btn-ghost px-3 py-1.5 text-xs cursor-pointer">
                        Attach .docx…
                        <input type="file" accept=".docx,.doc" onChange={(e) => addReferenceUpload(t.id, e)} disabled={refBusy} className="hidden" />
                      </label>
                      <select value={refGenerationId} onChange={(e) => setRefGenerationId(e.target.value)} disabled={refBusy} className="input px-2 py-1.5 text-xs w-44">
                        <option value="">Pick a generated article…</option>
                        {generations.map((g) => <option key={g.id} value={g.id}>{g.topic}</option>)}
                      </select>
                      <button
                        onClick={() => refGenerationId && addReference(t.id, { kind: "generated", generationId: refGenerationId })}
                        disabled={refBusy || !refGenerationId} className="btn-ghost px-3 py-1.5 text-xs"
                      >
                        Attach
                      </button>
                      <input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="Live article URL"
                        disabled={refBusy} className="input px-2 py-1.5 text-xs w-40" />
                      <button
                        onClick={() => refUrl.trim() && addReference(t.id, { kind: "url", url: refUrl.trim() })}
                        disabled={refBusy || !refUrl.trim()} className="btn-ghost px-3 py-1.5 text-xs"
                      >
                        {refBusy ? "…" : "Fetch & attach"}
                      </button>
                    </div>
                    {refErr && <p className="text-xs text-[var(--danger)] mt-2">{refErr}</p>}
                  </div>
                </div>
              ) : (
                <div key={t.id} className="flex items-center justify-between text-sm border-b border-[var(--border)] last:border-0 py-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {t.name}
                      {(references[t.id]?.length ?? 0) > 0 && (
                        <span className="pill pill-mut mono ml-2">{references[t.id]!.length} ref{references[t.id]!.length === 1 ? "" : "s"}</span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)] truncate max-w-md">{t.content.slice(0, 120)}…</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <button onClick={() => startEdit(t)} className="text-xs text-[var(--accent-strong)] hover:underline">Edit</button>
                    <button onClick={() => deleteTemplate(t.id)} className="text-xs text-[var(--danger)] hover:underline">Delete</button>
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">Members</h2>
      </div>
      <div className="card overflow-hidden mb-10">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-3 eyebrow">Name / Email</th>
              <th className="px-4 py-3 eyebrow">Role</th>
              <th className="px-4 py-3 eyebrow">Team</th>
              <th className="px-4 py-3 eyebrow">Active</th>
              <th className="px-4 py-3 eyebrow">Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{m.display_name || "—"}</div>
                  <div className="text-xs text-[var(--muted)] mono">{m.email || m.user_id}</div>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={m.role}
                    disabled={savingId === m.user_id}
                    onChange={(e) => updateMember(m.user_id, { role: e.target.value as Role })}
                    className="input px-2 py-1.5 text-xs"
                  >
                    {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <input
                    defaultValue={m.team ?? ""}
                    disabled={savingId === m.user_id}
                    onBlur={(e) => { if (e.target.value !== (m.team ?? "")) updateMember(m.user_id, { team: e.target.value || null }); }}
                    className="input px-2 py-1.5 text-xs w-32"
                    placeholder="—"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`pill mono ${m.active ? "pill-pos" : "pill-mut"}`}>{m.active ? "active" : "pending"}</span>
                    <button
                      disabled={savingId === m.user_id}
                      onClick={() => updateMember(m.user_id, { active: !m.active })}
                      className="btn-ghost text-xs px-2.5 py-1"
                    >
                      {savingId === m.user_id ? "…" : m.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--muted)] text-xs mono">{new Date(m.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {!loading && members.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[var(--muted)] text-sm">No members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">Access matrix</h2>
        <span className="text-xs text-[var(--muted)]">Click a dot to grant/revoke that team&apos;s access to a section. Admin always has access to everything.</span>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-3 eyebrow">Section</th>
              {ALL_ROLES.map((r) => <th key={r} className="px-4 py-3 eyebrow text-center">{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row) => (
              <tr key={row.href} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3">{row.label}</td>
                {ALL_ROLES.map((r) => {
                  const granted = r === "admin" ? true : (access[row.href]?.includes(r) ?? false);
                  const key = `${row.href}:${r}`;
                  return (
                    <td key={r} className="px-4 py-3 text-center">
                      <button
                        disabled={r === "admin" || matrixSavingKey === key}
                        onClick={() => toggleAccess(row.href, r)}
                        title={r === "admin" ? "Admin always has access" : granted ? "Click to revoke" : "Click to grant"}
                        className={r === "admin" ? "cursor-default" : "cursor-pointer hover:opacity-70"}
                        style={{ color: granted ? "var(--positive)" : "var(--border)" }}
                      >
                        {matrixSavingKey === key ? "…" : "●"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
