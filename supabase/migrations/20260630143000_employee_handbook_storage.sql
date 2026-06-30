insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-handbook', 'employee-handbook', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf'];

insert into public.app_settings (key, value)
values ('employee_handbook', '{}'::jsonb)
on conflict (key) do nothing;
