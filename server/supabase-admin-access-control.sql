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
values ('divyam@fyndbridge.in', 'Divyam')
on conflict (email) do nothing;
