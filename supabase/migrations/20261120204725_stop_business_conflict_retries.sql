-- Business version conflicts are permanent for the submitted payload. SQLSTATE
-- 40001 makes affected PostgREST versions retry that payload indefinitely.
-- Replace only the error code; preserve each current function body, invoker
-- privileges, fixed search_path, ownership checks, row locks and EXECUTE grants.
do $migration$
declare
  signature text;
  function_oid regprocedure;
  definition text;
begin
  foreach signature in array array[
    'public.update_assigned_candidate(uuid,uuid,jsonb,bigint)',
    'public.set_assigned_candidate_status(uuid,uuid,text,bigint)',
    'public.crm_save(uuid,uuid,integer,jsonb)'
  ] loop
    function_oid := to_regprocedure(signature);
    -- Isolated module databases may not install the other module.
    if function_oid is null then continue; end if;
    definition := pg_get_functiondef(function_oid);
    if position('errcode=''40001''' in definition) > 0 then
      execute replace(definition, 'errcode=''40001''', 'errcode=''PT409''');
    elsif position('errcode=''PT409''' in definition) = 0 then
      raise exception 'Expected version-conflict guard missing from %', signature;
    end if;
  end loop;
end;
$migration$;
