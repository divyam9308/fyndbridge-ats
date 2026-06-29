const {
  getReview,
  updateReview,
  getPermissions,
  updatePermissions
} = require('../services/performanceReview')

function sendError(res, err) {
  return res.status(err.statusCode || 500).json({
    error: err.message || 'Internal server error',
    ...(err.fields ? { fields: err.fields } : {})
  })
}

function reviewPeriod(req) {
  return req.query.period || req.body?.period
}

async function me(req, res) {
  try {
    return res.json({ data: await getReview(req.user, req.user.id, reviewPeriod(req)) })
  } catch (err) {
    return sendError(res, err)
  }
}

async function byEmployee(req, res) {
  try {
    return res.json({ data: await getReview(req.user, req.params.employeeUserId, reviewPeriod(req)) })
  } catch (err) {
    return sendError(res, err)
  }
}

async function save(req, res) {
  try {
    return res.json({ data: await updateReview(req.user, req.params.employeeUserId, req.body?.rows, reviewPeriod(req)) })
  } catch (err) {
    return sendError(res, err)
  }
}

async function permissions(req, res) {
  try {
    if (req.method === 'PUT') {
      return res.json({ permissions: await updatePermissions(req.user, req.body) })
    }
    return res.json({ permissions: await getPermissions() })
  } catch (err) {
    return sendError(res, err)
  }
}

module.exports = {
  me,
  byEmployee,
  save,
  permissions
}
