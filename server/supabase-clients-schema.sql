create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  client_display_id text unique,
  consultant_name text,
  name text unique not null,
  contact text,
  phone text not null,
  email text,
  city text,
  state text,
  status text not null default 'Active',
  notes text,
  terms_signed_type text,
  terms_signed_custom text,
  terms_value text,
  contract_signed boolean default false,
  contract_document text,
  contract_pdf_url text,
  contract_pdf_storage_path text,
  gstin text,
  pan text,
  address_on_invoice text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients
  drop constraint if exists clients_name_key;

create index if not exists clients_name_idx
  on public.clients(name);
