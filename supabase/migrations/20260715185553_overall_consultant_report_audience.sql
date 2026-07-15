-- Overall reporting is a separate capability from viewing the Report page.
-- The server accepts only admins or super_admins, and only a Super Admin can
-- change this value through the administration API.
insert into public.app_settings (key, value)
values ('overall_consultant_report_audience', '"admins"'::jsonb)
on conflict (key) do nothing;
