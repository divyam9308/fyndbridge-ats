// Vercel Serverless Function entry point.
// This file wraps the existing Express app so Vercel can invoke it as a serverless function.
// No changes to server logic are needed — this is purely a thin adapter.

require('dotenv').config({ path: require('path').join(__dirname, '../server/.env') })

const app = require('../server/src/app')

module.exports = app
