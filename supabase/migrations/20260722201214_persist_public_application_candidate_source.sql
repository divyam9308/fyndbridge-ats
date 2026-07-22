begin;

-- Candidate provenance must survive deletion of the protected staging row.
-- Preserve any conversions that have not completed staging cleanup yet.
update public.candidates as candidate
set
  source = 'public_application',
  updated_at = now()
from public.candidate_associations as association
where association.candidate_id = candidate.id
  and association.public_application_id is not null
  and candidate.source is distinct from 'public_application';

-- CA844 was converted before provenance became durable, so its staging row and
-- foreign-key marker have already been removed. The consultant condition keeps
-- this repair limited to the exact candidate reported by the user.
update public.candidates as candidate
set
  source = 'public_application',
  updated_at = now()
where upper(btrim(coalesce(candidate.candidate_display_id, ''))) = 'CA844'
  and candidate.source is distinct from 'public_application'
  and exists (
    select 1
    from public.candidate_associations as association
    where association.candidate_id = candidate.id
      and lower(btrim(coalesce(association.consultant_name, ''))) = 'prasobh krishnan'
  );

commit;
