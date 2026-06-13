alter table public.clients
  add column if not exists designation text,
  add column if not exists contract_signed boolean default false,
  add column if not exists contract_document text,
  add column if not exists contract_pdf_url text,
  add column if not exists contract_pdf_storage_path text;

update public.clients
set contract_signed = false
where contract_signed is null;
