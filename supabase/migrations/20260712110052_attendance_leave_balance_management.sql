insert into public.attendance_permissions(permission_key, access_level)
values ('attendance_manage_leave_balances', 'admins')
on conflict (permission_key) do nothing;
