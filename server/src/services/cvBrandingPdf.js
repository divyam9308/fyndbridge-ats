const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { PDFDocument, PDFName, PDFString, PDFDict, PDFArray, PDFRef, PDFRawStream, decodePDFRawStream, degrees, BlendMode, drawPage } = require('pdf-lib')
const { VERSION, WIDTH_PT, INSET_PT, OPACITY } = require('../../../shared/cvBranding.cjs')
let logoBytes, referenceLogo
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function embedLogo(doc) {
  logoBytes ||= fs.readFile(path.join(__dirname, '../../assets/fyndbridge-cv-logo.pdf'))
  const [logo] = await doc.embedPdf(await logoBytes)
  await logo.embed()
  // Keep the approved artwork's inner graphics states inside one opacity group.
  doc.context.lookup(logo.ref).dict.set(PDFName.of('Group'), doc.context.obj({ S: 'Transparency', I: true, K: false }))
  return logo
}
// Resolve references before fingerprinting. Object numbers change in every CV;
// the actual approved artwork, its resources, and transparency group must match.
function objectFingerprint(context, value, depth = 0) {
  if (depth > 40) throw new Error('Invalid CV logo resource graph.')
  if (value instanceof PDFRef) return objectFingerprint(context, context.lookup(value), depth + 1)
  if (value instanceof PDFRawStream) return ['stream', objectFingerprint(context, value.dict, depth + 1), digest(decodePDFRawStream(value).decode())]
  if (value instanceof PDFDict) return value.entries().filter(([key]) => !['/Length', '/Filter', '/DecodeParms'].includes(key.toString()))
    .sort(([a], [b]) => a.toString().localeCompare(b.toString()))
    .map(([key, child]) => [key.toString(), objectFingerprint(context, child, depth + 1)])
  if (value instanceof PDFArray) return value.asArray().map(child => objectFingerprint(context, child, depth + 1))
  return value?.toString() || ''
}
async function approvedLogo() {
  referenceLogo ||= (async () => {
    const doc = await PDFDocument.create(), logo = await embedLogo(doc)
    // Save/reload so streams use the same representation as stored PDFs.
    const saved = await PDFDocument.load(await doc.save({ useObjectStreams: false }))
    return { width: logo.width, height: logo.height, fingerprint: JSON.stringify(objectFingerprint(saved.context, saved.context.lookup(logo.ref))) }
  })()
  return referenceLogo
}
function placement(page, logo) {
  const box = page.getCropBox(), rotation = ((page.getRotation().angle % 360) + 360) % 360
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
  return { x, y, width, height, rotate: degrees(rotation) }
}
function pageHasBranding(doc, page, logo) {
    const resources = page.node.Resources(), objects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    const states = resources?.lookupMaybe(PDFName.of('ExtGState'), PDFDict)
    if (!objects || !states) return false
    const graphicsStates = states.entries().filter(([, value]) => {
      const state = doc.context.lookup(value)
      return state instanceof PDFDict && state.lookup(PDFName.of('ca'))?.asNumber?.() === OPACITY && state.lookup(PDFName.of('BM'))?.toString() === '/Multiply'
    }).map(([name]) => name)
    if (!graphicsStates.length) return false
    const contents = page.node.Contents()
    const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
    const commands = streams.map(ref => Buffer.from(decodePDFRawStream(doc.context.lookup(ref)).decode()).toString('latin1').replace(/\s+/g, ' ').trim())
    const lastPainting = commands.filter(command => command && !/^[qQ](?: [qQ])*$/.test(command)).at(-1)
    let stamped = false
    for (const [name, ref] of objects.entries()) {
      const object = doc.context.lookup(ref)
      if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') continue
      try { if (JSON.stringify(objectFingerprint(doc.context, ref)) !== logo.fingerprint) continue } catch { continue }
      const pos = placement(page, logo)
      for (const graphicsState of graphicsStates) {
        const expected = drawPage(name, { x: pos.x, y: pos.y, xScale: pos.width / logo.width, yScale: pos.height / logo.height,
          rotate: pos.rotate, xSkew: degrees(0), ySkew: degrees(0), graphicsState }).map(op => op.toString()).join(' ').replace(/\s+/g, ' ').trim()
        // Our watermark is a dedicated final stream. Merely finding its tokens
        // earlier could accept artwork hidden by a later opaque page overlay.
        if (lastPainting === expected) { stamped = true; break }
      }
      if (stamped) break
    }
    return stamped
}
async function inspectDocument(doc, includePages = false) {
  const logo = await approvedLogo(), brandedPages = doc.getPages().map(page => pageHasBranding(doc, page, logo))
  const pageCount = brandedPages.length, branded = pageCount > 0 && brandedPages.every(Boolean)
  return { branded, pageCount, version: branded ? VERSION : null, ...(includePages ? { brandedPages } : {}) }
}
async function inspectBrandedCvPdf(buffer) {
  return inspectDocument(await PDFDocument.load(buffer, { updateMetadata: false }))
}
async function brandCvPdf(buffer) {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false })
  if (!doc.getPageCount()) throw new Error('The PDF has no pages.')
  const inspection = await inspectDocument(doc, true)
  if (inspection.branded) return { bytes: Buffer.from(buffer), pageCount: inspection.pageCount, alreadyBranded: true }
  const sourcePages = doc.getPages().map(page => ({ crop: page.getCropBox(), media: page.getMediaBox(), rotation: page.getRotation().angle }))
  const logo = await embedLogo(doc)
  for (const [index, page] of doc.getPages().entries()) {
    if (inspection.brandedPages[index]) continue
    // Multiply preserves black text and remains visible on opaque CV backgrounds.
    page.drawPage(logo, { ...placement(page, logo), opacity: OPACITY, blendMode: BlendMode.Multiply })
  }
  doc.catalog.set(PDFName.of('FyndbridgeCVBranding'), PDFString.of(VERSION))
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }))
  const check = await PDFDocument.load(bytes, { updateMetadata: false })
  const pages = check.getPages().map(page => ({ crop: page.getCropBox(), media: page.getMediaBox(), rotation: page.getRotation().angle }))
  if (JSON.stringify(pages) !== JSON.stringify(sourcePages)) throw new Error('PDF page geometry changed during branding.')
  if (!(await inspectDocument(check)).branded) throw new Error('The branded PDF could not be verified.')
  return { bytes, pageCount: pages.length, alreadyBranded: false }
}
module.exports = { brandCvPdf, inspectBrandedCvPdf }
