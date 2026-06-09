const supabase = require('../services/supabaseAdmin')

function logAndSendInternal(res, method, err) {
  console.error(`${method} error:`, err.message || err)
  return res.status(500).json({ error: 'Internal server error', detail: err.message })
}

function normalizeDuplicateText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

async function findClientDuplicate(name, email) {
  const normalizedName = normalizeDuplicateText(name)
  const normalizedEmail = normalizeDuplicateText(email)

  if (!normalizedName || !normalizedEmail) return null

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .ilike('email', normalizedEmail)

  if (error) throw error

  return (data || []).find((client) => normalizeDuplicateText(client.name) === normalizedName) || null
}

async function checkClientDuplicate(req, res) {
  try {
    const existing = await findClientDuplicate(req.query.name, req.query.email)
    return res.json({ duplicate: Boolean(existing), existing })
  } catch (err) {
    return logAndSendInternal(res, 'checkClientDuplicate', err)
  }
}

async function listClients(req, res) {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('name', { ascending: true })

    if (error) throw error

    // Fetch active jobs count for each client from the jobs table
    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select('client_id, status')

    if (jobsError) throw jobsError

    const activeJobsMap = {}
    if (jobs) {
      jobs.forEach(job => {
        if (job.status === 'Open' || job.status === 'Active') {
          activeJobsMap[job.client_id] = (activeJobsMap[job.client_id] || 0) + 1
        }
      })
    }

    const formatted = (data || []).map(client => ({
      ...client,
      activeJobs: activeJobsMap[client.id] || 0
    }))

    return res.json({ data: formatted })
  } catch (err) {
    return logAndSendInternal(res, 'listClients', err)
  }
}

async function getClient(req, res) {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Client not found' })

    return res.json(data)
  } catch (err) {
    return logAndSendInternal(res, 'getClient', err)
  }
}

async function createClient(req, res) {
  try {
    const { name, contact, phone, email, city, state, notes, status } = req.body

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client Name is required' })
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: 'Phone Number is required' })
    }

    const payload = {
      name: name.trim(),
      contact: contact ? contact.trim() : null,
      phone: phone.trim(),
      email: email ? email.trim() : null,
      city: city ? city.trim() : null,
      state: state ? state.trim() : null,
      status: status || 'Active',
      notes: notes ? notes.trim() : null
    }
    const duplicateAction = req.body.duplicate_action
    const duplicate = await findClientDuplicate(payload.name, payload.email)

    if (duplicate && !['update_current', 'add_duplicate'].includes(duplicateAction)) {
      return res.status(409).json({
        error: 'A client with the same name and email already exists.',
        duplicate: true,
        existing: duplicate
      })
    }

    if (duplicate && duplicateAction === 'update_current') {
      const { data, error } = await supabase
        .from('clients')
        .update({
          ...payload,
          updated_at: new Date().toISOString()
        })
        .eq('id', duplicate.id)
        .select('*')
        .single()

      if (error) throw error

      return res.json(data)
    }

    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json({ error: 'A client with this name already exists' })
      }
      throw error
    }

    return res.status(201).json(data)
  } catch (err) {
    return logAndSendInternal(res, 'createClient', err)
  }
}

async function updateClient(req, res) {
  try {
    const { name, contact, phone, email, city, state, notes, status } = req.body
    const payload = {}

    if (name !== undefined) payload.name = name.trim()
    if (contact !== undefined) payload.contact = contact ? contact.trim() : null
    if (phone !== undefined) payload.phone = phone.trim()
    if (email !== undefined) payload.email = email ? email.trim() : null
    if (city !== undefined) payload.city = city ? city.trim() : null
    if (state !== undefined) payload.state = state ? state.trim() : null
    if (status !== undefined) payload.status = status
    if (notes !== undefined) payload.notes = notes ? notes.trim() : null

    const { data, error } = await supabase
      .from('clients')
      .update(payload)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'A client with this name already exists' })
      }
      throw error
    }
    if (!data) return res.status(404).json({ error: 'Client not found' })

    return res.json(data)
  } catch (err) {
    return logAndSendInternal(res, 'updateClient', err)
  }
}

async function deleteClient(req, res) {
  try {
    const { data, error } = await supabase
      .from('clients')
      .delete()
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Client not found' })

    return res.json({ message: 'Client deleted successfully' })
  } catch (err) {
    return logAndSendInternal(res, 'deleteClient', err)
  }
}

module.exports = {
  checkClientDuplicate,
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient
}
