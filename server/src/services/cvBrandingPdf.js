const fs = require('node:fs/promises')
const path = require('node:path')
const { PDFDocument, PDFName, PDFString, degrees, BlendMode } = require('pdf-lib')
const { VERSION, WIDTH_PT, INSET_PT, OPACITY } = require('../../../shared/cvBranding.cjs')
let logoBytes
async function brandCvPdf(buffer) {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false })
  if (!doc.getPageCount()) throw new Error('The PDF has no pages.')
  const sourcePages = doc.getPages().map(page => ({ crop: page.getCropBox(), media: page.getMediaBox(), rotation: page.getRotation().angle }))
  logoBytes ||= fs.readFile(path.join(__dirname, '../../assets/fyndbridge-cv-logo.pdf'))
  const [logo] = await doc.embedPdf(await logoBytes)
  await logo.embed()
  // Composite the whole artwork as one transparency group: its original inner
  // graphics states must not override the agreed 60% watermark opacity.
  doc.context.lookup(logo.ref).dict.set(PDFName.of('Group'), doc.context.obj({ S: 'Transparency', I: true, K: false }))
  for (const page of doc.getPages()) {
    const box = page.getCropBox()
    const rotation = ((page.getRotation().angle % 360) + 360) % 360
    const visualWidth = rotation % 180 ? box.height : box.width
    const visualHeight = rotation % 180 ? box.width : box.height
    const width = Math.min(WIDTH_PT, visualWidth - 2 * INSET_PT, (visualHeight - 2 * INSET_PT) * logo.width / logo.height)
    if (width <= 0) throw new Error('The PDF page is too small.')
    const height = width * logo.height / logo.width
    const positions = {
      0: [box.x + INSET_PT, box.y + box.height - INSET_PT - height],
      90: [box.x + INSET_PT + height, box.y + INSET_PT],
      180: [box.x + box.width - INSET_PT, box.y + INSET_PT + height],
      270: [box.x + box.width - INSET_PT - height, box.y + box.height - INSET_PT]
    }
    if (!positions[rotation]) throw new Error('Unsupported PDF page rotation.')
    const [x, y] = positions[rotation]
    // Multiply keeps black text unchanged and the logo visible even when a CV
    // paints an opaque page background. An underlay would disappear on those CVs.
    page.drawPage(logo, { x, y, width, height, rotate: degrees(rotation), opacity: OPACITY, blendMode: BlendMode.Multiply })
  }
  doc.catalog.set(PDFName.of('FyndbridgeCVBranding'), PDFString.of(VERSION))
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }))
  const check = await PDFDocument.load(bytes, { updateMetadata: false })
  const pages = check.getPages().map(page => ({ crop: page.getCropBox(), media: page.getMediaBox(), rotation: page.getRotation().angle }))
  if (JSON.stringify(pages) !== JSON.stringify(sourcePages)) throw new Error('PDF page geometry changed during branding.')
  return { bytes, pageCount: pages.length }
}
module.exports = { brandCvPdf }
