const path = require('path')

require('../server/node_modules/dotenv').config({ path: path.join(__dirname, '../server/.env') })

const app = require('../server/src/app')

module.exports = app
