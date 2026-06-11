alter table public.clients
  add column if not exists client_display_id text;

alter table public.candidates
  add column if not exists candidate_display_id text;

create sequence if not exists public.client_display_id_seq;
create sequence if not exists public.candidate_display_id_seq;

with numbered as (
  select id, 'CL' || row_number() over (order by coalesce(client_name, name), created_at, id) as display_id
  from public.clients
  where nullif(client_display_id, '') is null
)
update public.clients c
set client_display_id = numbered.display_id
from numbered
where c.id = numbered.id;

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
  'public.client_display_id_seq',
  greatest(coalesce((select max((substring(client_display_id from 3))::bigint) from public.clients where client_display_id ~ '^CL[0-9]+$'), 0), 1),
  coalesce((select max((substring(client_display_id from 3))::bigint) from public.clients where client_display_id ~ '^CL[0-9]+$'), 0) > 0
);

select setval(
  'public.candidate_display_id_seq',
  greatest(coalesce((select max((substring(candidate_display_id from 3))::bigint) from public.candidates where candidate_display_id ~ '^CA[0-9]+$'), 0), 1),
  coalesce((select max((substring(candidate_display_id from 3))::bigint) from public.candidates where candidate_display_id ~ '^CA[0-9]+$'), 0) > 0
);

create or replace function public.assign_client_display_id()
returns trigger
language plpgsql
as $$
begin
  new.client_display_id := 'CL' || nextval('public.client_display_id_seq');
  return new;
end;
$$;

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

create unique index if not exists clients_client_display_id_key
  on public.clients(client_display_id);

create unique index if not exists candidates_candidate_display_id_key
  on public.candidates(candidate_display_id);
