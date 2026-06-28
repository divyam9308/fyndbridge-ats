create index if not exists idx_notifications_cleanup_cleared_created
on public.notifications (cleared_at, created_at)
where cleared_at is not null;
