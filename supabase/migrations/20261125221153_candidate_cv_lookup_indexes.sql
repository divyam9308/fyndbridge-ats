-- Support equality lookups across the three CV reference fields.
-- Non-unique indexes preserve existing data, constraints and permission rules.
-- Bound lock waits and build duration for this small table during rollout.
set local lock_timeout = '500ms';
set local statement_timeout = '3s';

create index if not exists candidates_cv_link_idx
  on public.candidates using btree (cv_link);
create index if not exists candidates_resume_url_idx
  on public.candidates using btree (resume_url);
create index if not exists candidates_cv_storage_path_idx
  on public.candidates using btree (cv_storage_path);
