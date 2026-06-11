alter table public.clients
  drop constraint if exists clients_name_key;

alter table public.clients
  add column if not exists client_group_id uuid,
  add column if not exists client_display_id text,
  add column if not exists consultant_name text,
  add column if not exists client_name text,
  add column if not exists location text,
  add column if not exists region text,
  add column if not exists contact_person text,
  add column if not exists designation text,
  add column if not exists mobile text,
  add column if not exists linkedin text,
  add column if not exists sector text,
  add column if not exists connected_on_date date,
  add column if not exists comments text,
  add column if not exists follow_up_date date,
  add column if not exists terms_signed_type text,
  add column if not exists terms_signed_custom text,
  add column if not exists terms_value text,
  add column if not exists contract_signed boolean default false,
  add column if not exists contract_document text,
  add column if not exists gstin text,
  add column if not exists pan text,
  add column if not exists address_on_invoice text;

update public.clients
set
  client_group_id = coalesce(client_group_id, id),
  client_name = coalesce(client_name, name),
  location = coalesce(location, city),
  region = coalesce(region, state),
  contact_person = coalesce(contact_person, contact),
  mobile = coalesce(mobile, phone),
  comments = coalesce(comments, notes),
  contract_signed = coalesce(contract_signed, false),
  status = case
    when status in ('Converted', 'Not Converted', 'Follow Up Required', 'Not Hiring', 'Not Adding Consultants', 'Didn''t Pick Up') then status
    else 'Not Converted'
  end
where true;

alter table public.clients
  alter column client_group_id set not null;

create index if not exists clients_client_group_id_idx on public.clients(client_group_id);
create unique index if not exists clients_client_display_id_key on public.clients(client_display_id);
create index if not exists clients_consultant_name_idx on public.clients(consultant_name);
create index if not exists clients_client_name_idx on public.clients(client_name);
create index if not exists clients_contact_person_idx on public.clients(contact_person);
create index if not exists clients_mobile_idx on public.clients(mobile);
create index if not exists clients_region_idx on public.clients(region);
create index if not exists clients_status_idx on public.clients(status);

create table if not exists public.client_follow_ups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  follow_up_number integer not null,
  follow_up_date date not null,
  follow_up_comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, follow_up_number)
);

create index if not exists client_follow_ups_client_id_idx on public.client_follow_ups(client_id);
