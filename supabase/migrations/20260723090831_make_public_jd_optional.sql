set statement_timeout = '60s';
set lock_timeout = '5s';

begin;

alter table public.jobs
  drop constraint if exists jobs_public_listing_complete;

alter table public.jobs
  add constraint jobs_public_listing_complete
  check (
    not is_public
    or (
      nullif(btrim(public_slug), '') is not null
      and nullif(btrim(public_name), '') is not null
      and nullif(btrim(public_location), '') is not null
      and nullif(btrim(public_experience), '') is not null
      and array_position(public_skills, null) is null
      and application_deadline is not null
    )
  ) not valid;

alter table public.jobs
  validate constraint jobs_public_listing_complete;

commit;
