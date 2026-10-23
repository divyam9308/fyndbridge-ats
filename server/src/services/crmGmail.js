const crypto = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const { SCOPE, hash, encrypt, decrypt, config, createGoogle, authorizationUrl } = require('./crmGmailGoogle')
const { normalizeEmail, addresses, contactEmails, contactQuery, emailTimestamp, headers, matchMessage, extractBody, SCHEMA, validateAnalysis, analysisPrompt } = require('./crmGmailContent')
const CRM_MODEL = process.env.GEMINI_CRM_MODEL || 'gemini-3.5-flash-lite'
const AI_QUOTA_RETRY_MS = 60000
function historicalMatchAllowed(job, match) {
  if (!job.historical_client_id || !match.client) return true
  if (!job.discovery_contact_email) return match.client.id === job.historical_client_id
  return (match.direction === 'outgoing' ? match.to : [match.from]).includes(job.discovery_contact_email)
}
function fault(code) { return Object.assign(new Error(code), { code }) }
function backoff(attempts, quota = false) { return quota ? 24 * 60 * 60 * 1000 : Math.min(6 * 3600000, 60000 * 2 ** Math.min(attempts, 9)) + crypto.randomInt(1000) }
async function verifiedConsultant(db, userId, access = require('./adminAccess')) {
  const { data, error } = await db.auth.admin.getUserById(userId)
  if (error || !data?.user?.email_confirmed_at) throw fault('WORK_EMAIL_REQUIRED')
  const user = data.user, email = normalizeEmail(user.email)
  if (!/^[^\s@]+@fyndbridge\.in$/.test(email)) throw fault('WORK_EMAIL_REQUIRED')
  const employment = await db.from('employee_statuses').select('status').eq('user_id', userId).maybeSingle()
  if (employment.error) throw employment.error
  if (!employment.data || employment.data.status === 'inactive') throw fault('ACCESS_DENIED')
  const { getPageViewPermission, isAdmin, isSuperAdmin } = access
  const { allowsPageView } = require('./pageViewPermissionPolicy')
  const permission = await getPageViewPermission('crm', { fresh: true })
  if (!permission || (permission !== 'everyone' && !allowsPageView(permission, { isAdmin: await isAdmin(user), isSuperAdmin: await isSuperAdmin(user) }) && !await access.hasIndividualPageAccess?.('crm', userId))) throw fault('ACCESS_DENIED')
  return email
}
function createGmailService({ db = require('./supabaseAdmin'), google, ai = require('./aiProvider').callAiJson, authorize = id => verifiedConsultant(db, id), now = () => Date.now() } = {}) {
  const budgets = new AsyncLocalStorage()
  const requestDeadline = () => budgets.getStore()?.deadline || Infinity
  google ||= createGoogle(fetch, { deadline: requestDeadline })
  const checked = async query => {
    if (typeof query.abortSignal === 'function') query = query.abortSignal(AbortSignal.timeout(Math.max(1, Math.min(4000, requestDeadline() - now()))))
    const { data, error } = await query
    if (error) throw error
    return data
  }
  const authorizeWithinBudget = async id => {
    let timer
    try {
      return await Promise.race([authorize(id), new Promise((_, reject) => { timer = setTimeout(() => reject(fault('AUTH_TIMEOUT')), Math.max(1, Math.min(5000, requestDeadline() - now()))) })])
    } finally { clearTimeout(timer) }
  }
  const rpc = (name, args = {}) => checked(db.rpc(`crm_gmail_${name}`, args))
  const connectionFor = userId => checked(db.from('crm_gmail_connections').select('*').eq('user_id', userId).maybeSingle())
  async function start(userId) {
    config()
    const email = await authorizeWithinBudget(userId), state = crypto.randomBytes(32).toString('base64url'), browser = crypto.randomBytes(32).toString('base64url'), verifier = crypto.randomBytes(32).toString('base64url')
    // Bound abandoned transactions per consultant, including repeated connect clicks.
    await checked(db.from('crm_gmail_oauth_states').delete().eq('user_id', userId))
    await checked(db.from('crm_gmail_oauth_states').insert({ state_hash: hash(state), browser_hash: hash(browser), user_id: userId, expected_email: email, verifier_ciphertext: encrypt(verifier, userId) }))
    return { browser, url: authorizationUrl(state, email, verifier) }
  }
  async function callback({ state, browser, code, error }) {
    if (typeof state !== 'string' || !/^[\w-]{43}$/.test(state) || typeof browser !== 'string' || !/^[\w-]{43}$/.test(browser)) throw fault('INVALID_STATE')
    const transaction = await rpc('consume_state', { p_hash: hash(state), p_browser: hash(browser) })
    if (!transaction) throw fault('INVALID_STATE')
    if (error || typeof code !== 'string' || !code || code.length > 4096) throw fault('OAUTH_DENIED')
    const email = await authorizeWithinBudget(transaction.user_id)
    if (email !== transaction.expected_email) throw fault('WORK_EMAIL_CHANGED')
    const tokens = await google.exchange(code, decrypt(transaction.verifier_ciphertext, transaction.user_id))
    // Verify granted scope AND actual mailbox identity before persisting any tokens.
    if (!String(tokens.scope || '').split(/\s+/).includes(SCOPE)) throw fault('SCOPE_REQUIRED')
    const baselineAt = new Date(now()).toISOString()
    const profile = await google.api(tokens.access_token, 'profile')
    if (normalizeEmail(profile.emailAddress) !== email) throw fault('ACCOUNT_MISMATCH')
    if (!/^\d+$/.test(String(profile.historyId || ''))) throw fault('GMAIL_API_ERROR')
    const previous = await connectionFor(transaction.user_id)
    const old = previous ? decrypt(previous.credentials, transaction.user_id) : {}
    const refresh_token = tokens.refresh_token || old.refresh_token
    if (!refresh_token) throw fault('OFFLINE_ACCESS_REQUIRED')
    const credentials = encrypt({ access_token: tokens.access_token, refresh_token, expires_at: now() + Number(tokens.expires_in || 3600) * 1000 }, transaction.user_id)
    await rpc('connect', { p_hash: transaction.state_hash, p_user: transaction.user_id, p_email: email, p_credentials: credentials, p_history: String(profile.historyId), p_connected_at: baselineAt })
  }
  async function status(userId) {
    // Explicit projection: never send encrypted credentials or operational payloads.
    const snapshot = await rpc('all_sync_status', { p_user: userId })
    return { ...snapshot.connection, connected_mailboxes: snapshot.connected_mailboxes }
  }
  async function disconnect(userId) {
    const credentials = await rpc('disconnect', { p_user: userId })
    if (credentials) {
      try { const tokens = decrypt(credentials, userId); await google.revoke(tokens.refresh_token || tokens.access_token) } catch { /* Credentials already removed, even after encryption-key rotation. */ }
    }
  }
  async function access(connection, force = false) {
    let tokens = decrypt(connection.credentials, connection.user_id)
    if (force || tokens.expires_at <= now() + 60000) {
      const refreshed = await google.refresh(tokens.refresh_token)
      tokens = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || tokens.refresh_token, expires_at: now() + Number(refreshed.expires_in || 3600) * 1000 }
      if (!tokens.access_token) throw fault('GMAIL_REVOKED')
      const credentials = encrypt(tokens, connection.user_id)
      const saved = await checked(db.from('crm_gmail_connections').update({ credentials }).eq('id', connection.id).eq('credentials', connection.credentials).select('id'))
      if (!saved?.length) throw fault('CONNECTION_CHANGED')
      connection.credentials = credentials
    }
    return tokens.access_token
  }
  async function gmail(connection, path, params) {
    try { return await google.api(await access(connection), path, params) }
    catch (error) {
      if (error.status !== 401) throw error
      return google.api(await access(connection, true), path, params)
    }
  }
  async function allowedConnection(c) {
    const email = await authorizeWithinBudget(c.user_id)
    if (email !== normalizeEmail(c.email)) throw fault('WORK_EMAIL_CHANGED')
  }
  async function reauthorize(c, code) {
    await checked(db.from('crm_gmail_connections').update({ status: 'reauthorization_required', last_error: code, lease_id: null, lease_until: null }).eq('id', c.id).eq('credentials', c.credentials))
  }
  async function discover(c, lease) {
    await allowedConnection(c)
    if (!c.sync_requested && c.backfill_started_at && !c.backfill_completed_at) {
      const scan = await rpc('prepare_contact_scan', { p_id: c.id, p_lease: lease })
      if (!scan || !scan.email) return
      const params = { maxResults: '100', q: contactQuery(scan.email, scan.before), ...(scan.page ? { pageToken: scan.page } : {}) }
      let result
      try { result = await gmail(c, 'messages', params) }
      catch (error) {
        if (error.status !== 400 || !params.pageToken) throw error
        delete params.pageToken
        result = await gmail(c, 'messages', params)
      }
      await rpc('commit_contact_page', { p_id: c.id, p_lease: lease, p_snapshot: scan.snapshot, p_index: scan.index,
        p_ids: [...new Set((result.messages || []).map(message => message.id).filter(Boolean))], p_page: result.nextPageToken || null })
      return
    }
    const params = { maxResults: '25', startHistoryId: c.history_id, historyTypes: 'messageAdded', ...(c.page_token ? { pageToken: c.page_token } : {}) }
    let page
    if (!c.recovery_history_id) {
      try { page = await gmail(c, 'history', params) }
      catch (error) {
        if (error.status !== 404) throw error
        // Snapshot BEFORE bounded recovery so messages arriving during recovery are
        // subsequently picked up from this history ID. Never move to a later ID.
        const profile = await gmail(c, 'profile')
        if (!/^\d+$/.test(String(profile.historyId || ''))) throw fault('GMAIL_API_ERROR')
        c.recovery_history_id = String(profile.historyId)
        c.recovery_since = Math.floor(Math.max(new Date(c.connected_at).getTime(), now() - 7 * 86400000, new Date(c.last_sync_at || c.connected_at).getTime() - 2 * 86400000) / 1000)
        c.recovery_pages = 0; c.page_token = null
      }
    }
    if (c.recovery_history_id) {
      const result = await gmail(c, 'messages', { maxResults: '100', q: `after:${c.recovery_since} -in:spam -in:trash -in:drafts`, ...(c.page_token ? { pageToken: c.page_token } : {}) })
      const pages = c.recovery_pages + 1, capped = pages >= 5 && Boolean(result.nextPageToken)
      const next = capped ? null : result.nextPageToken || null
      await rpc('commit_page', { p_id: c.id, p_lease: lease, p_ids: (result.messages || []).map(m => m.id), p_history: next ? null : c.recovery_history_id, p_page: next,
        p_recovery: next ? { history_id: c.recovery_history_id, since: c.recovery_since, pages, warning: 'Expired Gmail history: recovery is limited to seven days and 500 messages; earlier messages may be unavailable.' } : { warning: capped ? 'Recovery reached 500 messages. Some messages were omitted; contact an administrator.' : 'Expired Gmail history recovered within a seven-day window. Earlier messages may be unavailable.' } })
      return
    }
    const ids = [...new Set((page.history || []).flatMap(entry => (entry.messagesAdded || []).map(item => item.message?.id).filter(Boolean)))]
    if (!page.nextPageToken && !/^\d+$/.test(String(page.historyId || ''))) throw fault('GMAIL_API_ERROR')
    await rpc('commit_page', { p_id: c.id, p_lease: lease, p_ids: ids, p_history: page.nextPageToken ? null : String(page.historyId), p_page: page.nextPageToken || null, p_recovery: {} })
  }
  async function discoverClientImport(task, lease) {
    const c = await checked(db.from('crm_gmail_connections').select('*').eq('id', task.connection_id).maybeSingle())
    if (!c || c.status !== 'connected') return
    try {
      await allowedConnection(c)
      const scan = await rpc('prepare_client_scan', { p_id: task.id, p_lease: lease })
      if (!scan || !scan.email) return
      const params = { maxResults: '100', q: contactQuery(scan.email, task.scan_before), ...(scan.page ? { pageToken: scan.page } : {}) }
      let result
      try { result = await gmail(c, 'messages', params) }
      catch (error) {
        if (error.status !== 400 || !params.pageToken) throw error
        delete params.pageToken
        result = await gmail(c, 'messages', params)
      }
      await rpc('commit_client_contact_page', { p_id: task.id, p_lease: lease, p_snapshot: scan.snapshot, p_index: scan.index, p_ids: [...new Set((result.messages || []).map(message => message.id).filter(Boolean))], p_page: result.nextPageToken || null })
    } catch (error) {
      const denied = ['GMAIL_REVOKED','WORK_EMAIL_CHANGED','ACCESS_DENIED','WORK_EMAIL_REQUIRED'].includes(error.code) || [401,403].includes(error.status)
      if (denied) await reauthorize(c, 'REAUTHORIZE')
      await checked(db.from('crm_gmail_client_imports').update({ status: denied || task.attempts >= 8 ? 'failed' : 'pending', last_error: denied ? 'REAUTHORIZE' : 'DISCOVERY_RETRY', next_attempt_at: new Date(now() + backoff(task.attempts, error.code === 'GMAIL_DAILY_QUOTA')).toISOString(), lease_id: null, lease_until: null }).eq('id', task.id).eq('lease_id', lease))
    }
  }
  async function processJob(job, lease) {
    const c = await checked(db.from('crm_gmail_connections').select('*').eq('id', job.connection_id).maybeSingle())
    if (!c || c.status !== 'connected') return
    try {
      await allowedConnection(c)
      const imported = await checked(db.from('crm_activities').select('id').eq('gmail_user_id', c.user_id).eq('gmail_message_id', job.message_id).maybeSingle())
      if (imported) return await rpc('finish_job', { p_id: job.id, p_lease: lease, p_client: null, p_metadata: null, p_outcome: 'activity_created' })
      const message = await gmail(c, `messages/${encodeURIComponent(job.message_id)}`, { format: 'metadata' })
      if (message.id !== job.message_id || !Number.isFinite(Number(message.internalDate)) || Number(message.internalDate) <= 0) throw fault('GMAIL_INVALID_MESSAGE')
      let outcome = 'before_connection'
      let match
      if (job.discovery_kind === 'historical' || job.historical_client_id || Number(message.internalDate) >= new Date(c.connected_at).getTime()) {
        const h = headers(message)
        const peers = addresses(h.from).includes(c.email) ? [...addresses(h.to), ...addresses(h.cc), ...addresses(h.bcc)] : addresses(h.from)
        const clients = await rpc('match_clients', { p_peers: peers.filter(email => email !== c.email) })
        match = matchMessage(message, c.email, clients); outcome = match.reason
        if (!historicalMatchAllowed(job, match)) { match = null; outcome = 'historical_client_mismatch' }
      }
      if (!match?.client) return await rpc('finish_job', { p_id: job.id, p_lease: lease, p_client: null, p_metadata: null, p_outcome: outcome })
      // Only matched messages are fetched in full. Never use attachments.get.
      const full = await gmail(c, `messages/${encodeURIComponent(job.message_id)}`, { format: 'full' })
      if (full.id !== job.message_id || !Number.isFinite(Number(full.internalDate)) || Number(full.internalDate) <= 0) throw fault('GMAIL_INVALID_MESSAGE')
      const h = headers(full)
      const peers = addresses(h.from).includes(c.email) ? [...addresses(h.to), ...addresses(h.cc), ...addresses(h.bcc)] : addresses(h.from)
      match = matchMessage(full, c.email, await rpc('match_clients', { p_peers: peers.filter(email => email !== c.email) }))
      if (!match.client) return await rpc('finish_job', { p_id: job.id, p_lease: lease, p_client: null, p_metadata: null, p_outcome: match.reason })
      if (!historicalMatchAllowed(job, match)) return await rpc('finish_job', { p_id: job.id, p_lease: lease, p_client: null, p_metadata: null, p_outcome: 'historical_client_mismatch' })
      const body = extractBody(full.payload)
      if (!body) return await rpc('finish_job', { p_id: job.id, p_lease: lease, p_client: null, p_metadata: null, p_outcome: 'empty_body' })
      const raw = await ai({ prompt: analysisPrompt(body, match.direction, h.subject || ''), schema: SCHEMA, schemaName: 'crm_email_analysis', model: CRM_MODEL, timeoutMs: Math.max(1, Math.min(5500, Math.floor((requestDeadline() - now() - 4000) / 3))), safeErrors: true })
      const analysis = validateAnalysis(raw, body, match.direction)
      // Recheck ownership/access and current contacts before committing an insight.
      await allowedConnection(c)
      const current = matchMessage(full, c.email, await rpc('match_clients', { p_peers: peers.filter(email => email !== c.email) }))
      if (!current.client) return await rpc('finish_job', { p_id: job.id, p_lease: lease, p_client: null, p_metadata: null, p_outcome: current.reason })
      if (!historicalMatchAllowed(job, current)) return await rpc('finish_job', { p_id: job.id, p_lease: lease, p_client: null, p_metadata: null, p_outcome: 'historical_client_mismatch' })
      match = current
      return await rpc('finish_job', { p_id: job.id, p_lease: lease, p_client: current.client.id,
        p_metadata: { source: 'gmail', direction: match.direction, sender: match.from, recipients: match.to, subject: (h.subject || '(No subject)').slice(0, 500), email_at: emailTimestamp(full), summary: analysis.summary, meeting: analysis.meeting, negative_response: analysis.negative_response, sentiment: analysis.sentiment, model: CRM_MODEL, analysed_at: new Date(now()).toISOString() }, p_outcome: 'activity_created' })
    } catch (error) {
      const quota = error.statusCode === 429 || error.code === 'AI_QUOTA_REACHED'
      const revoked = ['GMAIL_REVOKED','WORK_EMAIL_CHANGED','ACCESS_DENIED','WORK_EMAIL_REQUIRED'].includes(error.code) || [401,403].includes(error.status)
      if (revoked) await reauthorize(c, 'REAUTHORIZE')
      // Global circuit breaker persists across serverless instances and consultants.
      const retryAt = new Date(now() + (quota ? AI_QUOTA_RETRY_MS : backoff(job.attempts, error.code === 'GMAIL_DAILY_QUOTA'))).toISOString()
      if (quota) await checked(db.from('crm_gmail_worker').update({ ai_resume_at: retryAt }).eq('id', true))
      const gmailQuota = ['GMAIL_DAILY_QUOTA','GMAIL_RATE_LIMIT'].includes(error.code)
      const permanent = error.status === 404 || (!quota && !gmailQuota && job.attempts >= 8)
      await checked(db.from('crm_gmail_jobs').update({ status: permanent ? 'permanent_failure' : 'retryable_failure', available_at: retryAt, last_error: quota ? 'QUOTA_PAUSED' : revoked ? 'REAUTHORIZE' : error.code === 'INVALID_AI_OUTPUT' ? 'INVALID_AI_OUTPUT' : 'PROCESSING_FAILED', lease_id: null, lease_until: null }).eq('id', job.id).eq('lease_id', lease))
    }
  }
  async function run({ schedule = false, budgetMs = 45000, userId = null, newOnly = false, clientId = null } = {}) {
    const deadline = now() + Math.min(45000, budgetMs), lease = crypto.randomUUID()
    return budgets.run({ deadline }, async () => {
      if (schedule && !userId && !clientId) await rpc('schedule')
      if (!await rpc('claim_worker_v2', { p_lease: lease })) return { busy: true }
      let discovered = 0, processed = 0
      try {
        // Alternate discovery and processing; a large mailbox cannot starve jobs.
        for (let step = 0; step < 12 && now() < deadline - 27000; step++) {
          const c = clientId ? null : await rpc(newOnly ? 'claim_incremental_sync' : userId ? 'claim_user_sync' : 'claim_sync', { p_lease: lease, ...(userId ? { p_user: userId } : {}) })
          if (c) {
            try { await discover(c, lease); discovered++ }
            catch (error) {
              const denied = ['GMAIL_REVOKED','WORK_EMAIL_CHANGED','ACCESS_DENIED','WORK_EMAIL_REQUIRED'].includes(error.code) || [401,403].includes(error.status)
              if (denied) await reauthorize(c, 'REAUTHORIZE')
              else await checked(db.from('crm_gmail_connections').update({ last_error: 'SYNC_RETRY', sync_attempts: c.sync_attempts + 1, next_attempt_at: new Date(now() + backoff(c.sync_attempts + 1, error.code === 'GMAIL_DAILY_QUOTA')).toISOString(), lease_id: null, lease_until: null }).eq('id', c.id).eq('lease_id', lease))
            }
          }
          const task = !c && !newOnly ? await rpc('claim_client_import', { p_lease: lease, p_client: clientId }) : null
          if (task) { await discoverClientImport(task, lease); discovered++ }
          if (now() >= deadline - 27000) break
          const job = clientId ? await rpc('claim_client_job', { p_lease: lease, p_client: clientId })
            : await rpc(newOnly ? 'claim_incremental_job' : userId ? 'claim_user_job' : 'claim_job', { p_lease: lease, ...(userId && !newOnly ? { p_user: userId } : {}) })
          if (job) { await processJob(job, lease); processed++ }
          if (!c && !task && !job) break
        }
        return { discovered, processed }
      } finally {
        await checked(db.from('crm_gmail_worker').update({ lease_id: null, lease_until: null }).eq('id', true).eq('lease_id', lease))
      }
    })
  }
  async function syncNow(userId) {
    const deadline = now() + 45000
    return budgets.run({ deadline }, async () => {
      await authorizeWithinBudget(userId)
      const requested = await rpc('request_all_sync', { p_actor: userId })
      if (requested.state === 'not_connected') throw fault('NO_CONNECTED_MAILBOXES')
      if (requested.state === 'cooldown') throw Object.assign(fault('SYNC_COOLDOWN'), { retryAfter: requested.retry_after })
      const result = await run({ budgetMs: deadline - now() - 4000 })
      const snapshot = await rpc('all_sync_status', { p_user: userId })
      return { ...snapshot, state: snapshot.no_contacts ? 'no_contacts' : syncState(snapshot, result.busy) }
    })
  }
  function syncState(snapshot, busy) {
    return !snapshot.connected_mailboxes ? 'not_connected' : snapshot.ai_paused && snapshot.pending_jobs ? 'quota_paused'
      : busy || snapshot.discovery_pending || snapshot.pending_jobs ? 'pending'
        : snapshot.failed_jobs ? 'partial' : 'completed'
  }
  // Public normal-sync entry point. Historical tasks continue only on their own
  // explicit action or the background worker, never on a toolbar new-mail sync.
  async function syncNewEmails(userId) {
    const deadline = now() + 45000
    return budgets.run({ deadline }, async () => {
      await authorizeWithinBudget(userId)
      const requested = await rpc('request_incremental_sync', { p_actor: userId })
      if (requested.state === 'not_connected') throw fault('NO_CONNECTED_MAILBOXES')
      if (requested.state === 'cooldown') throw Object.assign(fault('SYNC_COOLDOWN'), { retryAfter: requested.retry_after })
      const result = await run({ newOnly: true, budgetMs: deadline - now() - 4000 })
      const snapshot = await rpc('incremental_sync_status', { p_user: userId })
      return { ...snapshot, state: syncState(snapshot, result.busy) }
    })
  }
  async function syncClientHistory(userId, clientId) {
    const deadline = now() + 45000
    return budgets.run({ deadline }, async () => {
      await authorizeWithinBudget(userId)
      const client = await checked(db.from('crm_clients').select('id,organisation_name,contacts').eq('id', clientId).maybeSingle())
      if (!client) throw fault('CLIENT_NOT_FOUND')
      const emails = contactEmails(client.contacts)
      if (!emails.length) throw fault('CLIENT_EMAIL_REQUIRED')
      const requested = await rpc('request_client_import', { p_actor: userId, p_client: clientId, p_emails: emails })
      if (requested.state === 'not_connected') throw fault('NO_CONNECTED_MAILBOXES')
      if (requested.state === 'client_not_found') throw fault('CLIENT_NOT_FOUND')
      if (requested.state === 'cooldown') throw Object.assign(fault('SYNC_COOLDOWN'), { retryAfter: requested.retry_after })
      const result = await run({ clientId, budgetMs: deadline - now() - 4000 })
      const snapshot = await rpc('client_import_status', { p_client: clientId })
      return { ...snapshot, client_name: client.organisation_name, state: syncState(snapshot, result.busy) }
    })
  }
  return { start, callback, status, disconnect, syncNow, syncNewEmails, syncClientHistory, run, access, discover, discoverClientImport, processJob }
}
module.exports = { createGmailService, verifiedConsultant, backoff, CRM_MODEL }
