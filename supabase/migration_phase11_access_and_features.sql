-- =====================================================================
-- Phase 11+ migration — Access matrix, global/user settings, prompt
-- templates, article generations, insertion_history backlink columns,
-- and the Missive send history log.
--
-- This consolidates everything built in this session that isn't yet in
-- supabase/schema.sql (schema.sql predates insertion_history/profiles too
-- — it was already applied directly to the live DB in an earlier session
-- and never backfilled into that file). Safe to re-run: every statement
-- is idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE POLICY).
--
-- Assumes public.profiles(user_id, role, team, active) and
-- public.insertion_history(id, user_id, run_by, website, anchor,
-- target_url, page_url, index_status, doc_url, details, created_at)
-- already exist (both predate this migration).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. route_access — admin-editable route -> roles matrix
-- ---------------------------------------------------------------------
create table if not exists public.route_access (
  route      text primary key,
  roles      user_role[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.route_access enable row level security;

drop policy if exists "route_access readable by signed-in users" on public.route_access;
create policy "route_access readable by signed-in users" on public.route_access
  for select using (auth.uid() is not null);

drop policy if exists "route_access editable by admin" on public.route_access;
create policy "route_access editable by admin" on public.route_access
  for update using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

insert into public.route_access (route, roles) values
  ('/',                 array['admin','seo','order_processing','content']::user_role[]),
  ('/search',           array['admin','order_processing']::user_role[]),
  ('/bulk',             array['admin','order_processing']::user_role[]),
  ('/history',          array['admin','order_processing']::user_role[]),
  ('/insertion',        array['admin','order_processing']::user_role[]),
  ('/insertion-log',    array['admin','order_processing']::user_role[]),
  ('/index-check',      array['admin','order_processing']::user_role[]),
  ('/doc-studio',       array['admin','order_processing','seo','content']::user_role[]),
  ('/settings',         array['admin','seo','order_processing','content']::user_role[]),
  ('/missive',          array['admin','order_processing']::user_role[]),
  ('/article-generator',array['admin','seo']::user_role[]),
  ('/backlink-monitor', array['admin','seo']::user_role[]),
  ('/admin',            array['admin']::user_role[])
on conflict (route) do nothing;

-- ---------------------------------------------------------------------
-- 2. app_settings — singleton row of admin-controlled global settings
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id                 int primary key default 1,
  auto_index_check   boolean not null default true,
  auto_index_submit  boolean not null default false,
  backlink_auto_sync boolean not null default true,
  updated_at         timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
alter table public.app_settings add column if not exists backlink_auto_sync boolean not null default true;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings readable by signed-in users" on public.app_settings;
create policy "app_settings readable by signed-in users" on public.app_settings
  for select using (auth.uid() is not null);

drop policy if exists "app_settings editable by admin" on public.app_settings;
create policy "app_settings editable by admin" on public.app_settings
  for update using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. user_settings — per-user default prompt (one row per user)
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  default_prompt text not null default '',
  updated_at     timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "own user_settings" on public.user_settings;
create policy "own user_settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4. insertion_history — backlink-monitor columns + team-wide seo/admin
--    read+update (Backlink Monitor needs to see and recheck every user's
--    insertions, not just the signed-in user's own rows)
-- ---------------------------------------------------------------------
alter table public.insertion_history add column if not exists link_present boolean;
alter table public.insertion_history add column if not exists link_dofollow boolean;
alter table public.insertion_history add column if not exists last_checked_at timestamptz;
-- Controls Backlink Monitor VISIBILITY only, not the audit trail — Insertion
-- Log reads every row regardless of this flag. When the admin-controlled
-- "Backlink Monitor sync" setting is off, new Link Insertion completions
-- still get logged here (unconditionally) but with backlink_tracked=false,
-- so they don't clutter Backlink Monitor; CSV-imported rows always set it true.
alter table public.insertion_history add column if not exists backlink_tracked boolean not null default true;

drop policy if exists "insertion_history team read for admin/seo" on public.insertion_history;
create policy "insertion_history team read for admin/seo" on public.insertion_history
  for select using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin','seo'))
  );

drop policy if exists "insertion_history team update for admin/seo" on public.insertion_history;
create policy "insertion_history team update for admin/seo" on public.insertion_history
  for update using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin','seo'))
  );

-- Supplemental, defense-in-depth: ensures CSV import (inserting as the
-- signed-in seo/admin user, own row) works even if the table's original
-- insert policy predates this migration and isn't visible from this file.
drop policy if exists "insertion_history own insert" on public.insertion_history;
create policy "insertion_history own insert" on public.insertion_history
  for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 5. prompt_templates — admin-uploaded templates, readable by everyone
--    with Article Generator access
-- ---------------------------------------------------------------------
create table if not exists public.prompt_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  content    text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.prompt_templates enable row level security;

drop policy if exists "prompt_templates readable by signed-in users" on public.prompt_templates;
create policy "prompt_templates readable by signed-in users" on public.prompt_templates
  for select using (auth.uid() is not null);

drop policy if exists "prompt_templates writable by admin" on public.prompt_templates;
create policy "prompt_templates writable by admin" on public.prompt_templates
  for all using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

-- ---------------------------------------------------------------------
-- 5b. prompt_template_references — reference material attached to a
--     template (an uploaded .docx, a past generated article, or a
--     scraped live article URL) that gets folded into the AI prompt as
--     extra style/content context.
-- ---------------------------------------------------------------------
create table if not exists public.prompt_template_references (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.prompt_templates(id) on delete cascade,
  kind        text not null check (kind in ('upload','generated','url')),
  label       text,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ptr_template on public.prompt_template_references(template_id);

alter table public.prompt_template_references enable row level security;

drop policy if exists "prompt_template_references readable by signed-in users" on public.prompt_template_references;
create policy "prompt_template_references readable by signed-in users" on public.prompt_template_references
  for select using (auth.uid() is not null);

drop policy if exists "prompt_template_references writable by admin" on public.prompt_template_references;
create policy "prompt_template_references writable by admin" on public.prompt_template_references
  for all using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

-- ---------------------------------------------------------------------
-- 6. article_generations — per-user log of generated articles
-- ---------------------------------------------------------------------
create table if not exists public.article_generations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  run_by        text,
  template_name text,
  topic         text not null,
  content       text,
  doc_url       text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_article_generations_user on public.article_generations(user_id, created_at desc);

alter table public.article_generations enable row level security;

drop policy if exists "own article_generations" on public.article_generations;
create policy "own article_generations" on public.article_generations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "article_generations admin read" on public.article_generations;
create policy "article_generations admin read" on public.article_generations
  for select using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

-- ---------------------------------------------------------------------
-- 7. missive_send_log — audit log of emails sent via the Missive
--    Send Email tool; team-wide readable by admin/order_processing
--    (same visibility model as insertion_history), insert-own only.
-- ---------------------------------------------------------------------
create table if not exists public.missive_send_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  run_by          text,
  recipient       text not null,
  subject         text not null,
  conversation_id text,
  label_applied   text,
  status          text not null default 'sent',
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_missive_send_log_created on public.missive_send_log(created_at desc);

alter table public.missive_send_log enable row level security;

drop policy if exists "own missive_send_log insert" on public.missive_send_log;
create policy "own missive_send_log insert" on public.missive_send_log
  for insert with check (auth.uid() = user_id);

drop policy if exists "missive_send_log team read" on public.missive_send_log;
create policy "missive_send_log team read" on public.missive_send_log
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin','order_processing'))
  );

-- ---------------------------------------------------------------------
-- 8. profiles auto-provisioning on signup — fixes new signups not
--    appearing in Team & Access. Two layers, since either alone can miss
--    a case: a trigger (authoritative, runs at signup, SECURITY DEFINER
--    so it isn't blocked by RLS) and a supplemental "insert own row"
--    policy (covers any user who is somehow signed in without a profiles
--    row yet — the app's getCurrentRole() self-heals via this policy).
-- ---------------------------------------------------------------------
-- ON CONFLICT (user_id) below needs a unique constraint on that column —
-- add one defensively in case profiles.user_id is only ever queried via
-- .maybeSingle() convention rather than an actual DB constraint. Harmless
-- no-op if user_id is already the primary key or otherwise unique.
do $$
begin
  alter table public.profiles add constraint profiles_user_id_unique unique (user_id);
-- duplicate_object: constraint name collision. duplicate_table: the constraint's
-- backing index already exists (happens on a re-run after a prior partial success).
exception when duplicate_object or duplicate_table then null;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, role, active)
  values (new.id, new.email, 'content', false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert with check (auth.uid() = user_id);
