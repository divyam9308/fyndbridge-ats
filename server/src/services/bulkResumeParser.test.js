const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  MIN_PDF_EXTRACTED_CHARACTERS,
  createBulkResumeParser,
  isUsableResumeText,
  normalizeResumeText
} = require('./bulkResumeParser')

const quietLogger = { info() {}, warn() {}, error() {} }
const pdfFile = (name = 'resume.pdf') => ({ path: `/tmp/${name}`, originalname: name, mimetype: 'application/pdf' })
const validPdfText = 'Experienced software engineer with leadership, delivery, education, technical skills and project management expertise. '.repeat(3)
const validOcrText = 'Resume profile with experience in recruitment, client delivery, team leadership and candidate management. '.repeat(2)

function harness(overrides = {}) {
  const calls = { pdf: 0, ocr: 0, gemini: 0, existing: 0, texts: [] }
  const parser = createBulkResumeParser({
    readFile: async () => Buffer.from('pdf-buffer'),
    pdfParseImpl: async () => {
      calls.pdf += 1
      return { text: validPdfText }
    },
    extractTextWithOcrImpl: async () => {
      calls.ocr += 1
      return validOcrText
    },
    parseResumeTextImpl: async (text) => {
      calls.gemini += 1
      calls.texts.push(text)
      return { raw_text: text }
    },
    parseResumeFileImpl: async (filePath) => {
      calls.existing += 1
      return { raw_text: filePath }
    },
    logger: quietLogger,
    ...overrides
  })
  return { calls, parser }
}

test('normal text PDF uses pdf-parse and calls Gemini once without OCR', async () => {
  const { calls, parser } = harness()
  const result = await parser(pdfFile())
  assert.equal(calls.pdf, 1)
  assert.equal(calls.ocr, 0)
  assert.equal(calls.gemini, 1)
  assert.equal(result.raw_text, normalizeResumeText(validPdfText))
})

test('scanned or short PDF falls back to OCR and calls Gemini once with OCR text', async () => {
  const { calls, parser } = harness({ pdfParseImpl: async () => ({ text: '   ' }) })
  const result = await parser(pdfFile('scanned.pdf'))
  assert.equal(calls.ocr, 1)
  assert.equal(calls.gemini, 1)
  assert.equal(result.raw_text, normalizeResumeText(validOcrText))

  const short = harness({ pdfParseImpl: async () => ({ text: 'Short but readable PDF resume' }) })
  await short.parser(pdfFile('short.pdf'))
  assert.equal(short.calls.ocr, 1)
  assert.equal(short.calls.gemini, 1)
})

test('pdf-parse error never prevents OCR fallback', async () => {
  const { calls, parser } = harness({ pdfParseImpl: async () => { throw new Error('damaged PDF') } })
  await parser(pdfFile('damaged.pdf'))
  assert.equal(calls.ocr, 1)
  assert.equal(calls.gemini, 1)
})

test('both extraction methods failing returns the existing per-file failure', async () => {
  const { calls, parser } = harness({
    pdfParseImpl: async () => { throw new Error('PDF extraction failed') },
    extractTextWithOcrImpl: async () => {
      calls.ocr += 1
      throw new Error('OCR failed')
    }
  })
  await assert.rejects(parser(pdfFile('failed.pdf')), /OCR failed/)
  assert.equal(calls.gemini, 0)
})

test('multiple PDFs independently choose extraction and never duplicate Gemini calls', async () => {
  const calls = { pdf: 0, ocr: 0, gemini: 0 }
  const parser = createBulkResumeParser({
    readFile: async filePath => Buffer.from(filePath),
    pdfParseImpl: async buffer => {
      calls.pdf += 1
      return { text: buffer.toString().includes('scan') ? '' : validPdfText }
    },
    extractTextWithOcrImpl: async () => {
      calls.ocr += 1
      return validOcrText
    },
    parseResumeTextImpl: async text => {
      calls.gemini += 1
      return { raw_text: text }
    },
    logger: quietLogger
  })

  const results = await Promise.all([
    parser(pdfFile('text.pdf')),
    parser(pdfFile('scan.pdf')),
    parser(pdfFile('second-text.pdf'))
  ])
  assert.equal(results.length, 3)
  assert.deepEqual(calls, { pdf: 3, ocr: 1, gemini: 3 })
})

test('non-PDF resumes keep the existing parser and skip pdf-parse and OCR', async () => {
  const { calls, parser } = harness()
  const result = await parser({ path: '/tmp/resume.docx', originalname: 'resume.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  assert.equal(result.raw_text, '/tmp/resume.docx')
  assert.deepEqual(calls, { pdf: 0, ocr: 0, gemini: 0, existing: 1, texts: [] })
})

test('normalization and usability validation use the required normalized threshold', () => {
  assert.equal(MIN_PDF_EXTRACTED_CHARACTERS, 200)
  assert.equal(normalizeResumeText('  hello\u0000\n\t world  '), 'hello world')
  assert.equal(isUsableResumeText(validPdfText), true)
  assert.equal(isUsableResumeText('\u0001'.repeat(210)), false)
})

test('only Upload Resumes is wired to the scoped parser', () => {
  const resumeController = fs.readFileSync(path.resolve(__dirname, '../controllers/resumeController.js'), 'utf8')
  const candidateController = fs.readFileSync(path.resolve(__dirname, '../controllers/candidateController.js'), 'utf8')
  const candidatesPage = fs.readFileSync(path.resolve(__dirname, '../../../src/pages/CandidatesPage.jsx'), 'utf8')
  assert.match(resumeController, /parseBulkResume\(file\)/)
  assert.match(candidateController, /const \{ parseResume \} = require\('\.\.\/services\/resumeParser'\)/)
  assert.match(candidateController, /await parseResume\(tmpFilePath\)/)
  assert.doesNotMatch(candidateController, /parseBulkResume/)
  assert.match(candidatesPage, /fetch\('\/api\/resumes\/bulk-parse'/)
  assert.match(resumeController, /const rows = await runLimited\(files, 5, parseOne\)/)
  assert.match(resumeController, /catch \(err\) \{[\s\S]*return rowFromParsed\(file, null, err\.message/)
})
