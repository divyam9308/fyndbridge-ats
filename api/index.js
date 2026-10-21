const path = require('path')

require('../server/node_modules/dotenv').config({ path: path.join(__dirname, '../server/.env') })

const app = require('../server/src/app')

// Log the exact managed Node.js patch level at each function cold start.
// This is visible only in Vercel function logs, not returned to API callers.
console.info('[runtime] Node.js version:', process.version)

module.exports = app
