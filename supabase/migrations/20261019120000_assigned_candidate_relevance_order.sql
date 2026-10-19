-- Preserve existing assignment statuses while allowing the new assignment-only state.
begin;
alter table public.assigned_candidates drop constraint assigned_candidates_status_check;
alter table public.assigned_candidates add constraint assigned_candidates_status_check check (status in (
  'Not Contacted', 'Didn’t Pick Up', 'Not Relevant', 'Interested', 'In Discussion', 'Not Interested', 'Interview',
  'Client Submission', 'Offered', 'Hired', 'Offer Declined', 'Dropout', 'Rejected by Recruiter', 'Rejected by Client'
));

-- Recompute existing rows too. The two ordering indexes depend on this generated column
-- and are recreated below; no assignment records or CV references are changed.
alter table public.assigned_candidates drop column sort_group;
alter table public.assigned_candidates add column sort_group integer generated always as (
  case when added_at is not null then 4
       when status = 'Not Contacted' then 0
       when status = 'Didn’t Pick Up' then 1
       when status = 'Not Relevant' then 2
       else 3 end
) stored;
create index assigned_candidates_scope_order_idx on public.assigned_candidates(assigned_consultant_id, sort_group, assigned_at, id);
create index assigned_candidates_overall_order_idx on public.assigned_candidates(sort_group, assigned_at, id);
commit;
