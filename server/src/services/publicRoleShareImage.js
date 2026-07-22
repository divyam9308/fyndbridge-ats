const path = require('node:path')
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const { publicExperienceLabel } = require('./publicRoleSharePreview')

const WIDTH = 1200
const HEIGHT = 630
const BACKGROUND_PATH = path.resolve(__dirname, '../../../public/assets/public-role-share-background-v1.png')
const LOGO_PATH = path.resolve(__dirname, '../../../public/assets/fyndbridge-official-logo.png')

let assetsPromise

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function loadAssets() {
  if (!assetsPromise) assetsPromise = Promise.all([loadImage(BACKGROUND_PATH), loadImage(LOGO_PATH)])
  return assetsPromise
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function drawCover(ctx, image) {
  const scale = Math.max(WIDTH / image.width, HEIGHT / image.height)
  const width = image.width * scale
  const height = image.height * scale
  ctx.drawImage(image, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height)
}

function wrapText(ctx, value, maxWidth) {
  const words = clean(value).split(' ').filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

function fitRoleTitle(ctx, value) {
  const title = clean(value) || 'Open Role'
  for (let fontSize = 66; fontSize >= 42; fontSize -= 2) {
    ctx.font = `700 ${fontSize}px Georgia, serif`
    const lines = wrapText(ctx, title, 760)
    if (lines.length <= 2) return { fontSize, lines }
  }
  ctx.font = '700 40px Georgia, serif'
  const lines = wrapText(ctx, title, 760)
  if (lines.length <= 2) return { fontSize: 40, lines }
  return { fontSize: 40, lines: [lines[0], `${lines.slice(1).join(' ').slice(0, 31).trim()}…`] }
}

async function renderPublicRoleShareImage(role) {
  const [background, logo] = await loadAssets()
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')
  drawCover(ctx, background)

  const logoWidth = 330
  const logoHeight = logoWidth * logo.height / logo.width
  const logoX = WIDTH - logoWidth - 58
  const logoY = 54
  roundedRect(ctx, logoX - 24, logoY - 20, logoWidth + 48, logoHeight + 40, 20)
  ctx.fillStyle = 'rgba(255, 252, 246, .88)'
  ctx.fill()
  ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight)

  ctx.fillStyle = '#d8b264'
  ctx.font = '700 18px Arial, sans-serif'
  ctx.letterSpacing = '3px'
  ctx.fillText('OPEN ROLE', 72, 235)
  ctx.letterSpacing = '0px'

  const fitted = fitRoleTitle(ctx, role?.public_name)
  ctx.font = `700 ${fitted.fontSize}px Georgia, serif`
  ctx.fillStyle = '#fffdf8'
  ctx.shadowColor = 'rgba(0, 0, 0, .24)'
  ctx.shadowBlur = 8
  const lineHeight = Math.round(fitted.fontSize * 1.12)
  fitted.lines.forEach((line, index) => ctx.fillText(line, 72, 305 + index * lineHeight))
  ctx.shadowBlur = 0

  const detailsY = 305 + fitted.lines.length * lineHeight + 40
  const location = clean(role?.public_location) || 'Location not specified'
  const experience = publicExperienceLabel(role?.public_experience)
  ctx.font = '600 29px Arial, sans-serif'
  ctx.fillStyle = '#e5c783'
  ctx.fillText(`${location}  •  ${experience}`, 72, Math.min(detailsY, 545))

  return canvas.encode('jpeg', 90)
}

module.exports = { HEIGHT, WIDTH, renderPublicRoleShareImage }
