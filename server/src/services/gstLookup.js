const axios = require('axios')

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction'
}

function normalizeGstin(value) {
  const gstin = String(value || '').replace(/\s+/g, '').toUpperCase()
  if (!GSTIN_PATTERN.test(gstin)) throw Object.assign(new Error('Invalid GSTIN format'), { statusCode: 400 })
  return gstin
}

function valueAt(object, path) {
  return path.split('.').reduce((value, key) => value && value[key], object)
}

function firstValue(object, paths) {
  for (const path of paths) {
    const value = valueAt(object, path)
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return null
}

function addressFrom(data) {
  const direct = firstValue(data, ['pradr.adr', 'pradr.addr', 'pradr.address', 'principal_place_address', 'address'])
  if (direct) return direct
  return ['AddrBnm', 'AddrBno', 'AddrFlno', 'AddrSt', 'AddrLoc', 'AddrPncd'].map(key => data?.[key]).filter(Boolean).join(', ') || null
}

function manualResult(gstin) {
  const stateCode = gstin.slice(0, 2)
  return {
    source: 'manual', gstin, pan: gstin.slice(2, 12), stateCode, state: STATES[stateCode] || null,
    legalEntityName: null, tradeName: null, address: null, status: null, verified: false
  }
}

function maskGstin(gstin) {
  return `${gstin.slice(0, 2)}********${gstin.slice(-3)}`
}

async function lookupGstin(value) {
  const gstin = normalizeGstin(value)
  const result = manualResult(gstin)
  const provider = String(process.env.GST_LOOKUP_PROVIDER || 'manual').toLowerCase()
  const apiKey = process.env.GSTINCHECK_API_KEY
  if (provider !== 'gstincheck' || !apiKey) return result

  try {
    const timeout = Math.max(1000, Number(process.env.GST_LOOKUP_TIMEOUT_MS) || 10000)
    const response = await axios.get(`https://sheet.gstincheck.co.in/check/${encodeURIComponent(apiKey)}/${gstin}`, { timeout })
    const payload = response.data || {}
    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload
    const status = firstValue(payload, ['data.sts', 'data.status', 'data.gst_in_status', 'data.Status', 'sts', 'status'])
    const normalized = {
      ...result,
      source: 'gstincheck',
      legalEntityName: firstValue(payload, ['data.lgnm', 'data.legalName', 'data.legal_name', 'data.legalNameOfBusiness', 'data.legal_name_of_business', 'data.LegalName', 'legalName', 'legal_name']),
      tradeName: firstValue(payload, ['data.tradeNam', 'data.tradeName', 'data.trade_name', 'data.tradeNameOfBusiness', 'data.trade_name_of_business', 'data.TradeName', 'tradeName', 'trade_name']),
      address: addressFrom(data),
      status,
      rawStatus: status,
      verified: true
    }
    console.info('GST lookup', { gstin: maskGstin(gstin), source: normalized.source, status: normalized.status || 'unknown' })
    return normalized
  } catch (err) {
    console.warn('GST lookup failed', { gstin: maskGstin(gstin), status: err.response?.status || err.code || 'error' })
    throw Object.assign(new Error('GST lookup failed. You can enter details manually.'), { statusCode: 502 })
  }
}

module.exports = { lookupGstin, normalizeGstin }
