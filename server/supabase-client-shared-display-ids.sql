drop index if exists public.clients_client_display_id_key;

with normalized as (
  select
    id,
    lower(regexp_replace(trim(coalesce(client_name, name, '')), '\s+', ' ', 'g')) as normalized_name,
    client_display_id,
    created_at
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
    ) as shared_display_id
  from normalized
  where normalized_name <> ''
  order by normalized_name, created_at, id
)
update public.clients c
set client_display_id = canonical.shared_display_id,
    client_group_id = coalesce(c.client_group_id, (
      select id
      from public.clients c2
      where lower(regexp_replace(trim(coalesce(c2.client_name, c2.name, '')), '\s+', ' ', 'g')) = canonical.normalized_name
      order by c2.created_at, c2.id
      limit 1
    ))
from canonical
where lower(regexp_replace(trim(coalesce(c.client_name, c.name, '')), '\s+', ' ', 'g')) = canonical.normalized_name;

create index if not exists clients_client_display_id_idx on public.clients(client_display_id);
