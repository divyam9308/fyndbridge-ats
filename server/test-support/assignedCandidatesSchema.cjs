const { PGlite } = require('@electric-sql/pglite')
const fs = require('node:fs/promises')
const path = require('node:path')
const id = n => `70000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ADMIN=id(1), CONSULTANT=id(2), OTHER=id(3), INACTIVE=id(4), SUPER=id(5), CLIENT=id(10), JOB=id(11)
async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create table public.employee_statuses(user_id text primary key,status text,created_at timestamptz default now(),updated_at timestamptz default now(),updated_by uuid);
    create table public.admin_users(id uuid default gen_random_uuid(), user_id uuid,email text,name text,role text,is_super_admin boolean default false,created_at timestamptz default now());
    create table public.user_profiles(id uuid default gen_random_uuid(),user_id text,name text,email text);
    create table public.profiles(id uuid primary key);
    create table public.column_permissions(table_name text,column_key text,access_mode text);
    create table public.page_view_permissions(page_key text primary key,view_permission text,updated_by uuid,updated_at timestamptz);
    create table public.clients(id uuid primary key,client_name text,name text,client_display_id text,client_group_id uuid);
    create table public.jobs(id uuid primary key,client_id uuid references public.clients(id),title text,job_display_id text,mandate_status text default 'Ongoing (P1)',status text default 'Ongoing (P1)',consultants text[] default '{}');
    create table public.candidates(id uuid primary key default gen_random_uuid(),candidate_display_id text unique,full_name text not null,email text,mobile_number text not null,city text,state text,location text,current_designation text,current_company text,current_organisation text,experience_years numeric,notice_period integer,open_to_relocate text,skills text[] default '{}',education text,linkedin_url text,source text,client_id uuid references public.clients(id),cv_storage_path text,cv_link text,resume_url text,cv_file_hash text,cv_original_name text,cv_mimetype text,cv_attachments jsonb default '[]',is_locked boolean default false,created_by uuid,updated_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.candidate_associations(id uuid primary key default gen_random_uuid(),candidate_id uuid references public.candidates(id) on delete cascade,client_id uuid references public.clients(id),job_id uuid references public.jobs(id),client_name text,job_title text,consultant_name text,consultant_user_id uuid,status text,current_salary integer,expected_salary integer,offered_ctc integer,date_of_joining date,notes text,created_by uuid,updated_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create function private.is_current_employee_active() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select status<>'inactive' from public.employee_statuses where user_id=auth.uid()::text),false) $$;
    grant usage on schema public,auth to authenticated,service_role;
    grant usage on schema private to authenticated;
    grant select on public.employee_statuses,public.page_view_permissions to authenticated;
    grant all on all tables in schema public to service_role;

  `)
  const root=path.resolve(__dirname,'../..')
  for(const file of ['20260716192438_candidate_display_id_lowest_available_gap.sql','20261018204815_assigned_candidates.sql','20261019120000_assigned_candidate_relevance_order.sql','20261019121623_assigned_candidate_stable_status_order.sql','20261019175017_consultant_access_controls.sql','20261020042222_assigned_candidate_row_actions.sql','20261021073154_assigned_candidate_owner_workflow.sql']) await db.exec(await fs.readFile(path.join(root,'supabase/migrations',file),'utf8'))
  for (const [uid,name,role,status] of [[ADMIN,'Test Admin','admin','active'],[CONSULTANT,'Test Consultant',null,'active'],[OTHER,'Other Consultant',null,'active'],[INACTIVE,'Inactive Consultant',null,'inactive'],[SUPER,'Super Admin','super_admin','active']]) {
    await db.query('insert into auth.users values($1,$2)',[uid,`${name.replaceAll(' ','').toLowerCase()}@example.test`])
    await db.query('insert into employee_statuses(user_id,status) values($1,$2)',[uid,status])
    await db.query('insert into user_profiles(user_id,name,email) values($1,$2,$3)',[uid,name,`${name}@example.test`])
    await db.query('insert into profiles values($1)',[uid])
    if(role) await db.query('insert into admin_users(user_id,email,name,role,is_super_admin) values($1,$2,$3,$4,$5)',[uid,`${name.replaceAll(' ','').toLowerCase()}@example.test`,name,role,role==='super_admin'])
  }
  await db.query('insert into clients values($1,$2,$2,$3,$1)',[CLIENT,'Example Client','CL10'])
  await db.query('insert into jobs(id,client_id,title,job_display_id) values($1,$2,$3,$4)',[JOB,CLIENT,'Finance Manager','JB11'])
  return db
}
async function upload(db,n,owner=ADMIN) {
  await db.query(`insert into assigned_candidate_uploads(id,uploaded_by,cv_storage_path,cv_original_name,cv_mimetype,cv_file_hash,file_size,storage_ready) values($1,$2,$3,$4,'application/pdf','synthetic-hash',100,true)`,[id(n),owner,`assigned/${owner}/${id(n)}.pdf`, `Candidate-${n}.pdf`])
  return id(n)
}
async function assign(db,n,{status='Not Contacted',consultant=CONSULTANT,actor=ADMIN}={}) {
  await upload(db,n,actor)
  const row={upload_id:id(n),full_name:`Test Candidate ${n}`,mobile_number:`98765${String(n).padStart(5,'0')}`,client_id:CLIENT,job_id:JOB,assigned_consultant_id:consultant,status}
  await db.query('select create_assigned_candidates($1,$2)',[actor,JSON.stringify([row])])
  return (await db.query('select * from assigned_candidates where upload_id=$1',[id(n)])).rows[0]
}
const payload = n => ({full_name:`Test Candidate ${n}`,mobile_number:`98765${String(n).padStart(5,'0')}`,email:`synthetic${n}@example.test`,client_id:CLIENT})
const association = (status='Interested') => ({client_id:CLIENT,job_id:JOB,status,consultant_name:'Test Consultant',consultant_user_id:CONSULTANT})
module.exports={createDatabase,id,ADMIN,CONSULTANT,OTHER,INACTIVE,SUPER,CLIENT,JOB,upload,assign,payload,association}
