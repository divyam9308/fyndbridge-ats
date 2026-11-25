#!/usr/bin/env node
const fs = require('node:fs/promises')
const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true })
const { planCandidateCvCleanup, applyCandidateCvCleanup } = require('../src/services/cvDuplicateCleanup')
const { isUuid } = require('../src/services/assignedCandidates')

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('Dry-run: node server/scripts/cv-duplicate-cleanup.js --candidate-id UUID [--candidate-id UUID] [--hash-missing] --out /private/plan.json\nApply reviewed references only: node server/scripts/cv-duplicate-cleanup.js --apply --plan /private/plan.json\nAt most 25 explicit candidate IDs and 50 references per candidate. No historical branding or physical storage deletion.')
    return
  }
  const ids = [], options = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--candidate-id') ids.push(args[++i])
    else if (['--plan', '--out'].includes(args[i])) options[args[i].slice(2)] = args[++i]
    else if (['--apply', '--hash-missing'].includes(args[i])) options[args[i].slice(2)] = true
    else throw new Error(`Unknown option: ${args[i]}`)
  }
  const supabase = require('../src/services/supabaseAdmin')
  if (options.apply) {
    if (!options.plan || ids.length) throw new Error('Apply requires one reviewed --plan file and no candidate IDs.')
    const report = JSON.parse(await fs.readFile(options.plan, 'utf8'))
    if (report.version !== 1 || !Array.isArray(report.candidates) || report.candidates.length < 1 || report.candidates.length > 25 ||
      report.candidates.some(plan => !isUuid(plan.candidate_id) || !Array.isArray(plan.retained) || plan.retained.length > 50)) throw new Error('Invalid bounded cleanup plan.')
    for (const plan of report.candidates) console.log(JSON.stringify(await applyCandidateCvCleanup(supabase, plan)))
    return
  }
  if (!ids.length || ids.length > 25 || ids.some(id => !isUuid(id))) throw new Error('Choose 1–25 explicit candidate UUIDs. No production-wide scan is supported.')
  const candidates = []
  for (const id of new Set(ids)) {
    const result = await supabase.from('candidates').select('*').eq('id', id).maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new Error(`Candidate not found: ${id}`)
    candidates.push(await planCandidateCvCleanup(supabase, result.data, { hashMissing: Boolean(options['hash-missing']) }))
  }
  const report = JSON.stringify({ version: 1, dry_run: true, created_at: new Date().toISOString(), candidates }, null, 2)
  if (options.out) await fs.writeFile(options.out, report + '\n', { mode: 0o600, flag: 'wx' })
  else console.log(report)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
