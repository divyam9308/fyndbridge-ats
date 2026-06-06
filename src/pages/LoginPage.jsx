import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../services/supabaseClient'
import { useAuth } from '../context/useAuth'
import './LoginPage.css'

function GoogleIcon() {
  return (
    <svg className="google-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.2 33.6 29.6 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 6 1.1 8.2 3l6-6C34.5 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.9 0 20.3-7.9 20.3-21 0-1.4-.1-2.7-.3-4z" />
      <path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 6 1.1 8.2 3l6-6C34.5 5.1 29.5 3 24 3c-7.6 0-14.2 4.3-17.7 10.7z" />
      <path fill="#FBBC05" d="M24 45c5.5 0 10.5-1.9 14.4-5l-6.6-5.4C29.6 36.3 26.9 37 24 37c-5.6 0-10.2-3.4-11.7-8.3l-6.9 5.3C9.7 40.5 16.4 45 24 45z" />
      <path fill="#EA4335" d="M44.5 20H24v8.5h11.7c-.8 2.3-2.3 4.3-4.3 5.8l6.6 5.4C42.1 36.3 45 30.6 45 24c0-1.4-.1-2.7-.5-4z" />
    </svg>
  )
}

function BrandIcon() {
  return (
    <svg width="50" height="50" viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M8 10 Q8 8 10 8 L52 8 Q54 8 54 10 L54 18 Q54 20 52 20 L20 20 L20 80 L52 80 Q54 80 54 82 L54 90 Q54 92 52 92 L10 92 Q8 92 8 90 Z" fill="#DAB111" />
      <path d="M92 10 Q92 8 90 8 L48 8 Q46 8 46 10 L46 18 Q46 20 48 20 L80 20 L80 80 L48 80 Q46 80 46 82 L46 90 Q46 92 48 92 L90 92 Q92 92 92 90 Z" fill="#DAB111" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <section className="login-panel login-panel-left" aria-label="Product introduction">
        <div className="login-panel-circle login-panel-circle-left-lg" aria-hidden="true" />
        <div className="login-panel-circle login-panel-circle-left-sm" aria-hidden="true" />

        <div className="login-brand" role="banner">
          <BrandIcon />
          <div>
            <p className="login-brand-name">FYNDBRIDGE</p>
            <p className="login-brand-tagline">BRIDGING TALENT &amp; SUCCESS</p>
          </div>
        </div>

        <div className="login-left-content">
          <p className="login-eyebrow">ATS Platform</p>

          <h1 className="login-hero-title">
            &ldquo;Hiring Is Not A Transaction.
            <br />
            It&apos;s A Transformation.&rdquo;
          </h1>

          <div className="login-divider" aria-hidden="true" />

          <p className="login-hero-copy">
            Your internal command centre for executive search and talent placement.
          </p>
        </div>

        <div className="login-quote-wrap">
          <p className="login-quote">
            &ldquo;The right person doesn&apos;t just fill a role — they unlock potential.&rdquo;
          </p>
        </div>
      </section>

      <section className="login-panel login-panel-right" aria-label="Sign in">
        <div className="login-panel-circle login-panel-circle-right-lg" aria-hidden="true" />
        <div className="login-panel-circle login-panel-circle-right-sm" aria-hidden="true" />

        <div className="login-auth-shell">
          <div className="login-auth-copy">
            <h2 className="login-heading">Welcome back</h2>
            <p className="login-subheading">Sign in to continue to your workspace</p>
          </div>

          <div className="login-form">
            {error && (
              <div className="login-error" role="alert">
                <AlertIcon />
                {error}
              </div>
            )}

            <button
              type="button"
              id="login-google"
              className={`login-btn google-login-btn${loading ? ' loading' : ''}`}
              disabled={loading}
              onClick={handleGoogleLogin}
            >
              {loading ? (
                <span className="btn-spinner" aria-label="Signing in…" />
              ) : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </button>

            <p className="login-permission-note">Only @fyndbridge.in accounts are permitted</p>
          </div>
        </div>

        <p className="login-footer-note">© 2025 FyndBridge. Internal use only.</p>
      </section>
    </div>
  )
}
