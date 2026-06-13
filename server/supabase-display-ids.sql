alter table public.clients
  add column if not exists client_display_id text;

alter table public.candidates
  add column if not exists candidate_display_id text;

create sequence if not exists public.candidate_display_id_seq;

drop index if exists public.clients_client_display_id_key;

with normalized as (
  select id, lower(regexp_replace(trim(coalesce(client_name, name, '')), '\s+', ' ', 'g')) as normalized_name, client_display_id, created_at
  from public.clients
),
canonical as (
  select distinct on (normalized_name)
    normalized_name,
    coalesce(
      first_value(client_display_id) over (
        partition by normalized_name
        order by case when client_display_id ~ '^CL[0-9]+$' then 0 else 1 end, created_at, id
      ),
      'CL' || dense_rank() over (order by normalized_name)
    ) as display_id
  from normalized
  where normalized_name <> ''
  order by normalized_name, created_at, id
)
update public.clients c
set client_display_id = canonical.display_id
from canonical
where lower(regexp_replace(trim(coalesce(c.client_name, c.name, '')), '\s+', ' ', 'g')) = canonical.normalized_name;

with numbered as (
  select
    c.id,
    'CA' || row_number() over (
      order by
        first_assoc.candidate_id,
        first_assoc.created_at desc nulls last,
        c.created_at,
        c.id
    ) as display_id
  from public.candidates c
  left join lateral (
    select ca.candidate_id, ca.created_at
    from public.candidate_associations ca
    where ca.candidate_id = c.id
    order by ca.created_at desc, ca.id
    limit 1
  ) first_assoc on true
  where nullif(c.candidate_display_id, '') is null
)
update public.candidates c
set candidate_display_id = numbered.display_id
from numbered
where c.id = numbered.id;

select setval(
  'public.candidate_display_id_seq',
  greatest(coalesce((select max((substring(candidate_display_id from 3))::bigint) from public.candidates where candidate_display_id ~ '^CA[0-9]+$'), 0), 1),
  coalesce((select max((substring(candidate_display_id from 3))::bigint) from public.candidates where candidate_display_id ~ '^CA[0-9]+$'), 0) > 0
);

create or replace function public.assign_client_display_id()
returns trigger
language plpgsql
as $$
declare
  next_number bigint;
begin
  if new.client_display_id is not null and trim(new.client_display_id) <> '' then
    return new;
  end if;

  with used_numbers as (
    select substring(client_display_id from 3)::bigint as number
    from public.clients
    where client_display_id ~ '^CL[0-9]+$'
  ),
  candidates as (
    select generate_series(1, greatest(coalesce((select max(number) from used_numbers), 0) + 1, 1)) as number
  )
  select candidates.number
  into next_number
  from candidates
  left join used_numbers on used_numbers.number = candidates.number
  where used_numbers.number is null
  order by candidates.number
  limit 1;

  new.client_display_id := 'CL' || next_number;
  return new;
end;
$$;

drop sequence if exists public.client_display_id_seq;

create or replace function public.assign_candidate_display_id()
returns trigger
language plpgsql
as $$
begin
  new.candidate_display_id := 'CA' || nextval('public.candidate_display_id_seq');
  return new;
end;
$$;

drop trigger if exists clients_display_id_before_insert on public.clients;
create trigger clients_display_id_before_insert
  before insert on public.clients
  for each row execute function public.assign_client_display_id();

drop trigger if exists candidates_display_id_before_insert on public.candidates;
create trigger candidates_display_id_before_insert
  before insert on public.candidates
  for each row execute function public.assign_candidate_display_id();

alter table public.clients
  alter column client_display_id set not null;

alter table public.candidates
  alter column candidate_display_id set not null;

create index if not exists clients_client_display_id_idx
  on public.clients(client_display_id);

create unique index if not exists candidates_candidate_display_id_key
  on public.candidates(candidate_display_id);
