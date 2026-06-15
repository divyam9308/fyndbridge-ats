create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null,
  sender_user_id uuid,
  mandate_id uuid,
  client_id uuid,
  role_type text check (role_type in ('consultant','team_lead','system')),
  title text,
  message text not null,
  status text default 'pending' check (status in ('pending','read')),
  action_type text default 'mark_read',
  read_at timestamptz,
  created_at timestamptz default now()
);

alter table public.notifications
  add column if not exists action_type text default 'mark_read';

update public.notifications
set action_type = case
  when role_type in ('consultant', 'team_lead') then 'mark_read_assignment'
  when role_type = 'system' then 'assignment_read_confirmation'
  else coalesce(action_type, 'mark_read')
end
where action_type is null or action_type = 'mark_read';

create index if not exists notifications_recipient_user_id_idx on public.notifications(recipient_user_id);
create index if not exists notifications_sender_user_id_idx on public.notifications(sender_user_id);
create index if not exists notifications_mandate_id_idx on public.notifications(mandate_id);
create index if not exists notifications_status_idx on public.notifications(status);
create index if not exists notifications_created_at_idx on public.notifications(created_at);
drop index if exists notifications_assignment_unique_idx;

create unique index if not exists notifications_assignment_unique_idx
  on public.notifications(mandate_id, recipient_user_id, role_type, action_type)
  where action_type = 'mark_read_assignment';

create unique index if not exists notifications_read_confirmation_unique_idx
  on public.notifications(mandate_id, recipient_user_id, sender_user_id, action_type)
  where action_type = 'assignment_read_confirmation';

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select
  using (recipient_user_id = auth.uid());

drop policy if exists notifications_update_own_read_state on public.notifications;
create policy notifications_update_own_read_state
  on public.notifications for update
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

drop policy if exists notifications_insert_service_only on public.notifications;
create policy notifications_insert_service_only
  on public.notifications for insert
  with check (false);

grant select on public.notifications to authenticated;
grant update(status, read_at) on public.notifications to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
end $$;
