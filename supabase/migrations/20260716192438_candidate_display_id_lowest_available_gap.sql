create or replace function public.assign_candidate_display_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_number bigint;
begin
  if nullif(pg_catalog.btrim(coalesce(new.candidate_display_id, '')), '') is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('display-id'),
    pg_catalog.hashtext('public.candidates')
  );

  select available.number
  into next_number
  from pg_catalog.generate_series(
    1,
    coalesce((
      select count(*)
      from public.candidates candidate
      where candidate.candidate_display_id ~* '^CA[0-9]+$'
    ), 0) + 1
  ) as available(number)
  where not exists (
    select 1
    from public.candidates candidate
    where pg_catalog.upper(candidate.candidate_display_id) = 'CA' || available.number::text
  )
  order by available.number
  limit 1;

  new.candidate_display_id := 'CA' || next_number::text;
  return new;
end;
$$;

drop trigger if exists candidates_display_id_before_insert on public.candidates;

create trigger candidates_display_id_before_insert
before insert on public.candidates
for each row
execute function public.assign_candidate_display_id();
