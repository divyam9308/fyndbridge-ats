const {
  listEmployees,
  employeeDetail,
  reassignmentRecords,
  updateEmployeeStatus,
  reassignEmployee
} = require('../services/employeeManagement')

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error', code: error.code || undefined })
}

async function list(req, res) {
  try {
    return res.json({ data: await listEmployees() })
  } catch (error) {
    return sendError(res, error)
  }
}

async function detail(req, res) {
  try {
    return res.json({ data: await employeeDetail(req.params.employeeId) })
  } catch (error) {
    return sendError(res, error)
  }
}

async function records(req, res) {
  try {
    return res.json({ data: await reassignmentRecords(req.params.employeeId, req.query) })
  } catch (error) {
    return sendError(res, error)
  }
}

async function updateStatus(req, res) {
  try {
    const data = await updateEmployeeStatus(req.params.employeeId, req.body?.status, req.user.id)
    return res.json({ data })
  } catch (error) {
    return sendError(res, error)
  }
}

async function reassign(req, res) {
  try {
    const data = await reassignEmployee({
      actorId: req.user.id,
      actorEmail: req.user.email,
      sourceUserId: req.params.employeeId,
      destinationUserId: req.body?.destination_user_id,
      selections: req.body?.selections
    })
    return res.json({ data })
  } catch (error) {
    return sendError(res, error)
  }
}

module.exports = { list, detail, records, updateStatus, reassign }
