const express = require('express')
const cors = require('cors')
const attachUser = require('./middleware/authMiddleware')
const requireAuth = require('./middleware/requireAuth')

const app = express()

const PERF_ROUTES = /^\/api\/(candidates|clients|jobs|dashboard|notifications|invoice|admin|performance|presence|reports)(?:\/|$)/

app.use((req, res, next) => {
  if (!(process.env.NODE_ENV !== 'production' || process.env.DEBUG_PERF === 'true') || !PERF_ROUTES.test(req.path)) return next()
  const requestId = req.get('x-request-id') || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = process.hrtime.bigint()
  res.setHeader('x-request-id', requestId)
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    console.debug('[perf]', { route: req.path, method: req.method, requestId, status: res.statusCode, durationMs: Number(durationMs.toFixed(1)) })
  })
  next()
})

// Allow requests from the deployed Vercel frontend, any *.vercel.app domain,
// and localhost for local development.
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,          // e.g. https://fyndbridge.vercel.app
  /\.vercel\.app$/,                   // any Vercel preview URL
  /^http:\/\/localhost(:\d+)?$/       // local dev
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, Postman)
    if (!origin) return callback(null, true)
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    )
    callback(allowed ? null : new Error('Not allowed by CORS'), allowed)
  },
  credentials: true
}))

app.use(express.json())
app.use(attachUser)

app.use('/api/candidates', requireAuth, require('./routes/candidates'))
app.use('/api/resumes', requireAuth, require('./routes/resumes'))
app.use('/api/documents', requireAuth, require('./routes/documents'))
app.use('/api/clients', requireAuth, require('./routes/clients'))
app.use('/api/jobs', requireAuth, require('./routes/jobs'))
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'))
app.use('/api/notifications', requireAuth, require('./routes/notifications'))
app.use('/api/admin', requireAuth, require('./routes/admin'))
app.use('/api/performance', requireAuth, require('./routes/performance'))
app.use('/api/attendance', requireAuth, require('./routes/attendance'))
app.use('/api/reports', requireAuth, require('./routes/reports'))
app.use('/api/user-manual', requireAuth, require('./routes/userManual'))
app.use('/api/presence', requireAuth, require('./routes/presence'))
app.use('/api/invoice', requireAuth, require('./routes/invoice'))
app.use('/api/gst', requireAuth, require('./routes/gst'))
app.use('/api/auth', require('./routes/auth'))
app.use('/api/user-preferences', requireAuth, require('./routes/userPreferences'))
app.use('/api/user-profiles', requireAuth, require('./routes/userProfiles'))
app.use('/api/ai', requireAuth, require('./routes/ai'))

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

module.exports = app
