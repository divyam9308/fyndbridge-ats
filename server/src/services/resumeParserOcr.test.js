const test = require('node:test')
const assert = require('node:assert/strict')
const PDFDocument = require('pdfkit')
const {
  extractTextWithOcr,
  isPdfBuffer,
  loadPdfDocument,
  PDF_OCR_RENDER_SCALE,
  renderPdfPageToPng
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
    assert.equal(document.numPages, 1)
    const page = await document.getPage(1)
    const png = await renderPdfPageToPng(page, { scale: 1 })
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  } finally {
    await document.destroy()
  }
})
