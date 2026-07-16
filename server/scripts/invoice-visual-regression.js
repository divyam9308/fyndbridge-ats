const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { renderInvoicePdf, selectInvoiceLayout } = require('../src/services/invoiceService')
const { CASES, renderPayloadForCase } = require('./invoice-visual-fixtures')

const REPO_ROOT = path.resolve(__dirname, '../..')
const PDF_OUTPUT_DIR = path.join(REPO_ROOT, 'output/pdf')
const VISUAL_OUTPUT_DIR = path.join(REPO_ROOT, 'output/invoice-visual-regression')
const COMPARATOR = path.join(__dirname, 'invoice_visual_compare.py')

function parseArgs(argv) {
  const options = {
    references: process.env.INVOICE_REFERENCE_DIR || path.join(os.homedir(), 'Downloads'),
    python: process.env.PYTHON || 'python3',
    dpi: 300,
    pixelTolerance: 12,
    maxDiffPercent: 0.1,
    noFail: false,
    list: false,
    cases: []
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      index += 1
      return value
    }
    if (argument === '--references') options.references = path.resolve(next())
    else if (argument === '--python') options.python = next()
    else if (argument === '--dpi') options.dpi = Number(next())
    else if (argument === '--pixel-tolerance') options.pixelTolerance = Number(next())
    else if (argument === '--max-diff-percent') options.maxDiffPercent = Number(next())
    else if (argument === '--case') options.cases.push(...next().split(',').map(value => value.trim()).filter(Boolean))
    else if (argument === '--no-fail') options.noFail = true
    else if (argument === '--list') options.list = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!Number.isFinite(options.dpi) || options.dpi < 72 || options.dpi > 600) throw new Error('--dpi must be between 72 and 600')
  if (!Number.isInteger(options.pixelTolerance) || options.pixelTolerance < 0 || options.pixelTolerance > 255) throw new Error('--pixel-tolerance must be an integer from 0 to 255')
  if (!Number.isFinite(options.maxDiffPercent) || options.maxDiffPercent < 0 || options.maxDiffPercent > 100) throw new Error('--max-diff-percent must be from 0 to 100')
  return options
}

function usage() {
  return [
    'Generate and visually compare all six invoice reference cases.',
    '',
    'Usage:',
    '  node server/scripts/invoice-visual-regression.js [options]',
    '',
    'Options:',
    '  --references DIR          Directory containing the six source PDFs',
    '  --case ID[,ID]            Run one or more explicit case IDs',
    '  --dpi N                   Raster resolution (default: 300)',
    '  --pixel-tolerance N       Ignore per-pixel RGB deltas <= N (default: 12)',
    '  --max-diff-percent N      Advisory visual threshold (default: 0.1)',
    '  --python COMMAND          Python executable (default: python3)',
    '  --no-fail                 Produce artifacts but return success on mismatches',
    '  --list                    List case IDs and source mappings',
    '',
    `PDFs:    ${path.relative(REPO_ROOT, PDF_OUTPUT_DIR)}`,
    `Reports: ${path.relative(REPO_ROOT, VISUAL_OUTPUT_DIR)}`
  ].join('\n')
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (options.list) {
    CASES.forEach(item => console.log(`${item.id}\t${item.referenceFile}`))
    return
  }

  const selected = options.cases.length
    ? CASES.filter(item => options.cases.includes(item.id))
    : [...CASES]
  const unknown = options.cases.filter(id => !CASES.some(item => item.id === id))
  if (unknown.length) throw new Error(`Unknown case ID(s): ${unknown.join(', ')}`)
  if (!selected.length) throw new Error('No invoice cases selected')

  const missingReferences = selected
    .map(item => path.join(options.references, item.referenceFile))
    .filter(filePath => !fs.existsSync(filePath))
  if (missingReferences.length) {
    throw new Error(`Missing reference PDF(s):\n${missingReferences.map(filePath => `  ${filePath}`).join('\n')}`)
  }

  fs.mkdirSync(PDF_OUTPUT_DIR, { recursive: true })
  fs.rmSync(VISUAL_OUTPUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(VISUAL_OUTPUT_DIR, { recursive: true })

  const manifestCases = []
  for (const definition of selected) {
    const payload = renderPayloadForCase(definition)
    const rendered = await renderInvoicePdf(payload)
    const layout = selectInvoiceLayout(payload.invoice)
    const generatedPdf = path.join(PDF_OUTPUT_DIR, `${definition.id}.pdf`)
    fs.writeFileSync(generatedPdf, rendered.buffer)
    const referencePdf = path.join(options.references, definition.referenceFile)
    manifestCases.push({
      id: definition.id,
      entity: definition.entity,
      tax_type: definition.taxType,
      rounding: definition.rounding,
      reference_file: definition.referenceFile,
      reference_pdf: referencePdf,
      reference_sha256: sha256(referencePdf),
      generated_pdf: generatedPdf,
      generated_sha256: sha256(generatedPdf),
      renderer_reported_page_count: rendered.pageCount,
      expected_text: payload.expectedText,
      tax_summary: {
        columns: layout.x.summary,
        data_top: layout.y.summaryHeader,
        total_top: layout.y.summaryData,
        bottom: layout.y.summaryBottom
      },
      a4_profile: definition.a4Profile
    })
    console.log(`generated ${path.relative(REPO_ROOT, generatedPdf)}`)
  }

  const manifestPath = path.join(VISUAL_OUTPUT_DIR, 'run-manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    target_page: { name: 'A4', width_points: 595.28, height_points: 841.89 },
    source_normalization: {
      horizontal_scale: 595.275590551 / 612,
      method: 'case-specific piecewise A4 mapping from FORENSIC_MEASUREMENTS.md',
      note: 'pixel diffs are diagnostic because elastic-zone raster warping distorts glyphs and source PDFs contain numeric defects'
    },
    dpi: options.dpi,
    pixel_tolerance: options.pixelTolerance,
    max_diff_percent: options.maxDiffPercent,
    cases: manifestCases
  }, null, 2)}\n`)

  const comparatorArgs = [
    COMPARATOR,
    '--manifest', manifestPath,
    '--output', VISUAL_OUTPUT_DIR,
    '--dpi', String(options.dpi),
    '--pixel-tolerance', String(options.pixelTolerance),
    '--max-diff-percent', String(options.maxDiffPercent),
    ...(options.noFail ? ['--no-fail'] : [])
  ]
  const result = spawnSync(options.python, comparatorArgs, { cwd: REPO_ROOT, stdio: 'inherit' })
  if (result.error) throw new Error(`Unable to run ${options.python}: ${result.error.message}`)
  if (result.status !== 0) process.exitCode = result.status || 1
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
