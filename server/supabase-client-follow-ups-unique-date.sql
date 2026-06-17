create unique index if not exists client_follow_ups_client_id_follow_up_date_unique
on public.client_follow_ups (client_id, follow_up_date);
