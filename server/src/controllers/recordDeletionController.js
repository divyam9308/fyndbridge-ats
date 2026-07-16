const recordDeletion = require('../services/recordDeletion')

function sendError(res, error, operation) {
  console.error(`[record deletion] ${operation} failed`, {
    message: error?.message,
    code: error?.code || null,
    statusCode: error?.statusCode || 500
  })
  return res.status(error?.statusCode || 500).json({
    error: error?.message || 'Record management request failed'
  })
}

async function list(req, res) {
  try {
    return res.json(await recordDeletion.listRecords({
      entityType: req.query.entity,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit
    }))
  } catch (error) {
    return sendError(res, error, 'list')
  }
}

async function preview(req, res) {
  try {
    return res.json({ data: await recordDeletion.previewDeletion(req.body) })
  } catch (error) {
    return sendError(res, error, 'preview')
  }
}

async function remove(req, res) {
  try {
    return res.json({ data: await recordDeletion.deleteRecords(req.user.id, req.body) })
  } catch (error) {
    return sendError(res, error, 'delete')
  }
}

module.exports = { list, preview, remove }
