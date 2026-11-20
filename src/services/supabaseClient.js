import { createClient } from '@supabase/supabase-js'
import { createSessionAwareAuthFetch } from './authRecovery'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
const storageKey = isSupabaseConfigured ? `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` : ''

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: { storageKey },
    global: { fetch: createSessionAwareAuthFetch({
      fetch: (input, init) => window.fetch(input, init),
      getStoredSession: () => JSON.parse(window.localStorage.getItem(storageKey) || 'null')
    }) }
  })
  : null
