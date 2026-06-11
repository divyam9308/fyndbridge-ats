const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !anonKey) {
  console.warn('SUPABASE_URL and SUPABASE_ANON_KEY must be set before handling auth requests')
}

const supabase = createClient(supabaseUrl || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

module.exports = supabase
