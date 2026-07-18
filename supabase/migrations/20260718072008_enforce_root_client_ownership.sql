set statement_timeout = '30s';
set lock_timeout = '5s';

-- Preserve any contract that was historically uploaded against a secondary
-- contact before synchronizing group-shared fields from the root client.
with contract_sources as (
  select distinct on (root.id)
    root.id as root_id,
    contact.contract_attachments,
    contact.contract_document,
    contact.contract_pdf_url,
    contact.contract_pdf_storage_path,
    contact.contract_document_name,
    contact.contract_signed
  from public.clients root
  join public.clients contact
    on contact.client_group_id = root.id
   and contact.id <> root.id
  where root.id = root.client_group_id
    and coalesce(jsonb_array_length(root.contract_attachments), 0) = 0
    and nullif(btrim(coalesce(root.contract_document, '')), '') is null
    and (
      coalesce(jsonb_array_length(contact.contract_attachments), 0) > 0
      or nullif(btrim(coalesce(contact.contract_document, '')), '') is not null
    )
  order by root.id, contact.updated_at desc nulls last, contact.id
)
update public.clients root
set
  contract_attachments = source.contract_attachments,
  contract_document = source.contract_document,
  contract_pdf_url = source.contract_pdf_url,
  contract_pdf_storage_path = source.contract_pdf_storage_path,
  contract_document_name = source.contract_document_name,
  contract_signed = source.contract_signed,
  updated_at = now()
from contract_sources source
where root.id = source.root_id;

-- Root client rows are the source of truth for every non-contact field.
update public.clients contact
set
  client_display_id = root.client_display_id,
  consultant_user_id = root.consultant_user_id,
  consultant_name = root.consultant_name,
  client_name = root.client_name,
  name = root.name,
  location = root.location,
  city = root.city,
  region = root.region,
  state = root.state,
  sector = root.sector,
  status = root.status,
  terms_signed_type = root.terms_signed_type,
  terms_signed_custom = root.terms_signed_custom,
  terms_value = root.terms_value,
  billing_entity = root.billing_entity,
  contract_signed = root.contract_signed,
  gstin = root.gstin,
  pan = root.pan,
  address_on_invoice = root.address_on_invoice,
  contract_attachments = root.contract_attachments,
  contract_document = root.contract_document,
  contract_pdf_url = root.contract_pdf_url,
  contract_pdf_storage_path = root.contract_pdf_storage_path,
  contract_document_name = root.contract_document_name,
  updated_at = now()
from public.clients root
where contact.client_group_id = root.id
  and contact.id <> root.id;

-- Preserve same-title mandates as separate Job IDs. An existing primary is
-- retained, preferring the root when multiple unconfirmed rows exist, and
-- every additional row becomes a confirmed duplicate before the root move.
with ranked_jobs as (
  select
    job.id,
    row_number() over (
      partition by
        client.client_group_id,
        lower(regexp_replace(btrim(job.title), '[[:space:]]+', ' ', 'g'))
      order by
        case when job.duplicate_confirmed = false then 0 else 1 end,
        case when job.client_id = client.client_group_id then 0 else 1 end,
        job.created_at,
        job.id
    ) as duplicate_rank
  from public.jobs job
  join public.clients client on client.id = job.client_id
  where nullif(btrim(coalesce(job.title, '')), '') is not null
)
update public.jobs job
set duplicate_confirmed = true
from ranked_jobs ranked
where job.id = ranked.id
  and ranked.duplicate_rank > 1
  and job.duplicate_confirmed = false;

update public.jobs job
set
  client_id = client.client_group_id,
  updated_at = now()
from public.clients client
where job.client_id = client.id
  and client.id <> client.client_group_id;

-- Candidate ownership follows the root-owned mandate invariant.
update public.candidate_associations association
set
  client_id = client.client_group_id,
  updated_at = now()
from public.clients client
where association.client_id = client.id
  and client.id <> client.client_group_id;

update public.candidates candidate
set
  client_id = client.client_group_id,
  updated_at = now()
from public.clients client
where candidate.client_id = client.id
  and client.id <> client.client_group_id;

create or replace function public.canonicalize_client_group_root_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  root_id uuid;
begin
  if new.client_id is null then
    return new;
  end if;

  select client.client_group_id
  into root_id
  from public.clients client
  where client.id = new.client_id;

  if root_id is not null then
    new.client_id := root_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_00_jobs_root_client_id on public.jobs;
create trigger trg_00_jobs_root_client_id
before insert or update of client_id on public.jobs
for each row execute function public.canonicalize_client_group_root_id();

drop trigger if exists trg_00_candidate_associations_root_client_id on public.candidate_associations;
create trigger trg_00_candidate_associations_root_client_id
before insert or update of client_id on public.candidate_associations
for each row execute function public.canonicalize_client_group_root_id();

drop trigger if exists trg_00_candidates_root_client_id on public.candidates;
create trigger trg_00_candidates_root_client_id
before insert or update of client_id on public.candidates
for each row execute function public.canonicalize_client_group_root_id();
