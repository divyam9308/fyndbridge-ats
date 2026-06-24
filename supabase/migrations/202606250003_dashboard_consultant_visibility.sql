create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('dashboard_restrict_non_admin_to_self', 'true'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
