require('dotenv').config()

const app = require('./src/app')

const port = process.env.PORT || 4000

app.listen(port, () => {
  console.log(`Fyndbridge ATS API listening on port ${port}`)
})
