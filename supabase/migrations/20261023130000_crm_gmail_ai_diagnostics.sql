-- Retain a bounded copy of the model response when Gmail analysis fails.
-- This is server-only diagnostic data; it is never used to create an activity.
alter table public.crm_gmail_jobs
  add column ai_raw_response text;

alter table public.crm_gmail_jobs
  add constraint crm_gmail_jobs_ai_raw_response_length
  check (ai_raw_response is null or length(ai_raw_response) <= 20000);
