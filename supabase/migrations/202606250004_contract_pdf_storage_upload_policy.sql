insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-pdfs', 'contract-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];

alter table public.clients
  add column if not exists contract_document_name text;

drop policy if exists "contract pdfs authenticated select" on storage.objects;
drop policy if exists "contract pdfs authenticated insert" on storage.objects;
drop policy if exists "contract pdfs authenticated update" on storage.objects;

create policy "contract pdfs authenticated select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'contract-pdfs'
  and name ~ '^[0-9]{4}/'
  and lower(right(name, 4)) = '.pdf'
);

create policy "contract pdfs authenticated insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'contract-pdfs'
  and name ~ '^[0-9]{4}/'
  and lower(right(name, 4)) = '.pdf'
);

create policy "contract pdfs authenticated update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'contract-pdfs'
  and name ~ '^[0-9]{4}/'
  and lower(right(name, 4)) = '.pdf'
)
with check (
  bucket_id = 'contract-pdfs'
  and name ~ '^[0-9]{4}/'
  and lower(right(name, 4)) = '.pdf'
);
