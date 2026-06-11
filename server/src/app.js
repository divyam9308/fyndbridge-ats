const express = require('express')
const cors = require('cors')
const attachUser = require('./middleware/authMiddleware')

const app = express()

app.use(cors())
app.use(express.json())
app.use(attachUser)

app.use('/api/candidates', require('./routes/candidates'))
app.use('/api/resumes', require('./routes/resumes'))
app.use('/api/cvs', require('./routes/cvs'))
app.use('/api/clients', require('./routes/clients'))
app.use('/api/jobs', require('./routes/jobs'))
app.use('/api/auth', require('./routes/auth'))
app.use('/api/user-preferences', require('./routes/userPreferences'))
app.use('/api/ai', require('./routes/ai'))

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

module.exports = app
