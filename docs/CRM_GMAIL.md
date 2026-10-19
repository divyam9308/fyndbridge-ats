# CRM Gmail integration — implementation and rollout

Implemented locally in the nested Fyndbridge ATS checkout on 19 October 2026.
No commit, push, hosted migration, or deployment was performed. No real Google
mailbox was authorized. Synthetic browser data is confined to test fixtures.

## Behaviour and boundaries

Each authenticated consultant connects the Gmail mailbox matching their confirmed
Supabase Auth email at `fyndbridge.in`. Email identity comes from the Auth admin API,
not editable profile metadata or a selected consultant. Employment and current CRM
page permission are checked before connection, callback, discovery and analysis.
Google's Gmail profile must match that address before credentials are persisted.

The current CRM has no Overall Consultants control. The button is at the right end
of its existing toolbar; no consultant control or other page was changed. Its
existing modal conventions show mailbox, connection status, last completed discovery,
recovery warnings and disconnect/reconnect controls. The toolbar changes from
Connect Gmail to Disconnect Gmail after connection; the adjacent information button
opens connection details. The existing 13 columns remain unchanged. CRM visibility
now supports selected consultants in Admin → Page View Permissions, as described in
[the follow-up access report](CONSULTANT_ACCESS.md).

Only exact, case-normalized contact emails match. All contact persons are included.
Public domains receive no special domain matching; an exact address can still match.
Ambiguous organisations and unrelated messages are skipped before any full-message
fetch or AI call. Incoming matching uses the external sender; outgoing matching uses
To/Cc/Bcc. Drafts, spam, trash and messages predating the connection are excluded.
Contact matching is rechecked in the activity-write transaction.

Only `crm_activities` receives CRM writes: one `gmail_email` row per consultant and
Gmail message, containing direction, sender/recipients, subject, email timestamp,
AI summary and all insights. Existing history pagination stays 25, newest first.
Meeting insights are purple; negative responses red; positive/neutral/negative
interest green/grey/orange. Unknown interest is supported. Outgoing consultant
emails always have unknown client interest and no client-rejection inference.

No status, conversion band, contact data, assignment, follow-up, comments, ATS Client,
mandate, calendar, reminder, sending or reply operation is performed.

## OAuth and API endpoints

| Method | Endpoint | Authorization |
| --- | --- | --- |
| POST | `/api/crm/gmail/connect` | Existing ATS auth and CRM page permission |
| GET | `/api/crm/gmail/callback` | Single-use state, browser cookie and PKCE |
| GET | `/api/crm/gmail/status` | Current consultant only, existing CRM permission |
| DELETE | `/api/crm/gmail/disconnect` | Current consultant only, existing CRM permission |
| GET | `/api/cron/crm-gmail-sync` | Constant-time `CRON_SECRET` Bearer comparison |
| GET | `/api/cron/crm-gmail-worker` | Same cron authorization |

Callback and cron routes are registered before global Bearer-token processing.
The Google authorization code is exchanged only on the backend. State has 256 bits
of entropy, is stored as a SHA-256 digest, expires after ten minutes, and is atomically
consumed once. A separate random cookie binds the initiating browser; it is HttpOnly,
Secure on HTTPS, SameSite=Lax, host-only and Path=/. PKCE uses S256. Return destinations
come from the configured callback origin; browser input cannot supply a redirect.
Errors return fixed messages and return to `/dashboard/crm` without provider details.

## Persistence and migration

Created with `supabase migration new crm_gmail_integration`:
`supabase/migrations/20261019165228_crm_gmail_integration.sql`.
Apply after the existing CRM migrations; this migration has **not** been applied to
hosted Supabase.

- `crm_gmail_oauth_states`: hashed state/cookie, authenticated owner, expected email,
  encrypted PKCE verifier, expiry and single-use marker.
- `crm_gmail_connections`: encrypted token bundle, mailbox identity, original
  connection time, history checkpoint, page/recovery cursors, retries and sync lease.
- `crm_gmail_jobs`: Gmail message IDs only, status, attempt/backoff/lease and safe
  diagnostic codes. No email bodies or attachments are persisted here.
- `crm_gmail_worker`: global worker lease and persistent AI quota circuit breaker.
- Existing `crm_activities`: nullable `email_metadata`, `gmail_user_id`, and
  `gmail_message_id`, provenance check and unique consultant/message index.
- A GIN expression index over normalized JSON contact addresses supports exact
  matching without modifying contacts or replacing `crm_save`.

All four new tables enable RLS and revoke PUBLIC/anon/authenticated access. RPCs are
SECURITY INVOKER, have an empty search_path and explicitly grant execution only to
service_role. Existing CRM grants and RPCs are preserved. Operational indexes cover
ready jobs, discovery, OAuth expiry, connection ownership and message uniqueness.

Tokens use AES-256-GCM with a fresh 12-byte IV, authentication tag and consultant UUID
as authenticated additional data. The encryption key is decoded from exactly 64 hex
characters. Access and refresh tokens are encrypted together. Tokens never reach the
frontend or application logs. Missing replacement refresh tokens preserve the old
refresh token. Reauthorization preserves checkpoints for the same mailbox. A changed
verified mailbox creates a new connection generation and baseline.

Disconnect atomically invalidates OAuth transactions, deletes credentials and
cascades all processing jobs before attempting Google revocation. Connection/job
locks and generation IDs prevent a stale completion from inserting a new activity
after disconnect. Existing activities remain.

## Gmail API and scheduling

Only `gmail.readonly` is requested, with offline access. Gmail calls use profile,
history.list and messages.get/list; no send, modify, watch, attachment download,
Pub/Sub or calendar APIs are called. The MIME reader ignores attachments, handles
plain text, HTML, multipart alternatives, nested content and charsets, and bounds
reply/forward context and signatures. HTML is converted to text, never rendered as
HTML. Email text remains untrusted prompt data.

`vercel.json` retains its existing functions/rewrites and 60-second duration:

| Schedule | Path | Purpose |
| --- | --- | --- |
| `0 * * * *` | `/api/cron/crm-gmail-sync` | Mark connected mailboxes for hourly discovery and run a bounded worker |
| `* * * * *` | `/api/cron/crm-gmail-worker` | Drain jobs and continue already-requested discovery pages/retries |

The minute worker **does not start a fresh mailbox poll**. Once an hourly discovery
has completed, only a later hourly kickoff can request another. Delayed scheduled
invocations and unfinished pages remain recoverable from persistent checkpoints.

Initial authorization records the current Gmail history ID, importing no historical
mailbox. Normal history pages enqueue message IDs and commit the next page/checkpoint
in the same database transaction. A failed enqueue rolls back checkpoint movement.
Analysis failures do not lose discovered messages because jobs remain durable.

An expired Gmail history ID triggers recovery from a snapshot captured **before** the
recovery starts. It scans at most seven recent days, never before connection time,
and at most five pages of 100 IDs. Every page is durable. Hitting the cap leaves an
explicit connection warning that some messages were omitted; older recovery coverage
cannot be guaranteed. Messages added during recovery are available from the captured
history snapshot at the next hourly run.

A worker uses a 45-second budget, at most twelve iterations, short network timeouts,
request-local deadlines, and a global 70-second database lease. Discovery and jobs
alternate so a large mailbox cannot starve analysis. Claims use atomic UPDATE plus
FOR UPDATE SKIP LOCKED. Expired processing leases can be reclaimed; completions must
still own a valid lease. An overlapping cron returns `busy` and leaves work durable.

Throughput is bounded, not guaranteed to drain any mailbox size within one hour.
Monitor queue age and failure counts against actual consultant volume. The theoretical
cap is twelve jobs per minute; provider latency/quota can reduce this substantially.

## Gemini configuration and retries

`GEMINI_CRM_MODEL=gemini-3.5-flash-lite` selects the independent CRM model. The same
identifier is the CRM default. On 19 October 2026 the configured local primary key
successfully fetched `models/gemini-3.5-flash-lite` metadata (HTTP 200), advertising
`generateContent`. Google's official model page also lists this identifier:
https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
Four live Gemini requests using synthetic email text also passed structured validation
and expected proposal, confirmation, temporary rejection and outgoing-unknown checks.
This confirms provider compatibility; it is not evidence of live mailbox analysis.

A minimal backward-compatible `callAiJson` extension accepts an optional model,
timeout and safe error logging. Existing callers still use `GEMINI_MODEL`, the
original 30-second timeout, and the exact original primary/secondary quota fallback
order. Neither CV parsing configuration nor fallback decisions were changed.
CRM calls apply shorter per-attempt deadlines to fit the function budget.

All four tasks use one structured analysis request. Server validation rejects
unknown keys, bad types/enums, excessive strings, unsupported dates, and meeting,
rejection or sentiment evidence absent from the extracted body. Dates are verbatim
source text rather than invented timestamps. No numeric conversion value exists in
the analysis schema. Validation reduces unsupported output but cannot prove semantic
accuracy; human review of actual summaries and classifications remains necessary.

Network/Gmail failures and invalid output retry with exponential backoff and jitter.
Gmail rate-limit reasons are distinguished from revoked access; daily Gmail quota
waits 24 hours without pausing unrelated AI work. Exhausted Gemini quota pauses CRM
AI jobs globally for 24 hours and retains pending jobs without retry-count discard.
Other failures become permanent after eight failed claims; missing messages are
permanent. Workers do not rotate keys or create a new provider fallback strategy.

## Environment and deployment

Vercel Production variable names verified on 19 October 2026 (no values read or changed):

- `GoogleOAuthclientID` (also accepts `GOOGLE_GMAIL_CLIENT_ID`, which takes precedence)
- `GoogleOAuthclientsecret` (also accepts `GOOGLE_GMAIL_CLIENT_SECRET`, which takes precedence)
- `GOOGLE_GMAIL_REDIRECT_URI=https://fyndbridge-ats.vercel.app/api/crm/gmail/callback`
- `GMAIL_TOKEN_ENCRYPTION_KEY`
- `CRON_SECRET`
- Existing `GEMINI_API_KEY_PRIMARY` and `GEMINI_API_KEY_SECONDARY`
- Existing Supabase server credentials and existing CV `GEMINI_MODEL`

The original code expected only the uppercase OAuth names, while Production used
the mixed-case names above. That mismatch caused the "Gmail integration is not
configured" message. The server now accepts both spellings. A deployment containing
this change is required; merely retrying the old deployment will not resolve it.
The remaining callback URI and encryption-key format are still validated. Variable
metadata confirms names and Production scope, not secret validity or live consent.
Gmail errors and OAuth feedback appear inside the connection dialog so they cannot
push the toolbar controls onto another row; closing the dialog keeps the error
available through the Gmail button.

The separate CRM model variable is present for explicit configuration. No duplicate
Gemini key variables or dependencies were introduced. The example environment file
contains empty placeholders only. Do not rotate the encryption key without a planned
credential migration/reconnection process.

Rollout steps:

1. Review and apply the new migration to the intended ATS Supabase project using the
   normal migration process. Confirm existing migration history before applying it.
2. Check hosted RLS/grants and RPC permissions, including denial for browser roles.
3. Confirm Gmail API is enabled and the OAuth client/consent configuration permits
   the work accounts and exact Production callback URI.
4. Set `GEMINI_CRM_MODEL` explicitly; retain all existing keys/model settings.
5. Deploy the reviewed application and verify both cron entries in Vercel. No commit,
   push or deployment is included in this local implementation.
6. A consultant must authorize their **own** work mailbox. Verify wrong-account
   rejection and the connection popup. Send/receive new synthetic test emails with
   a consenting CRM test contact, then verify discovery, analysis and history.
7. Verify hosted cron authentication, checkpoints, retries and disconnect. Confirm
   all CRM fields/comments remain unchanged and existing CV parsing still works.

Useful backend-only diagnostics, without exposing credentials or bodies:

```sql
select status, count(*), min(created_at) as oldest_created
from public.crm_gmail_jobs group by status;
select email, status, last_sync_at, last_error, coverage_warning
from public.crm_gmail_connections;
select ai_resume_at from public.crm_gmail_worker;
```

## Files

Created:

- `server/src/routes/crmGmail.js`
- `server/src/services/crmGmail.js`
- `server/src/services/crmGmailGoogle.js`
- `server/src/services/crmGmailContent.js`
- `server/src/services/crmGmail.test.js`
- `server/src/services/crmGmailAi.test.js`
- `server/scripts/verify-crm-gmail-ai.js` (explicit `--live` synthetic provider check)
- `src/components/CrmGmailConnection.jsx`
- `server/browser-tests/crmGmail.spec.cjs`
- `supabase/migrations/20261019165228_crm_gmail_integration.sql`
- This report and synthetic screenshots under `outputs/crm-gmail-verification/`

Modified:

- `server/src/app.js`: public callback and separately authenticated cron routes.
- `server/src/routes/crm.js`: protected Gmail router before client-ID routes.
- `server/src/services/aiProvider.js`: optional CRM settings, unchanged CV defaults.
- `src/pages/CrmPage.jsx`, `src/pages/CrmPage.css`: native button and insight colours.
- `src/components/CrmDialogs.jsx`: email rendering within existing history cards.
- `server/test-support/crmServer.cjs`: isolated Gmail schema/fixtures for browsers.
- `server/.env.example`: server-only Gmail settings and separate CRM model.
- `vercel.json`: two cron entries, preserving prior configuration.

## Verification and remaining acceptance

See `outputs/crm-gmail-verification/results.md` for final command results. Tests use
the actual migration in isolated PGlite PostgreSQL, real Express handlers, synthetic
Gmail/Gemini responses and real Chromium/WebKit React rendering. Browser screenshots
were visually inspected. Tests do not prove real Google OAuth, real mailbox discovery,
semantic quality of real mailbox analysis, or hosted cron delivery.

The repository-wide lint command reports existing issues in untouched source and
existing generated `.vercel/output` files; changed JavaScript/JSX files pass lint.
Unchanged dependency lockfiles have existing audit findings: server has one critical,
two high and three moderate advisories; frontend has one high and one moderate.
No automatic dependency remediation was attempted because it is outside the requested
Gmail scope. These findings and the hosted checks above remain release considerations.
