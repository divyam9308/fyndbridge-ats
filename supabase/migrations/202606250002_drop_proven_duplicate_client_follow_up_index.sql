-- Drop only if both indexes are structurally identical and neither supports a constraint.
do $$
declare
  keep_oid oid := to_regclass('public.client_follow_ups_client_id_follow_up_date_unique');
  drop_oid oid := to_regclass('public.client_follow_ups_client_date_unique_idx');
  are_identical boolean := false;
  supports_constraint boolean := false;
begin
  if keep_oid is null or drop_oid is null then
    raise notice 'Client follow-up duplicate-index check skipped: one or both indexes do not exist.';
    return;
  end if;

  select k.indrelid = d.indrelid
     and k.indisunique = d.indisunique
     and k.indkey = d.indkey
     and k.indclass = d.indclass
     and k.indcollation = d.indcollation
     and k.indoption = d.indoption
     and coalesce(pg_get_expr(k.indpred, k.indrelid), '') = coalesce(pg_get_expr(d.indpred, d.indrelid), '')
     and coalesce(pg_get_expr(k.indexprs, k.indrelid), '') = coalesce(pg_get_expr(d.indexprs, d.indrelid), '')
    into are_identical
  from pg_index k cross join pg_index d
  where k.indexrelid = keep_oid and d.indexrelid = drop_oid;

  select exists (
    select 1 from pg_constraint
    where conindid in (keep_oid, drop_oid)
  ) into supports_constraint;

  if are_identical and not supports_constraint then
    execute 'drop index public.client_follow_ups_client_date_unique_idx';
  else
    raise notice 'Client follow-up duplicate-index check skipped: indexes differ or support a constraint.';
  end if;
end $$;
