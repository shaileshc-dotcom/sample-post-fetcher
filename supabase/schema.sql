-- =====================================================================
-- Sample Post Fetcher — Supabase schema
-- Run in Supabase SQL Editor. RLS ensures users only see their own rows.
-- =====================================================================

-- ---- Search history ----
create table if not exists public.search_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  domain        text not null,
  articles_found integer not null default 0,
  duration_ms   integer not null default 0,
  fetch_method  text,
  status        text not null default 'success',
  is_favorite   boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_history_user on public.search_history(user_id, created_at desc);

-- ---- Saved/favorite domains, with folder support ----
create table if not exists public.favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  domain     text not null,
  folder     text default 'General',
  note       text,
  created_at timestamptz not null default now(),
  unique (user_id, domain)
);
create index if not exists idx_fav_user on public.favorites(user_id, folder);

-- ---- Cached fetch results (optional perf cache, keyed by domain) ----
create table if not exists public.fetch_cache (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  domain      text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cache_user_domain on public.fetch_cache(user_id, domain, created_at desc);

-- ---- Row Level Security ----
alter table public.search_history enable row level security;
alter table public.favorites      enable row level security;
alter table public.fetch_cache    enable row level security;

create policy "own history"  on public.search_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own favorites" on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own cache"     on public.fetch_cache
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
