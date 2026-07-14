-- Accurate first-stage tracking starts when this migration is deployed.
-- Historical rows intentionally remain null because no existing timestamp is a
-- reliable substitute for the first time an association reached a stage.
alter table public.candidate_associations
  add column if not exists client_submission_at timestamptz null,
  add column if not exists interview_at timestamptz null,
  add column if not exists offered_at timestamptz null,
  add column if not exists hired_at timestamptz null;

comment on column public.candidate_associations.client_submission_at is
  'First tracked time this association entered Client Submission; tracking begins at migration deployment.';
comment on column public.candidate_associations.interview_at is
  'First tracked time this association entered Interview; tracking begins at migration deployment.';
comment on column public.candidate_associations.offered_at is
  'First tracked time this association entered Offered; tracking begins at migration deployment.';
comment on column public.candidate_associations.hired_at is
  'First tracked time this association entered Hired; tracking begins at migration deployment.';

create or replace function public.set_candidate_association_first_stage_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entered_stage boolean;
begin
  if tg_op = 'INSERT' then
    -- Callers cannot seed or forge first-stage history. On insert, tracking
    -- begins from the canonical initial status and the database clock only.
    new.client_submission_at := null;
    new.interview_at := null;
    new.offered_at := null;
    new.hired_at := null;
    entered_stage := true;
  else
    -- First-occurrence timestamps are immutable after they have been stored.
    -- Including the timestamp columns in the trigger event also prevents a
    -- later direct update from clearing or replacing a tracked occurrence.
    new.client_submission_at := old.client_submission_at;
    new.interview_at := old.interview_at;
    new.offered_at := old.offered_at;
    new.hired_at := old.hired_at;
    entered_stage := new.status is distinct from old.status;
  end if;

  if entered_stage then
    case new.status
      when 'Client Submission' then
        if new.client_submission_at is null then
          new.client_submission_at := now();
        end if;
      when 'Interview' then
        if new.interview_at is null then
          new.interview_at := now();
        end if;
      when 'Offered' then
        if new.offered_at is null then
          new.offered_at := now();
        end if;
      when 'Hired' then
        if new.hired_at is null then
          new.hired_at := now();
        end if;
      else
        null;
    end case;
  end if;

  return new;
end;
$$;

revoke all on function public.set_candidate_association_first_stage_timestamps()
  from public, anon, authenticated;

drop trigger if exists candidate_associations_first_stage_timestamps
  on public.candidate_associations;

create trigger candidate_associations_first_stage_timestamps
before insert or update of
  status,
  client_submission_at,
  interview_at,
  offered_at,
  hired_at
on public.candidate_associations
for each row
execute function public.set_candidate_association_first_stage_timestamps();

-- Preserve any administrator-selected value if this migration is replayed.
insert into public.page_view_permissions (page_key, view_permission)
values ('report', 'everyone')
on conflict (page_key) do nothing;

-- The deployed schema already has the indexes used by the report's bulk reads:
-- candidate_associations(job_id), candidate_associations(status),
-- candidate_associations(consultant_user_id), jobs(allocation_date), and
-- jobs(mandate_status). The report aggregates all association stages in one
-- pass, so composite and per-stage partial indexes would add write cost without
-- serving its query shape and are intentionally not duplicated here.
