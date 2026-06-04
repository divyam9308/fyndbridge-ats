import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import './LoginPage.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email || !password) {
      setError('Please fill in all fields.')
      return
    }
    setLoading(true)
    // Simulate auth delay
    await new Promise(r => setTimeout(r, 900))
    if (email === 'hr@fyndbridge.com' && password === 'password') {
      navigate('/dashboard')
    } else {
      setError('Invalid credentials. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="login-root">


      <div className="login-card-wrapper">
        {/* Logo */}
        <div className="login-logo" role="banner">
          <span className="logo-fynd">Fynd</span>
          <span className="logo-bridge">bridge</span>
        </div>
        <p className="login-tagline">Your recruitment command centre</p>

        {/* Card */}
        <div className="login-card">
          <h1 className="login-heading">Welcome back</h1>
          <p className="login-subheading">Sign in to your workspace</p>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="email" className="form-label">Company Email</label>
              <input
                id="email"
                type="email"
                className="form-input"
                placeholder="you@fyndbridge.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">Password</label>
              <div className="input-wrapper">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input password-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="forgot-row">
                <a href="#" className="forgot-link">Forgot password?</a>
              </div>
            </div>

            {error && (
              <div className="login-error" role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              className={`login-btn${loading ? ' loading' : ''}`}
              disabled={loading}
              id="login-submit"
            >
              {loading ? (
                <span className="btn-spinner" />
              ) : 'Sign In'}
            </button>
          </form>

          <p className="login-hint">
            Demo: <span>hr@fyndbridge.com</span> / <span>password</span>
          </p>
        </div>
      </div>
    </div>
  )
}
