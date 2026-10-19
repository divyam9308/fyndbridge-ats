# Consultant access controls and Gmail testing

Implemented locally on 19 October 2026. No hosted migration, push or deployment was
performed by this task. Existing local/staged work was preserved.

## Configure access

As a Super Admin, open **Admin Panel → Page View Permissions**. Existing page rows,
including CRM and Assigned Candidates visibility, retain Everyone / Admin Only /
Super Admin Only. Three controls additionally have **Selected consultants**:

1. CRM: permits the page and its APIs, including that consultant's Gmail connection.
2. Assigned Candidates · New / Delete All: permits the assignment upload/create flow
   and the existing contacted-only Delete All operation.
3. Assigned Candidates · Overall Consultants: permits the consultant dropdown,
   cross-consultant read scope and overall sidebar count.

Choose the base role, expand Selected consultants, search/check active consultants,
and click the existing **Save Changes** button. Cancel restores saved selections.
Selections supplement the role; Everyone still permits all consultants. Choose
Admin Only or Super Admin Only to restrict other consultants. Only Super Admins can
change these settings; neither grant promotes a consultant to an administrator.

Both action grants still require Assigned Candidates page visibility.
New/Delete All and Overall are independent. Without Overall, Delete All is restricted
to the acting consultant's own assignments. With both grants, it respects the chosen
consultant scope or Overall. Both Not Contacted and Didn’t Pick Up remain protected.
Individual/selected-row deletion and reassignment remain administrator actions.

Overall alone permits viewing colleagues' assignments and CVs, but cannot change
colleagues' statuses, review/transfer them to Candidates, or create/delete assignments.
Own-assignment status and transfer behaviour remains unchanged. UI controls, HTTP
handlers and SQL independently enforce their respective boundaries.

New controls default to Admin Only. Existing page visibility values are preserved.
Permissions and active employment are checked server-side on each request; selected
IDs do not come from a browser-supplied acting-user property. The frontend reloads
permissions on focus and refreshes counts after changes.

## Sidebar badge

The number remains the existing Not Contacted aggregate:

| Actual access | Green | Red with reminder animation |
| --- | --- | --- |
| Individual only | 0–10 | 11+ |
| Can use Overall Consultants, including selected non-admins | 0–50 | 51+ |

The threshold uses the API's effective Overall access, independent of administrator
role and independent of the currently selected table filter. Overall counts retain
the existing active-consultant aggregation. The red badge uses the same three-second
reminder-ring cadence as the dashboard attendance button. Reduced-motion preference
keeps the red state and removes animation. Existing 99+ truncation and full accessible
count remain.

## Gmail button

After connection the primary toolbar action is **Disconnect Gmail**. It disconnects
directly, shows Disconnecting while pending, and returns to Connect Gmail on success.
The adjacent information icon opens the mailbox/status/last-sync popup. That popup
also retains Disconnect and any required Reconnect action. Failed requests display
an error and retain the actual connection state.

Disconnect retains existing email activities while removing credentials, cancelling
jobs, stopping future sync and attempting Google revocation. Gmail ownership remains
the authenticated consultant, regardless of assignment-table consultant selection.

## Migration and security

Apply `supabase/migrations/20261019175017_consultant_access_controls.sql` to the
intended ATS project before deploying this update. Check migration history first.
The earlier Gmail migration is also required if not already applied:
`20261019165228_crm_gmail_integration.sql`.

The new migration extends `page_view_permissions` with `allowed_user_ids uuid[]`
(default empty, maximum 200, no null IDs), preserving existing RLS and browser read-only grants.
It adds the two action-resource rows and private, fixed-search-path permission
helpers, extends assignment SELECT RLS for authorized Overall readers, and updates
existing service-only create/delete RPCs. It does not add direct browser mutation
access or grant general access to `auth.users`.

The actor helper is private, checks active employment and prevents a JWT caller from
substituting another actor. The authenticated RLS helper can only inspect the current
user's effective Overall access. Creation retains owned CV manifests, reference
validation, transactional batches and idempotency. Delete All repeats permission and
scope enforcement inside its database transaction.

No environment variables or dependencies were added for these follow-up changes.
Existing Gmail variables and `GEMINI_CRM_MODEL` remain as documented in CRM_GMAIL.md.

## How to test Gmail end to end

1. Ensure the Gmail migration and this permissions migration are applied and the
   reviewed frontend/API build is deployed. Keep the configured callback exactly
   `https://fyndbridge-ats.vercel.app/api/crm/gmail/callback`; confirm Gmail API and
   OAuth consent access for the intended work accounts. Production already has the
   five supplied Gmail/cron settings and existing Gemini keys; no values are needed
   in chat.
2. As a consultant with CRM access, create a clearly labelled CRM test organisation
   whose contact email is another mailbox you control or a consenting tester's
   address. Record its status, conversion band and comments so they can be compared.
3. Click Connect Gmail, authorize the same verified FyndBridge work email used by
   the ATS account, then confirm the primary action becomes Disconnect Gmail.
   Use the information icon to confirm the connected address and status. Old emails
   should not be imported; send the following messages **after** connecting.
4. From the contact mailbox send: “Could we meet Friday at 2 PM to discuss your
   recruitment services?” Send a separate follow-up confirming the meeting. In another
   message say: “We have no recruitment requirements this quarter; please check with
   us next quarter.” Also send a short outgoing introduction from the work mailbox.
5. After applying `20261019182711_crm_gmail_manual_sync.sql` and deploying the manual
   sync change, click **Sync now** beside Disconnect Gmail. It starts discovery and
   analysis immediately for your own mailbox. Wait for the result dialog, then open
   Activity History. Larger batches and busy/provider-delayed work continue through
   the minute worker; the dialog identifies queued or quota-paused processing.
   Without a manual request, the normal next hourly discovery remains available.
   An operator can also invoke the protected
   `/api/cron/crm-gmail-sync` once and then `/api/cron/crm-gmail-worker` with the existing
   server-side CRON_SECRET. Do not change the normal hourly discovery schedule.
   Vercel sends the configured secret automatically on scheduled calls:
   https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
6. Open that organisation's existing Activity History. Expect one entry per message,
   direction/address/subject/time, summary, purple meeting status, red temporary
   rejection where applicable, and qualitative interest. An outgoing introduction
   alone should show Not assessable. No calendar, follow-up or numeric probability
   should be created.
7. Refresh and run discovery again: the same message must not create a duplicate.
   Verify status, conversion band, contacts and comments match the recorded values.
   Send an email from an address absent from all CRM contacts: it should create no
   activity. A contact duplicated across organisations should be skipped as ambiguous.
8. Click Disconnect Gmail, refresh, and verify Connect Gmail remains. Send another
   test message; future cron runs should create no activity for the disconnected
   mailbox. Existing history stays intact. Test a wrong Google account separately:
   connection should fail with the work-email mismatch message, without saving tokens.

For a provider-only check without mailbox access, run from the repo root:

```sh
node server/scripts/verify-crm-gmail-ai.js --live
```

This explicitly performs four Gemini requests using synthetic email text and the
existing server-side keys. It tests model/output compatibility; it is not an OAuth,
live Gmail or hosted cron test. Real Google authorization was not performed here.

## Verification and source changes

Focused backend tests in `server/src/services/consultantAccess.test.js` use actual
Express handlers and isolated PostgreSQL, covering grant persistence/revocation,
invalid/inactive IDs, denied permission writes, independent action/read access,
owned CV creation, contacted-only deletion, RLS and prevented colleague writes.
Existing Assigned Candidates schema tests now exercise the new migration and use
SQL authorization codes instead of obsolete administrator-only wording.

Browser coverage in `server/browser-tests/consultant-access.spec.cjs` uses matching
synthetic Auth/backend UUIDs, real Admin saves, persistence, Cancel, direct routes,
revocation, a delegated New dialog, Overall read-only controls, exact 10/11 and 50/51
badge boundaries, reminder animation and reduced motion. Gmail browser coverage now
checks direct toolbar disconnection and the separate connection-details control.
Final results and screenshots are in `outputs/consultant-access-verification/`.

Changed application areas: Admin page/settings component and API, page-permission
hook/policy/middleware, effective assignment access in the controller and existing
SQL RPCs/RLS, Sidebar badge, and Gmail button. Test schema/query adapters and the
isolated browser fixture were extended accordingly. No credentials or real mailbox
content are present in test fixtures or evidence.
