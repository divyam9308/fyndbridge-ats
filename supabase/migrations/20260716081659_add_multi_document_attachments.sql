-- Backward-compatible attachment collections for mandate JDs, candidate CVs,
-- and client contracts. Legacy single-file columns remain in place while all
-- application writes move to these metadata arrays.

alter table public.jobs
  add column if not exists jd_attachments jsonb not null default '[]'::jsonb;

alter table public.candidates
  add column if not exists cv_original_name text,
  add column if not exists cv_mimetype text,
  add column if not exists cv_attachments jsonb not null default '[]'::jsonb;

alter table public.clients
  add column if not exists contract_attachments jsonb not null default '[]'::jsonb;

update public.jobs
set jd_attachments = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object(
    'path', coalesce(nullif(btrim(jd_storage_path), ''), nullif(btrim(jd_url), '')),
    'name', regexp_replace(
      split_part(coalesce(nullif(btrim(jd_storage_path), ''), nullif(btrim(jd_url), '')), '?', 1),
      '^.*/',
      ''
    ),
    'mime_type', case
      when lower(split_part(coalesce(jd_storage_path, jd_url, ''), '?', 1)) like '%.pdf' then 'application/pdf'
      when lower(split_part(coalesce(jd_storage_path, jd_url, ''), '?', 1)) like '%.docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      when lower(split_part(coalesce(jd_storage_path, jd_url, ''), '?', 1)) like '%.doc' then 'application/msword'
      else null
    end,
    'uploaded_at', coalesce(updated_at, created_at, now())
  ))
)
where jsonb_array_length(jd_attachments) = 0
  and coalesce(nullif(btrim(jd_storage_path), ''), nullif(btrim(jd_url), '')) not in ('', '-');

update public.candidates
set cv_attachments = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object(
    'path', coalesce(
      nullif(btrim(cv_storage_path), ''),
      nullif(btrim(resume_url), ''),
      nullif(btrim(cv_link), '')
    ),
    'name', coalesce(
      nullif(btrim(cv_original_name), ''),
      regexp_replace(
        split_part(coalesce(nullif(btrim(cv_storage_path), ''), nullif(btrim(resume_url), ''), nullif(btrim(cv_link), '')), '?', 1),
        '^.*/',
        ''
      )
    ),
    'mime_type', coalesce(
      nullif(btrim(cv_mimetype), ''),
      case
        when lower(split_part(coalesce(cv_storage_path, resume_url, cv_link, ''), '?', 1)) like '%.pdf' then 'application/pdf'
        when lower(split_part(coalesce(cv_storage_path, resume_url, cv_link, ''), '?', 1)) like '%.docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        when lower(split_part(coalesce(cv_storage_path, resume_url, cv_link, ''), '?', 1)) like '%.doc' then 'application/msword'
        else null
      end
    ),
    'file_hash', nullif(btrim(cv_file_hash), ''),
    'uploaded_at', coalesce(updated_at, created_at, now())
  ))
)
where jsonb_array_length(cv_attachments) = 0
  and coalesce(
    nullif(btrim(cv_storage_path), ''),
    nullif(btrim(resume_url), ''),
    nullif(btrim(cv_link), '')
  ) not in ('', '-');

update public.clients
set contract_attachments = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object(
    'path', coalesce(
      nullif(btrim(contract_pdf_storage_path), ''),
      nullif(btrim(contract_pdf_url), ''),
      nullif(btrim(contract_document), '')
    ),
    'name', coalesce(
      nullif(btrim(contract_document_name), ''),
      regexp_replace(
        split_part(coalesce(nullif(btrim(contract_pdf_storage_path), ''), nullif(btrim(contract_pdf_url), ''), nullif(btrim(contract_document), '')), '?', 1),
        '^.*/',
        ''
      )
    ),
    'mime_type', 'application/pdf',
    'uploaded_at', coalesce(updated_at, created_at, now())
  ))
)
where jsonb_array_length(contract_attachments) = 0
  and coalesce(
    nullif(btrim(contract_pdf_storage_path), ''),
    nullif(btrim(contract_pdf_url), ''),
    nullif(btrim(contract_document), '')
  ) not in ('', '-');

alter table public.jobs
  add constraint jobs_jd_attachments_array
  check (jsonb_typeof(jd_attachments) = 'array') not valid;

alter table public.candidates
  add constraint candidates_cv_attachments_array
  check (jsonb_typeof(cv_attachments) = 'array') not valid;

alter table public.clients
  add constraint clients_contract_attachments_array
  check (jsonb_typeof(contract_attachments) = 'array') not valid;

alter table public.jobs validate constraint jobs_jd_attachments_array;
alter table public.candidates validate constraint candidates_cv_attachments_array;
alter table public.clients validate constraint clients_contract_attachments_array;

comment on column public.jobs.jd_attachments is
  'Ordered JD attachment metadata: path, name, mime_type, size, uploaded_at.';
comment on column public.candidates.cv_attachments is
  'Ordered CV attachment metadata. The first item is the primary CV used by legacy parsing fields.';
comment on column public.clients.contract_attachments is
  'Ordered client contract attachment metadata: path, name, mime_type, size, uploaded_at.';

-- Contract uploads now use server-created signed upload tokens and downloads
-- use the record-authorized backend signed-URL route. Remove the old bucket-wide
-- authenticated policies so knowing an object path is no longer sufficient.
drop policy if exists "contract pdfs authenticated select" on storage.objects;
drop policy if exists "contract pdfs authenticated insert" on storage.objects;
drop policy if exists "contract pdfs authenticated update" on storage.objects;
