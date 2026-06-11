const supabase = require('../services/supabaseAdmin')

function logAndSendInternal(res, method, err) {
  console.error(`${method} error:`, err.message || err)
  return res.status(500).json({ error: 'Internal server error', detail: err.message })
}

async function listJobs(req, res) {
  try {
    let query = supabase
      .from('jobs')
      .select('*, clients(name)')

    if (req.query.client_id) {
      query = query.eq('client_id', req.query.client_id)
    }

    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw error

    // Format the response to flatten clients(name) to match what frontend expects
    const formatted = (data || []).map(job => ({
      ...job,
      client: job.clients?.name || 'Unknown Client',
      clients: undefined // remove nested object
    }))

    return res.json({ data: formatted })
  } catch (err) {
    return logAndSendInternal(res, 'listJobs', err)
  }
}

async function getJob(req, res) {
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('*, clients(name)')
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Job not found' })

    const formatted = {
      ...data,
      client: data.clients?.name || 'Unknown Client',
      clients: undefined
    }

    return res.json(formatted)
  } catch (err) {
    return logAndSendInternal(res, 'getJob', err)
  }
}

async function createJob(req, res) {
  try {
    const {
      title,
      client_id,
      city,
      state,
      status,
      salary_min,
      salary_max,
      experience_label,
      experience_min,
      completion,
      open_positions,
      skills,
      notes
    } = req.body

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Job Title is required' })
    }
    if (!client_id) {
      return res.status(400).json({ error: 'Client ID is required' })
    }

    const payload = {
      title: title.trim(),
      client_id,
      city: city ? city.trim() : null,
      state: state ? state.trim() : null,
      status: status || 'Open',
      salary_min: salary_min !== undefined ? Number(salary_min) : null,
      salary_max: salary_max !== undefined ? Number(salary_max) : null,
      experience_label: experience_label ? experience_label.trim() : null,
      experience_min: experience_min !== undefined ? Number(experience_min) : null,
      completion: completion !== undefined ? Number(completion) : 0,
      open_positions: open_positions !== undefined ? Number(open_positions) : 1,
      skills: Array.isArray(skills) ? skills : [],
      notes: notes ? notes.trim() : null
    }

    const { data, error } = await supabase
      .from('jobs')
      .insert(payload)
      .select('*, clients(name)')
      .single()

    if (error) throw error

    const formatted = {
      ...data,
      client: data.clients?.name || 'Unknown Client',
      clients: undefined
    }

    return res.status(201).json(formatted)
  } catch (err) {
    return logAndSendInternal(res, 'createJob', err)
  }
}

async function updateJob(req, res) {
  try {
    const {
      title,
      client_id,
      city,
      state,
      status,
      salary_min,
      salary_max,
      experience_label,
      experience_min,
      completion,
      open_positions,
      skills,
      notes
    } = req.body

    const payload = {}
    if (title !== undefined) payload.title = title.trim()
    if (client_id !== undefined) payload.client_id = client_id
    if (city !== undefined) payload.city = city ? city.trim() : null
    if (state !== undefined) payload.state = state ? state.trim() : null
    if (status !== undefined) payload.status = status
    if (salary_min !== undefined) payload.salary_min = salary_min !== null ? Number(salary_min) : null
    if (salary_max !== undefined) payload.salary_max = salary_max !== null ? Number(salary_max) : null
    if (experience_label !== undefined) payload.experience_label = experience_label ? experience_label.trim() : null
    if (experience_min !== undefined) payload.experience_min = experience_min !== null ? Number(experience_min) : null
    if (completion !== undefined) payload.completion = Number(completion)
    if (open_positions !== undefined) payload.open_positions = Number(open_positions)
    if (skills !== undefined) payload.skills = Array.isArray(skills) ? skills : []
    if (notes !== undefined) payload.notes = notes ? notes.trim() : null

    const { data, error } = await supabase
      .from('jobs')
      .update(payload)
      .eq('id', req.params.id)
      .select('*, clients(name)')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Job not found' })

    const formatted = {
      ...data,
      client: data.clients?.name || 'Unknown Client',
      clients: undefined
    }

    return res.json(formatted)
  } catch (err) {
    return logAndSendInternal(res, 'updateJob', err)
  }
}

async function deleteJob(req, res) {
  try {
    const { data, error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Job not found' })

    return res.json({ message: 'Job deleted successfully' })
  } catch (err) {
    return logAndSendInternal(res, 'deleteJob', err)
  }
}

module.exports = {
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob
}
