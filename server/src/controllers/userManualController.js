const { getUserManual, updateUserManual } = require('../services/userManual')

function sendError(res, err) {
  return res.status(err.statusCode || 500).json({
    error: err.message || 'Internal server error',
    ...(err.fields ? { fields: err.fields } : {})
  })
}

async function manual(req, res) {
  try {
    if (req.method === 'POST') {
      return res.json({ data: await updateUserManual(req.user, req.file) })
    }
    return res.json({ data: await getUserManual() })
  } catch (err) {
    return sendError(res, err)
  }
}

module.exports = { manual }
