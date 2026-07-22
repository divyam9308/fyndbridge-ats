begin;

alter table public.candidate_associations
  add column if not exists from_applied_candidates boolean not null default false;

-- Preserve in-flight conversions before their protected staging rows are
-- deleted and public_application_id is cleared by its foreign key.
update public.candidate_associations
set from_applied_candidates = true
where public_application_id is not null
  and from_applied_candidates is false;

-- CA844 has two mandate associations. Only the Prasobh Krishnan association
-- came through Applied Candidates; the Priyanka Das association was manual.
update public.candidate_associations as association
set from_applied_candidates = true
from public.candidates as candidate
where candidate.id = association.candidate_id
  and upper(btrim(coalesce(candidate.candidate_display_id, ''))) = 'CA844'
  and lower(btrim(coalesce(association.consultant_name, ''))) = 'prasobh krishnan'
  and association.from_applied_candidates is false;

comment on column public.candidate_associations.from_applied_candidates is
  'Durable association-level provenance. True only when this candidate-mandate row was created through Applied Candidates.';

commit;
