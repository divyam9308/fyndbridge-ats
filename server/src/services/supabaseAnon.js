const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !anonKey) {
  throw new Error('Missing server environment variables: SUPABASE_URL and SUPABASE_ANON_KEY are required')
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

module.exports = supabase
