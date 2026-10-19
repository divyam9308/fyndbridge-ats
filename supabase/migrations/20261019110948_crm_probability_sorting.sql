-- Rank manual conversion bands before pagination; unspecified values remain last.
create or replace function public.crm_list(p_search text default '', p_follow_up text default 'all', p_today date default current_date, p_page integer default 1, p_size integer default 25, p_sort text default 'created_at', p_ascending boolean default false) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb; total integer;
begin
  with filtered as (
    select c.* from public.crm_clients c
    where (p_search='' or strpos(lower(concat_ws(' ',c.organisation_name,(select string_agg(concat_ws(' ',ct->>'name',ct->>'mobile',ct->>'email',ct->>'designation',ct->>'linkedin'),' ') from jsonb_array_elements(c.contacts) ct),c.sector,c.connected_through,c.status)),lower(p_search))>0)
      and case p_follow_up when 'overdue' then c.next_follow_up_date<p_today when 'today' then c.next_follow_up_date=p_today when 'upcoming' then c.next_follow_up_date>p_today when 'none' then c.next_follow_up_date is null else true end
  ), paged as (
    select * from filtered order by
      case when p_sort='conversion_probability' and p_ascending then array_position(array['<25%','25-50%','50-75%','75-100%'],conversion_probability) end asc nulls last,
      case when p_sort='conversion_probability' and not p_ascending then array_position(array['<25%','25-50%','50-75%','75-100%'],conversion_probability) end desc nulls last,
      case when p_sort='organisation_name' and p_ascending then lower(organisation_name) end asc,
      case when p_sort='organisation_name' and not p_ascending then lower(organisation_name) end desc,
      case when p_sort='created_at' and p_ascending then created_at end asc,
      case when p_sort='created_at' and not p_ascending then created_at end desc,
      id offset ((greatest(p_page,1)-1)*least(greatest(p_size,1),100)) limit least(greatest(p_size,1),100)
  ) select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('latest_comment',(select to_jsonb(cm) from public.crm_comments cm where cm.crm_client_id=p.id order by cm.created_at desc,cm.id desc limit 1))),'[]'::jsonb), (select count(*) from filtered) into result,total from paged p;
  return jsonb_build_object('data',result,'total',total);
end;
$$;
revoke all on function public.crm_list(text,text,date,integer,integer,text,boolean) from public, anon, authenticated;
grant execute on function public.crm_list(text,text,date,integer,integer,text,boolean) to service_role;
