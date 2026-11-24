const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })

const { validateAiConfig } = require('./src/services/aiProvider')
const app = require('./src/app')

const port = process.env.PORT || 4000

validateAiConfig()

app.listen(port, () => {
  console.log(`Fyndbridge ATS API listening on port ${port}`)
  // Vercel uses the authenticated cron; the long-lived local/Node server also
  // recovers persisted work when a browser closes or an upload is abandoned.
  const timer = setInterval(async () => {
    try { const service = require('./src/services/cvBranding').cvBranding(); await service.reap(); await service.run() }
    catch (error) { console.error('CV branding recovery:', error.code || 'WORKER_FAILED') }
  }, 30000)
  timer.unref()
})
