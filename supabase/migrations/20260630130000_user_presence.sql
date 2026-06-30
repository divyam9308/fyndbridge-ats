create table if not exists public.user_presence (
  user_id uuid not null references auth.users(id) on delete cascade,
  tab_id text not null,
  email text,
  display_name text,
  initials text,
  avatar_color text,
  status text not null check (status in ('online', 'away')),
  current_path text,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, tab_id)
);

create index if not exists idx_user_presence_last_seen_at
  on public.user_presence(last_seen_at desc);

alter table public.user_presence enable row level security;

drop policy if exists "presence_select_authenticated" on public.user_presence;
create policy "presence_select_authenticated"
  on public.user_presence
  for select
  to authenticated
  using (true);

drop policy if exists "presence_insert_own" on public.user_presence;
create policy "presence_insert_own"
  on public.user_presence
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "presence_update_own" on public.user_presence;
create policy "presence_update_own"
  on public.user_presence
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "presence_delete_own" on public.user_presence;
create policy "presence_delete_own"
  on public.user_presence
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
