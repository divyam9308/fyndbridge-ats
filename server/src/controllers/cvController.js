const supabase = require('../services/supabaseAdmin')

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeCvPayload(row, userId) {
  const experienceYears = Number(row.experience_years)

  return {
    temp_id: cleanText(row.temp_id) || null,
    serial_no: Number.isFinite(Number(row.serial_no)) ? Number(row.serial_no) : null,
    file_name: cleanText(row.file_name),
    resume_path: cleanText(row.resume_path) || null,
    resume_url: cleanText(row.resume_url) || null,
    candidate_name: cleanText(row.candidate_name) || null,
    phone_number: cleanText(row.phone_number) || null,
    email: cleanText(row.email) || null,
    current_designation: cleanText(row.current_designation) || null,
    current_organization: cleanText(row.current_organization) || null,
    experience_years: row.experience_years === '' || row.experience_years === null || row.experience_years === undefined || !Number.isFinite(experienceYears)
      ? null
      : experienceYears,
    warnings: Array.isArray(row.warnings) ? row.warnings.map(cleanText).filter(Boolean) : [],
    parse_error: cleanText(row.error || row.parse_error) || null,
    reviewed: row.reviewed !== false,
    updated_by: userId || null
  }
}

function logAndSendInternal(res, routeName, err) {
  console.error(`${routeName}:`, err.message)
  return res.status(500).json({ error: 'Internal server error', detail: err.message })
}

async function listCvs(req, res) {
  try {
    const { data, error } = await supabase
      .from('cvs')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return res.json({ data: data || [] })
  } catch (err) {
    return logAndSendInternal(res, 'listCvs', err)
  }
}

async function saveCvs(req, res) {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : []

    if (!rows.length) {
      return res.status(400).json({ error: 'No CV rows provided' })
    }

    const payload = rows.map((row) => ({
      ...normalizeCvPayload(row, req.user?.id),
      created_by: req.user?.id || null
    }))

    if (payload.some((row) => !row.file_name)) {
      return res.status(400).json({ error: 'file_name is required for every CV row' })
    }

    const { data, error } = await supabase
      .from('cvs')
      .insert(payload)
      .select('*')

    if (error) throw error

    return res.status(201).json({ data: data || [] })
  } catch (err) {
    return logAndSendInternal(res, 'saveCvs', err)
  }
}

async function updateCv(req, res) {
  try {
    const payload = {
      ...normalizeCvPayload(req.body, req.user?.id),
      updated_at: new Date().toISOString()
    }

    delete payload.created_by

    const { data, error } = await supabase
      .from('cvs')
      .update(payload)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'CV row not found' })

    return res.json(data)
  } catch (err) {
    return logAndSendInternal(res, 'updateCv', err)
  }
}

async function markCvImported(req, res) {
  try {
    const { data, error } = await supabase
      .from('cvs')
      .update({
        imported: true,
        imported_candidate_id: req.body.candidate_id || null,
        updated_by: req.user?.id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'CV row not found' })

    return res.json(data)
  } catch (err) {
    return logAndSendInternal(res, 'markCvImported', err)
  }
}

module.exports = {
  listCvs,
  saveCvs,
  updateCv,
  markCvImported
}
