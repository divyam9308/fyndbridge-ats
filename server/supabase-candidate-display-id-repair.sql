with duplicate_candidates as (
  select
    id,
    candidate_display_id,
    created_at,
    row_number() over (
      partition by candidate_display_id
      order by created_at asc nulls last, id asc
    ) as rn
  from public.candidates
  where candidate_display_id is not null
),
targets as (
  select id
  from duplicate_candidates
  where rn > 1
),
used_numbers as (
  select distinct regexp_replace(candidate_display_id, '\D', '', 'g')::int as n
  from public.candidates
  where candidate_display_id ~* '^CA\s*\d+$'
),
number_pool as (
  select generate_series(
    1,
    (select coalesce(max(n), 0) + (select count(*) from targets) + 1000 from used_numbers)
  ) as n
),
free_numbers as (
  select n
  from number_pool
  where n not in (select n from used_numbers)
  order by n
),
ranked_replacements as (
  select
    'CA' || n as next_candidate_display_id,
    row_number() over (order by n) as rn
  from free_numbers
),
ranked_targets as (
  select
    id,
    row_number() over (order by id) as rn
  from targets
)
update public.candidates c
set candidate_display_id = rr.next_candidate_display_id
from ranked_targets rt
join ranked_replacements rr on rr.rn = rt.rn
where c.id = rt.id;

select candidate_display_id, count(*)
from public.candidates
where candidate_display_id is not null
group by candidate_display_id
having count(*) > 1;
