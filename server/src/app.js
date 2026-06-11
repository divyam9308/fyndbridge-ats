const express = require('express')
const cors = require('cors')
const attachUser = require('./middleware/authMiddleware')

const app = express()

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

app.use('/api/candidates', require('./routes/candidates'))
app.use('/api/resumes', require('./routes/resumes'))
app.use('/api/clients', require('./routes/clients'))
app.use('/api/jobs', require('./routes/jobs'))
app.use('/api/auth', require('./routes/auth'))
app.use('/api/user-preferences', require('./routes/userPreferences'))
app.use('/api/ai', require('./routes/ai'))

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

module.exports = app
