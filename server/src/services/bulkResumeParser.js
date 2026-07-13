const fs = require('fs/promises')
const path = require('path')
const pdfParse = require('pdf-parse')
const { getDocumentFileMeta } = require('./documentFile')
const { extractTextWithOcr, parseResume, parseResumeText } = require('./resumeParser')

const MIN_PDF_EXTRACTED_CHARACTERS = 200

function normalizeResumeText(value) {
  return String(value || '')
    .split('\u0000').join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsableResumeText(value) {
  const text = String(value || '')
  if (!text) return false

  const controlCharacters = [...text].filter((character) => {
    const code = character.charCodeAt(0)
    return (code >= 1 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
  }).length
  const replacementCharacters = (text.match(/\uFFFD/g) || []).length
  const meaningfulCharacters = (text.match(/[\p{L}\p{N}]/gu) || []).length

  return controlCharacters <= Math.max(3, Math.floor(text.length * 0.02))
    && replacementCharacters <= Math.max(3, Math.floor(text.length * 0.02))
    && meaningfulCharacters >= Math.min(40, Math.ceil(text.length * 0.2))
}

function safeLogFileName(file) {
  const printableName = [...path.basename(String(file?.originalname || file?.filename || 'resume.pdf'))]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
  return printableName
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\d{7,}/g, '[redacted-number]')
    .slice(0, 120) || 'resume.pdf'
}

function fallbackReason(normalizedText, extractionError) {
  if (extractionError) return 'extraction_error'
  if (normalizedText.length < MIN_PDF_EXTRACTED_CHARACTERS) return 'insufficient_text'
  return 'unusable_text'
}

function createBulkResumeParser({
  readFile = fs.readFile,
  pdfParseImpl = pdfParse,
  extractTextWithOcrImpl = extractTextWithOcr,
  parseResumeFileImpl = parseResume,
  parseResumeTextImpl = parseResumeText,
  logger = console,
  now = Date.now
} = {}) {
  return async function parseBulkResume(file) {
    const meta = getDocumentFileMeta(file)
    if (meta.extension !== 'pdf') return parseResumeFileImpl(file.path)

    const startedAt = now()
    const fileName = safeLogFileName(file)
    let normalizedText = ''
    let extractionError = null

    const fileBuffer = await readFile(file.path)
    try {
      const parsed = await pdfParseImpl(fileBuffer)
      normalizedText = normalizeResumeText(parsed?.text)
    } catch (error) {
      extractionError = error
      logger.warn('[upload-resumes] PDF text extraction failed', {
        fileName,
        failureStage: 'pdf-parse',
        errorName: error?.name || 'Error'
      })
    }

    const validPdfText = normalizedText.length >= MIN_PDF_EXTRACTED_CHARACTERS
      && isUsableResumeText(normalizedText)

    if (validPdfText) {
      logger.info('[upload-resumes] PDF extraction completed', {
        fileName,
        extractionMethod: 'pdf-parse',
        characterCount: normalizedText.length,
        ocrFallback: false,
        durationMs: now() - startedAt
      })
      return parseResumeTextImpl(normalizedText)
    }

    logger.info('[upload-resumes] Falling back to OCR', {
      fileName,
      characterCount: normalizedText.length,
      reason: fallbackReason(normalizedText, extractionError),
      ocrFallback: true
    })

    try {
      const ocrText = normalizeResumeText(await extractTextWithOcrImpl(fileBuffer))
      if (!isUsableResumeText(ocrText)) {
        const error = new Error('OCR did not produce usable resume text')
        error.code = 'OCR_TEXT_UNUSABLE'
        throw error
      }
      logger.info('[upload-resumes] PDF extraction completed', {
        fileName,
        extractionMethod: 'ocr',
        characterCount: ocrText.length,
        ocrFallback: true,
        durationMs: now() - startedAt
      })
      return parseResumeTextImpl(ocrText)
    } catch (error) {
      logger.error('[upload-resumes] PDF extraction failed', {
        fileName,
        failureStage: 'ocr',
        errorName: error?.name || 'Error',
        durationMs: now() - startedAt
      })
      throw error
    }
  }
}

const parseBulkResume = createBulkResumeParser()

module.exports = {
  MIN_PDF_EXTRACTED_CHARACTERS,
  createBulkResumeParser,
  isUsableResumeText,
  normalizeResumeText,
  parseBulkResume
}
