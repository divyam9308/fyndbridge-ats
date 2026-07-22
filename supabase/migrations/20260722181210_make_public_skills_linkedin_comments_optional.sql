set statement_timeout = '60s';
set lock_timeout = '5s';

begin;

do $$
begin
  if to_regclass('public.jobs') is null
    or to_regclass('public.public_applications') is null then
    raise exception 'Apply the Public Open Roles migration before this correction';
  end if;
end $$;

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
      and nullif(btrim(public_jd), '') is not null
    )
  ) not valid;

alter table public.jobs
  validate constraint jobs_public_listing_complete;

alter table public.public_applications
  alter column linkedin_url drop not null,
  alter column comments drop not null,
  drop constraint if exists public_applications_required_text_check;

alter table public.public_applications
  add constraint public_applications_required_text_check
  check (
    nullif(btrim(public_role_name), '') is not null
    and nullif(btrim(internal_job_title_snapshot), '') is not null
    and nullif(btrim(client_name_snapshot), '') is not null
    and nullif(btrim(full_name), '') is not null
    and nullif(btrim(email), '') is not null
    and nullif(btrim(email_normalized), '') is not null
    and nullif(btrim(mobile_number), '') is not null
    and nullif(btrim(mobile_normalized), '') is not null
    and nullif(btrim(current_designation), '') is not null
    and nullif(btrim(current_organisation), '') is not null
    and nullif(btrim(location), '') is not null
  ) not valid;

alter table public.public_applications
  validate constraint public_applications_required_text_check;

commit;
