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

function firstValue(sources, paths) {
  for (const source of sources) for (const path of paths) {
    const value = valueAt(source, path)
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.trim())) return value
  }
  return null
}

function text(value) {
  return value && typeof value !== 'object' ? String(value).trim() || null : null
}

function formatAddress(value) {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  const parts = ['bno', 'buildingNumber', 'AddrBno', 'bnm', 'buildingName', 'AddrBnm', 'flno', 'floor', 'AddrFlno', 'st', 'street', 'AddrSt', 'loc', 'locality', 'AddrLoc', 'dst', 'district', 'city', 'state', 'pncd', 'pincode', 'AddrPncd']
    .map(key => text(value[key])).filter(Boolean)
  return parts.length ? [...new Set(parts)].join(', ') : null
}

function addressFrom(sources) {
  const direct = formatAddress(firstValue(sources, ['pradr.adr', 'pradr.addr', 'pradr.address', 'principalPlaceOfBusiness', 'principal_place_address', 'principalPlaceAddress', 'address', 'addr']))
  if (direct) return direct
  for (const source of sources) {
    const parts = ['AddrBno', 'AddrBnm', 'AddrFlno', 'AddrSt', 'AddrLoc', 'district', 'city', 'state', 'AddrPncd']
      .map(key => text(source[key])).filter(Boolean)
    if (parts.length) return [...new Set(parts)].join(', ')
  }
  return null
}

function manualResult(gstin) {
  const stateCode = gstin.slice(0, 2)
  return {
    success: true, source: 'manual', gstin, pan: gstin.slice(2, 12), stateCode, state: STATES[stateCode] || null,
    legalEntityName: null, tradeName: null, address: null, status: null, verified: false
  }
}

function configError(message, fallback) {
  return Object.assign(new Error(message), { statusCode: 503, fallback })
}

function fallbackFields(result) {
  return { gstin: result.gstin, pan: result.pan, stateCode: result.stateCode, state: result.state }
}

function maskGstin(gstin) {
  return `${gstin.slice(0, 2)}****${gstin.slice(-4)}`
}

async function lookupGstin(value) {
  const gstin = normalizeGstin(value)
  const fallback = manualResult(gstin)
  const provider = String(process.env.GST_LOOKUP_PROVIDER || '').toLowerCase()
  const apiKey = process.env.GSTINCHECK_API_KEY
  if (provider === 'manual') return fallback
  if (provider !== 'gstincheck') throw configError('GST lookup provider is not configured', fallbackFields(fallback))
  if (!apiKey) throw configError('GSTINCheck API key missing', fallbackFields(fallback))

  try {
    const timeout = Math.max(1000, Number(process.env.GST_LOOKUP_TIMEOUT_MS) || 10000)
    const response = await axios.get(`https://sheet.gstincheck.co.in/check/${encodeURIComponent(apiKey)}/${gstin}`, { timeout })
    const payload = response.data && typeof response.data === 'object' ? response.data : {}
    const sources = [payload, payload.data, payload.result, payload.taxpayerInfo, payload.data?.data, payload.response, payload.response?.data, payload.response?.result, payload.response?.taxpayerInfo].filter(value => value && typeof value === 'object')
    const legalEntityName = text(firstValue(sources, ['lgnm', 'legalName', 'legal_name', 'legalNameOfBusiness', 'legal_name_of_business', 'LegalName', 'legalNameBusiness', 'name', 'taxpayerLegalName']))
    const tradeName = text(firstValue(sources, ['tradeNam', 'tradeName', 'trade_name', 'tradeNameOfBusiness', 'trade_name_of_business', 'TradeName', 'taxpayerTradeName']))
    const status = text(firstValue(sources, ['sts', 'status', 'gstStatus', 'gst_in_status', 'Status']))
    const address = addressFrom(sources)
    const normalized = { ...fallback, success: true, source: 'gstincheck', legalEntityName, tradeName, address, status, verified: true }
    if (process.env.NODE_ENV !== 'production') {
      normalized.debugProviderResponseKeys = Object.keys(payload)
      normalized.debugProviderDataKeys = Object.keys(payload.data && typeof payload.data === 'object' ? payload.data : {})
    }
    console.info('GST lookup', {
      provider, gstin: maskGstin(gstin), httpStatus: response.status, responseKeys: Object.keys(payload),
      legalEntityNameFound: Boolean(legalEntityName), addressFound: Boolean(address)
    })
    return normalized
  } catch (err) {
    console.warn('GST lookup failed', { provider, gstin: maskGstin(gstin), httpStatus: err.response?.status || err.code || 'error' })
    throw Object.assign(new Error('GST lookup failed. You can enter details manually.'), { statusCode: 502, fallback: fallbackFields(fallback) })
  }
}

module.exports = { lookupGstin, normalizeGstin }
