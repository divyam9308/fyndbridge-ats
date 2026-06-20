create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  user_id uuid null,
  name text null,
  added_by uuid null,
  created_at timestamptz default now()
);

create table if not exists column_permissions (
  id uuid primary key default gen_random_uuid(),
  table_name text not null check (table_name in ('clients', 'candidates', 'jobs')),
  column_key text not null,
  access_mode text not null check (access_mode in ('everyone', 'admin_disabled', 'admin_hidden')),
  updated_by uuid null,
  updated_at timestamptz default now(),
  unique(table_name, column_key)
);

alter table clients add column if not exists is_locked boolean default false;
alter table clients add column if not exists locked_by uuid null;
alter table clients add column if not exists locked_at timestamptz null;

alter table candidates add column if not exists is_locked boolean default false;
alter table candidates add column if not exists locked_by uuid null;
alter table candidates add column if not exists locked_at timestamptz null;

alter table jobs add column if not exists is_locked boolean default false;
alter table jobs add column if not exists locked_by uuid null;
alter table jobs add column if not exists locked_at timestamptz null;

insert into admin_users (email, name)
values
  ('divyam@fyndbridge.in', 'Divyam'),
  ('rajneesh@fyndbridge.in', 'Rajneesh')
on conflict (email) do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients') then
    alter publication supabase_realtime add table public.clients;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_follow_ups') then
    alter publication supabase_realtime add table public.client_follow_ups;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'candidates') then
    alter publication supabase_realtime add table public.candidates;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'candidate_associations') then
    alter publication supabase_realtime add table public.candidate_associations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs') then
    alter publication supabase_realtime add table public.jobs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_users') then
    alter publication supabase_realtime add table public.admin_users;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'column_permissions') then
    alter publication supabase_realtime add table public.column_permissions;
  end if;
end $$;

grant select on public.clients to authenticated;
grant select on public.client_follow_ups to authenticated;
grant select on public.candidates to authenticated;
grant select on public.candidate_associations to authenticated;
grant select on public.jobs to authenticated;
grant select on public.column_permissions to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_realtime_select_authenticated') then
    create policy clients_realtime_select_authenticated on public.clients for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_follow_ups' and policyname = 'client_follow_ups_realtime_select_authenticated') then
    create policy client_follow_ups_realtime_select_authenticated on public.client_follow_ups for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'candidates' and policyname = 'candidates_realtime_select_authenticated') then
    create policy candidates_realtime_select_authenticated on public.candidates for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'candidate_associations' and policyname = 'candidate_associations_realtime_select_authenticated') then
    create policy candidate_associations_realtime_select_authenticated on public.candidate_associations for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jobs' and policyname = 'jobs_realtime_select_authenticated') then
    create policy jobs_realtime_select_authenticated on public.jobs for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'column_permissions' and policyname = 'column_permissions_realtime_select_authenticated') then
    create policy column_permissions_realtime_select_authenticated on public.column_permissions for select to authenticated using (true);
  end if;
end $$;
