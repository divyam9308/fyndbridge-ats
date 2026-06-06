const express = require('express')
const cors = require('cors')
const attachUser = require('./middleware/authMiddleware')

const app = express()

app.use(cors())
app.use(express.json())
app.use(attachUser)

app.use('/api/candidates', require('./routes/candidates'))
app.use('/api/clients', require('./routes/clients'))
app.use('/api/jobs', require('./routes/jobs'))
app.use('/api/auth', require('./routes/auth'))

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

module.exports = app
