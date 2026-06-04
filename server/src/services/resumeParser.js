const fs = require('fs/promises')
const pdfParse = require('pdf-parse')
const { createWorker } = require('tesseract.js')
const { extractFields } = require('./extractorUtils')

async function extractTextWithOcr(fileBuffer) {
  const worker = await createWorker('eng')

  try {
    const result = await worker.recognize(fileBuffer)
    return result.data.text || ''
  } finally {
    await worker.terminate()
  }
}

async function parseResume(filePath) {
  const fileBuffer = await fs.readFile(filePath)

  let rawText = ''
  const parsed = await pdfParse(fileBuffer)
  rawText = parsed.text || ''

  if (rawText.trim().length < 100) {
    rawText = await extractTextWithOcr(fileBuffer)
  }

  return {
    extracted: extractFields(rawText),
    raw_text: rawText
  }
}

module.exports = {
  parseResume
}
