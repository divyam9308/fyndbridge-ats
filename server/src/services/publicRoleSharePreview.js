function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeFrontendOrigin(value, fallback = 'http://localhost:5173') {
  for (const candidate of [value, fallback]) {
    try {
      const url = new URL(candidate)
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
    } catch {
      // Try the fallback origin.
    }
  }
  return 'http://localhost:5173'
}

function buildPublicRoleShareHtml(role, frontendOrigin) {
  const origin = safeFrontendOrigin(frontendOrigin)
  const slug = encodeURIComponent(clean(role?.slug))
  const roleUrl = `${origin}/open-roles/${slug}`
  const shareUrl = `${origin}/share/open-roles/${slug}`
  const imageUrl = `${origin}/assets/fyndbridge-official-logo.png`
  const roleName = clean(role?.public_name) || 'Open Role'
  const location = clean(role?.public_location) || 'Location not specified'
  const experience = clean(role?.public_experience) || 'Experience not specified'
  const title = `${roleName} | FyndBridge Open Roles`
  const description = `Location: ${location} · Experience: ${experience}`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="noindex,follow" />
    <link rel="canonical" href="${escapeHtml(roleUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="FyndBridge Open Roles" />
    <meta property="og:title" content="${escapeHtml(roleName)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:alt" content="FyndBridge" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(roleName)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <meta http-equiv="refresh" content="0;url=${escapeHtml(roleUrl)}" />
  </head>
  <body>
    <p>Opening <a href="${escapeHtml(roleUrl)}">${escapeHtml(roleName)}</a> at FyndBridge…</p>
    <script>window.location.replace(${JSON.stringify(roleUrl).replace(/</g, '\\u003c')})</script>
  </body>
</html>`
}

module.exports = { buildPublicRoleShareHtml, safeFrontendOrigin }
