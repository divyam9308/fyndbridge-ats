const {createDatabase,assign,ADMIN,CONSULTANT,OTHER}=require('./assignedCandidatesSchema.cjs')
const {databaseAdapter}=require('./assignedCandidatesAdapter.cjs')
async function start(){
  // Synthetic local fixture. Never loads repository secrets or contacts production.
  for(const key of Object.keys(process.env)) if(/GEMINI.*KEY|SUPABASE.*KEY/.test(key)) delete process.env[key]
  const db=await createDatabase();const adapter=databaseAdapter(db)
  const target=require.resolve('../src/services/supabaseAdmin');require.cache[target]={id:target,filename:target,loaded:true,exports:adapter}
  const PDFDocument=require('pdfkit');const chunks=[];const pdf=new PDFDocument();pdf.on('data',x=>chunks.push(x));const completed=new Promise(resolve=>pdf.on('end',resolve))
  pdf.text('Alex Example\nMobile: 9876543210\nEmail: alex@example.test\nExperience\nFinance Manager at Example Limited\nJanuary 2020 to Present\nSkills: Accounting, Budgeting, Reporting\nEducation\nBachelor of Commerce\nMumbai Maharashtra\n'+('Professional financial reporting and management experience. '.repeat(20)));pdf.end();await completed
  const pdfBytes=Buffer.concat(chunks)
  for(let n=1;n<=32;n++) {
    const a=await assign(db,300+n,{status:n<=12?'Not Contacted':n<=20?'Didn’t Pick Up':'Interested',consultant:n===32?OTHER:CONSULTANT})
    const row=(await db.query('select cv_storage_path from assigned_candidate_uploads where id=$1',[a.upload_id])).rows[0]
    adapter.objects.set(row.cv_storage_path,pdfBytes)
  }
  const express=require('express');const app=express();app.use(require('cors')());app.use(express.json())
  app.use((req,res,next)=>{req.user={id:req.get('x-test-user')||CONSULTANT,email:'synthetic@example.test',name:'Test Consultant'};next()})
  app.use('/api/assigned-candidates',require('../src/middleware/requireAuth'),require('../src/routes/assignedCandidates'))
  app.get('/api/clients',(req,res)=>db.query('select * from clients').then(result=>res.json({data:result.rows})))
  app.get('/api/jobs',(req,res)=>db.query('select * from jobs').then(result=>res.json({data:result.rows})))
  app.get('/api/candidates/next-display-id',(req,res)=>res.json({candidate_display_id:'CA1'}))
  app.get('/test/pdf',(req,res)=>res.type('application/pdf').send(pdfBytes))
  app.get('/test/state',async(req,res)=>res.json({assignments:(await db.query('select * from assigned_candidates')).rows,candidates:(await db.query('select * from candidates')).rows,associations:(await db.query('select * from candidate_associations')).rows,removed:adapter.removedPaths}))
  const server=app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port,ADMIN,CONSULTANT,OTHER}))
  process.on('message',async message=>{if(message==='close'){server.close();await db.close();process.exit(0)}})
}
start().catch(error=>{console.error(error);process.exit(1)})
