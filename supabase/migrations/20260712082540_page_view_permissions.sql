create table if not exists public.page_view_permissions (
  page_key text primary key,
  view_permission text not null default 'everyone'
    check (view_permission in ('everyone', 'admin_only', 'super_admin_only')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.page_view_permissions (page_key, view_permission)
values
  ('dashboard', 'everyone'),
  ('candidates', 'everyone'),
  ('clients', 'everyone'),
  ('mandates', 'everyone'),
  ('performance_review', 'everyone'),
  ('attendance', 'everyone'),
  ('invoice', 'admin_only'),
  ('user_manual', 'everyone')
on conflict (page_key) do nothing;

alter table public.page_view_permissions enable row level security;

grant select on public.page_view_permissions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'page_view_permissions'
      and policyname = 'page_view_permissions_select_authenticated'
  ) then
    create policy page_view_permissions_select_authenticated
      on public.page_view_permissions
      for select to authenticated
      using (true);
  end if;
end $$;
