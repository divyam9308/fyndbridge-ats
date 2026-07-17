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

test('Fyndbridge loader resets invisibly without a persistent outline or backward stroke', () => {
  assert.doesNotMatch(loaderComponent, /<animate\b/)
  assert.doesNotMatch(loaderComponent, /fyndbridge-loader-track/)
  assert.match(loaderComponent, /className="fyndbridge-loader-progress"/)
  assert.doesNotMatch(loaderCss, /fyndbridge-loader-track/)
  assert.match(loaderCss, /\.fyndbridge-loader-progress path\s*\{[\s\S]*opacity:\s*0;[\s\S]*stroke-dasharray:\s*1;[\s\S]*stroke-dashoffset:\s*1;[\s\S]*animation:\s*fyndbridge-loader-draw/)
  assert.match(loaderCss, /@keyframes fyndbridge-loader-draw/)
  assert.match(loaderCss, /0%,[\s\S]*4%\s*\{[\s\S]*opacity:\s*0;[\s\S]*stroke-dashoffset:\s*1/)
  assert.match(loaderCss, /94%,[\s\S]*100%\s*\{[\s\S]*opacity:\s*0/)
  assert.doesNotMatch(loaderCss, /stroke-dashoffset:\s*-/)
  assert.match(loaderCss, /prefers-reduced-motion[\s\S]*fyndbridge-loader-progress path[\s\S]*animation:\s*none;[\s\S]*opacity:\s*1;[\s\S]*stroke-dashoffset:\s*0/)
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
  assert.match(invoicePage, /const PROFORMA_DETAIL_COLUMNS = DETAIL_COLUMNS\.filter/)
  assert.match(invoicePage, /<colgroup>\{columns\.map/)
  assert.match(invoiceCss, /\.invoice-detail-table th[\s\S]*text-align:\s*center/)
  assert.match(invoiceCss, /\.invoice-detail-table td[\s\S]*vertical-align:\s*middle[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(invoiceCss, /\.invoice-wrap-cell\s*\{[\s\S]*overflow-wrap:\s*anywhere/)
})
