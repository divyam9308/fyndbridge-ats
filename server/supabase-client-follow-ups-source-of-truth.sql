-- Run once after deploying the follow-up source-of-truth change.
-- Copies legacy clients.follow_up_date values into client_follow_ups without
-- overwriting or deleting existing follow-up rows.

insert into public.client_follow_ups (
  client_id,
  follow_up_number,
  follow_up_date,
  follow_up_comments,
  created_at,
  updated_at
)
select
  owner_id,
  coalesce(existing_max.max_number, 0) + row_number() over (partition by owner_id order by client_created_at, client_id),
  follow_up_date,
  follow_up_comments,
  now(),
  now()
from (
  select
    c.id as client_id,
    coalesce(c.client_group_id, c.id) as owner_id,
    c.follow_up_date::date as follow_up_date,
    nullif(coalesce(c.comments, c.notes, ''), '') as follow_up_comments,
    c.created_at as client_created_at
  from public.clients c
  where c.follow_up_date is not null
) legacy
left join lateral (
  select max(f.follow_up_number) as max_number
  from public.client_follow_ups f
  where f.client_id = legacy.owner_id
) existing_max on true
where not exists (
  select 1
  from public.client_follow_ups f
  where f.client_id = legacy.owner_id
    and f.follow_up_date = legacy.follow_up_date
);

create unique index if not exists client_follow_ups_client_date_unique_idx
  on public.client_follow_ups(client_id, follow_up_date);

delete from public.notifications n
using (
  select id
  from (
    select
      id,
      row_number() over (
        partition by recipient_user_id, client_id, follow_up_id, follow_up_date, action_type
        order by
          case when status = 'pending' then 0 else 1 end,
          created_at desc,
          id desc
      ) as duplicate_rank
    from public.notifications
    where action_type = 'client_follow_up_due'
      and follow_up_id is not null
  ) ranked
  where duplicate_rank > 1
) duplicates
where n.id = duplicates.id;

create unique index if not exists notifications_client_follow_up_due_follow_up_unique_idx
  on public.notifications(recipient_user_id, client_id, follow_up_id, follow_up_date, action_type)
  where action_type = 'client_follow_up_due'
    and follow_up_id is not null;
