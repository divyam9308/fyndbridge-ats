const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.warn('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before handling API requests')
}

const supabase = createClient(supabaseUrl || 'http://localhost:54321', serviceRoleKey || 'missing-service-role-key', {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

module.exports = supabase
