const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })

const { validateAiConfig } = require('./src/services/aiProvider')
const app = require('./src/app')

const port = process.env.PORT || 4000

validateAiConfig()

app.listen(port, () => {
  console.log(`Fyndbridge ATS API listening on port ${port}`)
})
