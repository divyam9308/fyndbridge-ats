import test from 'node:test'
import assert from 'node:assert/strict'
import { canViewPage, firstPermittedPageRoute, PAGE_VIEW_DEFAULTS, PAGE_VIEW_ITEMS } from './pageViewPermissions.js'
const SELECTED='70000000-0000-4000-8000-000000000002'
const OTHER='70000000-0000-4000-8000-000000000003'
test('page permissions combine role with the exact authenticated consultant ID',()=>{
  assert.equal(canViewPage({userId:SELECTED},'admin_only',[SELECTED]),true)
  assert.equal(canViewPage({userId:OTHER,user_metadata:{user_id:SELECTED}},'admin_only',[SELECTED]),false)
  assert.equal(canViewPage({},'admin_only',[SELECTED]),false)
  assert.equal(canViewPage({isAdmin:true},'admin_only'),true)
  assert.equal(canViewPage({isSuperAdmin:true},'super_admin_only'),true)
  assert.equal(canViewPage({isAdmin:true},'super_admin_only'),false)
  assert.equal(canViewPage({isSuperAdmin:true},'invalid'),false)
})
test('fallback routing includes an individually permitted CRM page and never chooses action keys',()=>{
  const permissions=Object.fromEntries(PAGE_VIEW_ITEMS.map(([key])=>[key,'super_admin_only']))
  assert.equal(firstPermittedPageRoute({userId:SELECTED},permissions,'',{crm:[SELECTED]}),'/dashboard/crm')
  assert.equal(firstPermittedPageRoute({userId:OTHER},permissions,'',{crm:[SELECTED]}),'/login')
  assert.equal(firstPermittedPageRoute({userId:SELECTED},permissions,'',{assigned_candidates_manage:[SELECTED],assigned_candidates_overall:[SELECTED]}),'/login')
  assert.equal(PAGE_VIEW_DEFAULTS.assigned_candidates_manage,'admin_only')
  assert.equal(PAGE_VIEW_DEFAULTS.assigned_candidates_overall,'admin_only')
})
