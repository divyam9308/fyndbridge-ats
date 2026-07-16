const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createCanvas } = require('@napi-rs/canvas')
const PDFDocument = require('pdfkit')
const {
  extractTextWithOcr,
  isPdfBuffer,
  loadPdfDocument,
  PDF_OCR_RENDER_SCALE,
  renderPdfPageToPng,
  TESSERACT_LANGUAGE_PATH,
  TESSERACT_WORKER_PATH
} = require('./resumeParser')

function createPdfBuffer() {
  return new Promise((resolve, reject) => {
    const chunks = []
    const document = new PDFDocument({ size: [240, 120], margin: 0 })
    document.on('data', chunk => chunks.push(chunk))
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.on('error', reject)
    document.rect(0, 0, 240, 120).fill('#ffffff')
    document.fillColor('#111111').fontSize(18).text('Scanned resume page', 20, 45)
    document.end()
  })
}

function createScannedResumeBuffer() {
  return new Promise((resolve, reject) => {
    const canvas = createCanvas(900, 360)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#111111'
    context.font = 'bold 46px sans-serif'
    context.fillText('ARJUN SAMPLE', 55, 80)
    context.font = '28px sans-serif'
    context.fillText('Chartered Accountant and ACCA finalist', 55, 135)
    context.fillText('Experience in taxation, audit and financial reporting', 55, 190)
    context.fillText('Mumbai | candidate@example.com | 9876543210', 55, 245)

    const chunks = []
    const document = new PDFDocument({ size: [900, 360], margin: 0 })
    document.on('data', chunk => chunks.push(chunk))
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.on('error', reject)
    document.image(canvas.toBuffer('image/png'), 0, 0, { width: 900, height: 360 })
    document.end()
  })
}

function runOcrChild(filePath, cwd) {
  const modulePath = path.resolve(__dirname, 'resumeParser.js')
  const script = `
    const fs = require('node:fs')
    const { extractTextWithOcr } = require(${JSON.stringify(modulePath)})
    extractTextWithOcr(fs.readFileSync(${JSON.stringify(filePath)}))
      .then(text => process.stdout.write(text))
      .catch(error => {
        console.error(error.stack || error.message || error)
        process.exitCode = 1
      })
  `

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('OCR cold-start child timed out'))
    }, 15000)

    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) return resolve(stdout)
      return reject(new Error(stderr || `OCR child exited with code ${code}`))
    })
  })
}

test('PDF OCR renders every page to an image before Tesseract recognition', async () => {
  const recognized = []
  const cleanedPages = []
  let documentDestroyed = false
  let workerTerminated = false
  let workerOptions = null
  let workerParameters = null

  const pages = [1, 2].map(number => ({
    number,
    cleanup() {
      cleanedPages.push(number)
    }
  }))

  const text = await extractTextWithOcr(Buffer.from('%PDF-scanned-resume'), {
    loadPdfDocumentImpl: async () => ({
      numPages: pages.length,
      getPage: async pageNumber => pages[pageNumber - 1],
      destroy() {
        documentDestroyed = true
      }
    }),
    renderPdfPageToPngImpl: async page => Buffer.from(`png-page-${page.number}`),
    createWorkerImpl: async (language, oem, options) => {
      assert.equal(language, 'eng')
      assert.equal(oem, undefined)
      workerOptions = options
      return {
        async setParameters(parameters) {
          workerParameters = parameters
        },
        async recognize(imageBuffer) {
          recognized.push(imageBuffer.toString())
          return { data: { text: `page ${recognized.length} text` } }
        },
        async terminate() {
          workerTerminated = true
        }
      }
    }
  })

  assert.equal(text, 'page 1 text\npage 2 text')
  assert.deepEqual(recognized, ['png-page-1', 'png-page-2'])
  assert.deepEqual(cleanedPages, [1, 2])
  assert.equal(documentDestroyed, true)
  assert.equal(workerTerminated, true)
  assert.equal(typeof workerOptions.errorHandler, 'function')
  assert.equal(workerOptions.langPath, TESSERACT_LANGUAGE_PATH)
  assert.equal(workerOptions.cachePath, TESSERACT_LANGUAGE_PATH)
  assert.equal(workerOptions.cacheMethod, 'readOnly')
  assert.equal(workerOptions.gzip, false)
  assert.equal(workerOptions.workerPath, TESSERACT_WORKER_PATH)
  assert.equal(workerParameters.preserve_interword_spaces, '1')
})

test('non-PDF OCR input remains a direct Tesseract image path', async () => {
  const imageBuffer = Buffer.from('png-image')
  let recognized = null

  const text = await extractTextWithOcr(imageBuffer, {
    loadPdfDocumentImpl: async () => {
      throw new Error('PDF renderer should not be called for an image')
    },
    createWorkerImpl: async () => ({
      async setParameters() {},
      async recognize(input) {
        recognized = input
        return { data: { text: 'image text' } }
      },
      async terminate() {}
    })
  })

  assert.equal(text, 'image text')
  assert.equal(recognized, imageBuffer)
})

test('OCR worker and PDF resources are cleaned up after a page failure', async () => {
  let documentDestroyed = false
  let workerTerminated = false

  await assert.rejects(
    extractTextWithOcr(Buffer.from('%PDF-failed-resume'), {
      loadPdfDocumentImpl: async () => ({
        numPages: 1,
        getPage: async () => ({ cleanup() {} }),
        destroy() {
          documentDestroyed = true
        }
      }),
      renderPdfPageToPngImpl: async () => Buffer.from('png-page'),
      createWorkerImpl: async () => ({
        async setParameters() {},
        async recognize() {
          throw new Error('OCR recognition failed')
        },
        async terminate() {
          workerTerminated = true
        }
      })
    }),
    /OCR recognition failed/
  )

  assert.equal(documentDestroyed, true)
  assert.equal(workerTerminated, true)
})

test('PDF detection and rendering use the configured OCR scale', async () => {
  assert.equal(isPdfBuffer(Buffer.from('%PDF-1.7')), true)
  assert.equal(isPdfBuffer(Buffer.from('not-a-pdf')), false)

  const calls = {}
  const canvas = {
    toBuffer(type) {
      calls.bufferType = type
      return Buffer.from('rendered-png')
    }
  }
  const page = {
    getViewport({ scale }) {
      calls.scale = scale
      return { width: 100.2, height: 200.3 }
    },
    render(options) {
      calls.renderOptions = options
      return { promise: Promise.resolve() }
    }
  }

  const png = await renderPdfPageToPng(page, {
    createCanvasImpl(width, height) {
      calls.canvasSize = [width, height]
      return canvas
    }
  })

  assert.equal(calls.scale, PDF_OCR_RENDER_SCALE)
  assert.deepEqual(calls.canvasSize, [101, 201])
  assert.equal(calls.renderOptions.canvas, canvas)
  assert.equal(calls.renderOptions.background, 'rgb(255,255,255)')
  assert.equal(calls.bufferType, 'image/png')
  assert.equal(png.toString(), 'rendered-png')
})

test('installed PDF renderer produces a real PNG buffer', async () => {
  const document = await loadPdfDocument(await createPdfBuffer())
  try {
    assert.equal(typeof globalThis.pdfjsWorker?.WorkerMessageHandler, 'function')
    assert.equal(document.numPages, 1)
    const page = await document.getPage(1)
    const png = await renderPdfPageToPng(page, { scale: 1 })
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  } finally {
    await document.destroy()
  }
})

test('image-only resume OCR uses bundled assets from a cold working directory', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fyndbridge-ocr-'))
  const filePath = path.join(tempDirectory, 'scanned-resume.pdf')
  fs.writeFileSync(filePath, await createScannedResumeBuffer())

  try {
    assert.equal(fs.existsSync(path.join(TESSERACT_LANGUAGE_PATH, 'eng.traineddata')), true)
    assert.equal(fs.existsSync(TESSERACT_WORKER_PATH), true)
    const text = await runOcrChild(filePath, tempDirectory)
    assert.match(text, /ARJUN SAMPLE/i)
    assert.match(text, /Chartered Accountant/i)
    assert.match(text, /9876543210/)
    assert.equal(fs.existsSync(path.join(tempDirectory, 'eng.traineddata')), false)
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true })
  }
})

test('Vercel function bundle includes OCR runtime assets', () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../vercel.json'), 'utf8'))
  const includeFiles = config.functions?.['api/index.js']?.includeFiles || ''
  assert.match(includeFiles, /eng\.traineddata/)
  assert.match(includeFiles, /tesseract\.js/)
  assert.match(includeFiles, /tesseract\.js-core/)
  assert.match(includeFiles, /pdf\.worker\.mjs/)
})
