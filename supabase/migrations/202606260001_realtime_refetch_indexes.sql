create index if not exists candidates_created_at_desc_idx
on public.candidates (created_at desc);

create index if not exists clients_created_at_desc_idx
on public.clients (created_at desc);

create index if not exists jobs_created_at_desc_idx
on public.jobs (created_at desc);

create index if not exists candidate_associations_candidate_created_idx
on public.candidate_associations (candidate_id, created_at desc);

create index if not exists jobs_client_created_idx
on public.jobs (client_id, created_at desc);

create index if not exists notifications_recipient_uncleared_created_idx
on public.notifications (recipient_user_id, created_at desc)
where cleared_at is null;
