alter table public.crm_clients drop constraint if exists crm_clients_connected_through_check;
alter table public.crm_clients add constraint crm_clients_connected_through_check
  check (connected_through in ('LinkedIn','Referral','Cold Email','Cold Call','Existing Client','Candidate','Other'));
