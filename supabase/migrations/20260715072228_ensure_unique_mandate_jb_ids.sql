create unique index if not exists jobs_job_display_id_unique_idx
  on public.jobs (job_display_id)
  where job_display_id is not null;
