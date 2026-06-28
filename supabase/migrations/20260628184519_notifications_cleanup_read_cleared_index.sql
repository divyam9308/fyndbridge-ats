create index if not exists idx_notifications_cleanup_read_cleared
on public.notifications (status, cleared_at)
where cleared_at is not null
  and status = 'read';
