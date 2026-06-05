import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../services/supabaseClient'
import { useAuth } from '../context/AuthContext'
import './LoginPage.css'

function GoogleIcon() {
  return (
    <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  useEffect(() => {
    if (searchParams.get('error') === 'domain') {
      setError('Only @fyndbridge.in accounts are allowed.')
    }
  }, [searchParams])

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, navigate])

  const handleGoogleLogin = async () => {
    setError('')

    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase login is not configured.')
      return
    }

    setLoading(true)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        hd: 'fyndbridge.in',
        queryParams: {
          hd: 'fyndbridge.in',
        },
      },
    })

    if (oauthError) {
      setError(oauthError.message)
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      <div className="login-card-wrapper">
        <div className="login-logo" role="banner">
          <span className="logo-fynd">Fynd</span>
          <span className="logo-bridge">bridge</span>
        </div>
        <p className="login-tagline">Your recruitment command centre</p>

        <div className="login-card">
          <h1 className="login-heading">Welcome back</h1>
          <p className="login-subheading">Sign in with your Fyndbridge Google account</p>

          <div className="login-form">
            {error && (
              <div className="login-error" role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="button"
              className={`login-btn google-login-btn${loading ? ' loading' : ''}`}
              disabled={loading}
              id="login-google"
              onClick={handleGoogleLogin}
            >
              {loading ? (
                <span className="btn-spinner" />
              ) : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
