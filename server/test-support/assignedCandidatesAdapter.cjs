// Supabase query interface backed by the isolated PostgreSQL test database.
function databaseAdapter(db) {
  const objects=new Map(),removedPaths=[]
  const storage={from:()=>({
    upload:async(path,bytes)=>{if(objects.has(path))return {error:new Error('already exists')};objects.set(path,bytes);return {data:{path}}},
    remove:async paths=>{for(const path of paths){objects.delete(path);removedPaths.push(path)}return {data:[]}},
    download:async path=>objects.has(path)?{data:new Blob([objects.get(path)])}:{error:new Error('Missing CV')},
    createSignedUrl:async path=>({data:{signedUrl:`https://example.test/protected/${encodeURIComponent(path)}`}})
  })}
  return {storage,objects,removedPaths,
    async rpc(name,args={}) {try {const entries=Object.entries(args);if(name==='assigned_candidates_consultant_counts')return {data:(await db.query('select * from assigned_candidates_consultant_counts()')).rows};const q=await db.query(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')}) as result`,entries.map(([,value])=>value&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value));return {data:q.rows[0]?.result}}catch(error){return {error}}},
    from(table) {
      const filters=[],params=[],orders=[];let kind='select',values,selection='*',head=false,count=false,take,offset=0,returnRows=true
      const value=x=>{params.push(x);return `$${params.length}`}
      const key=x=>`t."${x}"`
      const condition=(field,op,x)=>`${key(field)} ${op} ${value(x)}`
      const b={
        select(s='*',options={}){selection=s;head=options.head;count=options.count;returnRows=true;return b},
        eq(f,x){filters.push(condition(f,'=',x));return b},
        neq(f,x){filters.push(condition(f,'<>',x));return b},
        ilike(f,x){filters.push(condition(f,'ilike',x));return b},
        in(f,x){filters.push(`${key(f)}=any(${value(x)})`);return b},
        is(f,x){filters.push(x===null?`${key(f)} is null`:condition(f,'=',x));return b},
        not(f,op,x){filters.push(op==='is'?`${key(f)} is not null`:condition(f,'<>',x));return b},
        contains(f,x){filters.push(`${key(f)} @> ${value(JSON.stringify(x))}::jsonb`);return b},
        or(expression){filters.push('('+expression.split(',').map(term=>{const [field,op,...rest]=term.split('.');const x=rest.join('.');if(op==='not'&&x==='is.null')return `${key(field)} is not null`;return condition(field,{eq:'=',lt:'<',ilike:'ilike'}[op],x)}).join(' or ')+')');return b},
        order(f,{ascending=true}={}){orders.push(`${key(f)} ${ascending?'asc':'desc'}`);return b},
        limit(n){take=n;return b},range(from,to){offset=from;take=to-from+1;return b},
        insert(v){kind='insert';values=v;returnRows=false;return b},
        update(v){kind='update';values=v;returnRows=false;return b},
        delete(){kind='delete';returnRows=false;return b},
        async execute(single=false){
          try{
            const where=filters.length?' where '+filters.join(' and '):''
            let total
            if(count)total=Number((await db.query(`select count(*)::int as count from public.${table} t${where}`,params)).rows[0].count)
            let rows
            if(kind==='select') {
              let extra=''
              if(table==='assigned_candidates') extra=`,(select to_jsonb(c) from clients c where c.id=t.client_id) as clients,(select to_jsonb(j) from jobs j where j.id=t.job_id) as jobs,(select to_jsonb(u) from assigned_candidate_uploads u where u.id=t.upload_id) as assigned_candidate_uploads`
              if(table==='jobs') extra=`,(select to_jsonb(c) from clients c where c.id=t.client_id) as clients`
              if(table==='candidate_associations'&&selection.includes('candidates')) extra=`,(select to_jsonb(c) from candidates c where c.id=t.candidate_id) as candidates`
              rows=(await db.query(`select t.*${extra} from public.${table} t${where}${orders.length?' order by '+orders.join(','):''}${take!==undefined?' limit '+Number(take):''} offset ${offset}`,params)).rows
            } else if(kind==='insert') {
              const columns=Object.keys(values);const args=columns.map(k=>typeof values[k]==='object'?JSON.stringify(values[k]):values[k])
              rows=(await db.query(`insert into public.${table}(${columns.map(k=>`"${k}"`).join(',')}) values(${columns.map((_,i)=>`$${i+1}`).join(',')}) returning *`,args)).rows
            } else if(kind==='update') {
              const updates=Object.entries(values).map(([k,x])=>`"${k}"=${value(typeof x==='object'&&x!==null?JSON.stringify(x):x)}`)
              rows=(await db.query(`update public.${table} t set ${updates.join(',')}${where} returning *`,params)).rows
            } else rows=(await db.query(`delete from public.${table} t${where} returning *`,params)).rows
            return {data:head?null:single?rows[0]||null:returnRows?rows:null,count:total,error:null}
          }catch(error){return {data:null,error}}
        },
        then(resolve,reject){return b.execute().then(resolve,reject)},single(){return b.execute(true)},maybeSingle(){return b.execute(true)}
      };return b
    }
  }
}
module.exports={databaseAdapter}
