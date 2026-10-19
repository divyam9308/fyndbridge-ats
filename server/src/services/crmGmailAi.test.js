const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const source = fs.readFileSync(require.resolve('./aiProvider'), 'utf8')
function provider(sequence = {}) {
  const calls = [], selections = []
  class MockAI {
    constructor(key) { this.key = key }
    getGenerativeModel(config) {
      selections.push({ key: this.key, model: config.model })
      return { generateContent: async () => {
        calls.push({ key: this.key, model: config.model })
        const next = sequence[this.key]?.shift()
        if (next instanceof Error) throw next
        return { response: { text: () => next || '{"ok":true}' } }
      } }
    }
  }
  const context = { require: () => ({ GoogleGenerativeAI: MockAI }), process: { env: { GEMINI_MODEL: 'cv-model', GEMINI_API_KEY_PRIMARY: 'primary', GEMINI_API_KEY_SECONDARY: 'secondary' } }, console: { warn() {}, error() {} }, module: { exports: {} }, setTimeout, clearTimeout }
  vm.runInNewContext(source, context)
  return { api: context.module.exports, calls, selections }
}
test('CRM model override cannot change existing CV model or primary/secondary quota fallback', async () => {
  const quota = () => Object.assign(new Error('Quota exceeded'), { status: 429 })
  const p = provider({ primary: [quota()], secondary: [quota()] })
  await p.api.callAiJson({ prompt: 'CRM', model: 'gemini-3.5-flash-lite', timeoutMs: 5500 })
  assert.deepEqual(p.calls.map(c => c.key), ['primary','secondary','primary'])
  assert.ok(p.calls.every(c => c.model === 'gemini-3.5-flash-lite'))
  await p.api.callAiJson({ prompt: 'CV' })
  assert.equal(p.calls.at(-1).model, 'cv-model'); assert.equal(p.api.GEMINI_MODEL, 'cv-model')
  assert.equal(p.api.getAiStatus().model, 'cv-model')
})
test('non-quota failures never activate secondary, and exhausted quota retains AI_QUOTA_REACHED', async () => {
  const p = provider({ primary: [Object.assign(new Error('Network'), { status: 503 })] })
  await assert.rejects(p.api.callAiJson({ prompt: 'CV' })); assert.equal(p.calls.length, 1)
  const quota = () => Object.assign(new Error('Quota'), { status: 429 })
  const q = provider({ primary: [quota(), quota()], secondary: [quota()] })
  await assert.rejects(q.api.callAiJson({ prompt: 'CRM', model: 'gemini-3.5-flash-lite' }), { code: 'AI_QUOTA_REACHED' })
})
