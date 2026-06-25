drop policy if exists "contract pdfs authenticated select" on storage.objects;
drop policy if exists "contract pdfs authenticated insert" on storage.objects;
drop policy if exists "contract pdfs authenticated update" on storage.objects;

create policy "contract pdfs authenticated select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'contract-pdfs'
  and (name ~ '^contracts/[^/]+/' or name ~ '^[0-9]{4}/')
  and lower(right(name, 4)) = '.pdf'
);

create policy "contract pdfs authenticated insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'contract-pdfs'
  and name ~ '^contracts/[^/]+/'
  and lower(right(name, 4)) = '.pdf'
);

create policy "contract pdfs authenticated update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'contract-pdfs'
  and name ~ '^contracts/[^/]+/'
  and lower(right(name, 4)) = '.pdf'
)
with check (
  bucket_id = 'contract-pdfs'
  and name ~ '^contracts/[^/]+/'
  and lower(right(name, 4)) = '.pdf'
);
