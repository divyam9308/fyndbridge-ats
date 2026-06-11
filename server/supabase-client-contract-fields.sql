alter table public.clients
  add column if not exists designation text,
  add column if not exists contract_signed boolean default false,
  add column if not exists contract_document text;

update public.clients
set contract_signed = false
where contract_signed is null;
