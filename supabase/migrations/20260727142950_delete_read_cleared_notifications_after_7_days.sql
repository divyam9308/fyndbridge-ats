create extension if not exists pg_cron with schema pg_catalog;

do $schedule$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'delete-read-cleared-notifications-after-7-days';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'delete-read-cleared-notifications-after-7-days',
    '17 * * * *',
    $cleanup$
      delete from public.notifications
      where status = 'read'
        and cleared_at is not null
        and cleared_at <= now() - interval '7 days';
    $cleanup$
  );
end
$schedule$;

delete from public.notifications
where status = 'read'
  and cleared_at is not null
  and cleared_at <= now() - interval '7 days';
