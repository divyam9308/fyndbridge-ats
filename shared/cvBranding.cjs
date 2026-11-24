const config = require('./cvBranding.json')
const patterns = config.pathPatterns.map(pattern => new RegExp(pattern, 'i'))
function isBrandedCvPath(value) { return patterns.some(pattern => pattern.test(String(value || ''))) }
module.exports = { VERSION: config.version, WIDTH_PT: config.widthMm * 72 / 25.4, INSET_PT: config.insetPt, OPACITY: config.opacity, isBrandedCvPath }
