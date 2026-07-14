alter table public.candidates
  alter column open_to_relocate type text
  using case
    when open_to_relocate is true then 'true'
    when open_to_relocate is false then 'false'
    else null
  end;

alter table public.candidates
  add constraint candidates_open_to_relocate_values
  check (open_to_relocate is null or open_to_relocate in ('true', 'false', 'NA'));
