import { useEffect, useRef } from 'react'

const SCRIPT_ID = 'fyndbridge-turnstile-script'
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  const existing = document.getElementById(SCRIPT_ID)
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.turnstile), { once: true })
      existing.addEventListener('error', () => reject(new Error('Verification could not be loaded.')), { once: true })
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_URL
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve(window.turnstile), { once: true })
    script.addEventListener('error', () => reject(new Error('Verification could not be loaded.')), { once: true })
    document.head.appendChild(script)
  })
}

export default function TurnstileWidget({ siteKey, onTokenChange, onError }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined
    let cancelled = false
    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !turnstile || !containerRef.current) return
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: token => onTokenChange(token),
          'expired-callback': () => onTokenChange(''),
          'error-callback': () => {
            onTokenChange('')
            onError('Verification failed. Please try again.')
          },
        })
      })
      .catch(error => onError(error.message || 'Verification could not be loaded.'))

    return () => {
      cancelled = true
      if (window.turnstile && widgetIdRef.current !== null) {
        window.turnstile.remove(widgetIdRef.current)
      }
      widgetIdRef.current = null
    }
  }, [onError, onTokenChange, siteKey])

  if (!siteKey) return null
  return <div className="public-turnstile" ref={containerRef} aria-label="Application verification" />
}
