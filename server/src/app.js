const express = require('express')
const cors = require('cors')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/candidates', require('./routes/candidates'))

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

module.exports = app
