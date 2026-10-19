// Bound expensive text/OCR/full parsing across requests within one API instance.
const MAX_ACTIVE = 3
const MAX_WAITING = 24
let active = 0
const waiting = []
async function withAssignedCvParsing(task) {
  if (active < MAX_ACTIVE) active += 1
  else {
    if (waiting.length >= MAX_WAITING) throw Object.assign(new Error('CV parsing is busy. Please retry.'), { statusCode: 503 })
    await new Promise(resolve => waiting.push(resolve))
  }
  try { return await task() }
  finally { const next = waiting.shift(); if (next) next(); else active -= 1 }
}
module.exports = { withAssignedCvParsing }
