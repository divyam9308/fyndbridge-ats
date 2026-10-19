# Consultant permissions, Gmail button and sidebar verification

19 October 2026. All database/browser fixtures are synthetic and isolated.

| Check | Result |
| --- | --- |
| `npm --prefix server test` | 820 passed, 0 failed |
| `node --test src/utils/*.test.js src/features/attendance/*.test.js` | 16 passed, 0 failed |
| Changed/new JavaScript and JSX ESLint | Passed, no warnings |
| Changed CJS test fixture/spec syntax checks | Passed |
| `git diff --check` | Passed |
| `npm run build` | Passed |
| Initial broad compiled-browser regression | 93 passed, 5 failed out of 98, detailed below |
| Corrected dev-server target run in Chromium/WebKit | 16 passed, 0 failed |
| Final compiled-build target run in Chromium/WebKit | 12 passed, 0 failed |
| Global `npm run lint` | Existing 885 errors, 3 warnings in unrelated source/generated output |
| Real Google consent, hosted cron, hosted migrations/deployment | Not performed by this task |

The broad regression included Assigned Candidates (uploads, batch assignment,
selection, duplicate handling, transfer, cleanup, status order, read restrictions,
layout), CRM, Gmail, Admin, PMS and Applied Candidates. Four failures were checks
that explicitly load a development-only HTML harness or import
`/src/hooks/useStaffDirectory.js`; the single-entry production build does not serve
those sources. They passed when run on their intended dev server.

One WebKit CRM follow-up interaction also failed in the broad run. Its trace showed
no PATCH request. Background permission refresh was adjusted to preserve mounted
forms instead of temporarily unmounting guarded pages. The final test explicitly
checks an open assignment dialog survives a permission-refresh round trip. The CRM
follow-up case passed in both the corrected dev run and final compiled run. No
unrelated date-input implementation was changed.

The corrected dev run covers all five originally failed checks plus the affected
permission/Gmail flows. The final compiled run covers all three new consultant-access
scenarios, both Gmail scenarios and CRM follow-up flow in each browser. Do not read
the initial 98-test receipt as a clean single-run pass; the passing reruns above are
the final acceptance evidence for those cases.

Final compiled command (with synthetic Supabase build variables):

```sh
FYNDBRIDGE_TEST_BUILD=1 npx playwright test \
  server/browser-tests/consultant-access.spec.cjs \
  server/browser-tests/crmGmail.spec.cjs server/browser-tests/crm.spec.cjs \
  --grep 'Super Admin selects|Overall-only consultants|Assigned badge uses|Gmail toolbar connection|email intelligence stays|follow-up filters, dates' \
  --project=chromium --project=webkit
```

Evidence includes actual Admin save/reload/Cancel, matching frontend/backend Auth
UUIDs, selected CRM route access and revocation, delegated New with no Overall,
own-scope Delete All confirmation, an Overall-only reader unable to edit colleagues,
primary toolbar Disconnect, exact 10/11 and 50/51 colour/animation boundaries,
reduced motion and preservation of CRM manual/email history.

The backend suite executes the actual new migration, existing create/delete RPCs,
HTTP authorization and role-denial queries in PGlite PostgreSQL. It tests denied
permission writes, bad/inactive IDs, null-array rejection, exact selected IDs,
independent grants, owned upload creation, contacted-only scope, protected pending
statuses, immediate revocation and inability to mutate colleagues or permissions
through direct browser roles. Existing Gmail encryption/state/dedup/retry and CV
model/fallback tests continue to pass.

Screenshots were visually reviewed. A text control overflowing the small connection
information button was replaced with the existing Info icon style; final Gmail
browser checks use that icon. Screenshots contain synthetic data only:

- `crm-grant.png`, `admin-settings.png`
- `overall-reader.png`, `sidebar-alert.png`
- Updated Gmail connection/history/mobile images in `../crm-gmail-verification/`

No dependencies, lockfiles, credentials or unrelated product features were changed.
Build version metadata and unrelated older test screenshots were restored after
verification. All new product changes still require the permissions migration and
application deployment. See `docs/CONSULTANT_ACCESS.md` for Gmail testing steps.
