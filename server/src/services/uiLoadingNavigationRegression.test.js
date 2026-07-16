const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

const loaderComponent = read('src/components/FyndbridgeLoader.jsx')
const loaderCss = read('src/components/FyndbridgeLoader.css')
const candidatesPage = read('src/pages/CandidatesPage.jsx')
const jobsPage = read('src/pages/JobsPage.jsx')
const sidebar = read('src/components/Sidebar.jsx')
const invoicePage = read('src/pages/InvoiceEntityDetailPage.jsx')
const invoiceCss = read('src/pages/InvoicePage.css')

test('Fyndbridge loader remains visible when browser animation is suspended', () => {
  assert.doesNotMatch(loaderComponent, /<animate\b/)
  assert.match(loaderCss, /\.fyndbridge-loader path\s*\{[\s\S]*opacity:\s*\.5[\s\S]*stroke-dashoffset:\s*\.65/)
  assert.match(loaderCss, /@keyframes fyndbridge-loader-draw/)
  assert.match(loaderCss, /prefers-reduced-motion[\s\S]*stroke-dashoffset:\s*0;[\s\S]*opacity:\s*1/)
})

test('candidate initial loading and mandate background refresh ownership remain stable', () => {
  assert.match(candidatesPage, /const \[loadingCandidates, setLoadingCandidates\] = useState\(true\)/)
  assert.match(jobsPage, /const fetchData = useCallback\(async \(\{ showLoading = true \} = \{\}\) =>/)
  assert.match(jobsPage, /const refreshJobsRealtime[\s\S]*fetchData\(\{ showLoading: false \}\)/)
  assert.match(jobsPage, /const refreshJobs = \(\) => fetchData\(\{ showLoading: false \}\)/)
})

test('PMS sidebar navigation commits on the initial primary pointer event', () => {
  assert.match(sidebar, /location\.pathname !== '\/dashboard\/performance'/)
  assert.match(sidebar, /event\.preventDefault\(\)/)
  assert.match(sidebar, /document\.activeElement instanceof HTMLElement/)
  assert.match(sidebar, /navigate\(to\)/)
  assert.match(sidebar, /onPointerDown=\{\(event\) => navigateFromPerformancePointer\(event, to\)\}/)
})

test('invoice detail table uses one shared column model with centered non-overlapping cells', () => {
  assert.match(invoicePage, /const DETAIL_COLUMNS = \[/)
  assert.match(invoicePage, /<colgroup>\{DETAIL_COLUMNS\.map/)
  assert.match(invoiceCss, /\.invoice-detail-table th[\s\S]*text-align:\s*center/)
  assert.match(invoiceCss, /\.invoice-detail-table td[\s\S]*vertical-align:\s*middle[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(invoiceCss, /\.invoice-wrap-cell\s*\{[\s\S]*overflow-wrap:\s*anywhere/)
})
